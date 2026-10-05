/* POST /api/host/create used to have no guard of any kind. Anyone who could
   reach /host could open a hall room, and a hall's host key deals scenario
   cards without limit — so a curious student, or a teacher wanting a preview,
   could run the entire mass game a week early and know every card in it.

   Opening a hall now takes the event passcode. A classroom still takes nothing:
   teachers open their own rooms all day, and gating that would be a different
   and worse problem than the one this closes.

   Three servers, because the behaviour depends on what the environment holds:
   one with no keys at all, one with HALL_KEY, one with only ADMIN_KEY. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, cleanupServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Eight alphanumerics — the shortest HALL_KEY the server accepts, and the
   shape a real one will be, so the tests exercise the real floor rather than a
   comfortable string nobody would type. */
const HALL_PASS  = 'K7m2Qx9p';
const ADMIN_PASS = 'a-very-long-admin-key-for-passcode-tests';

/* one spawn helper, three servers */
function boot(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-pass-'));
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    proc, dir, base,
    post: (p, body) => fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()),
    ready: async () => {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 100));
      }
    }
  };
}

/* HALL_KEY and ADMIN_KEY are deliberately absent from this one — the
   fail-closed case, and the one a fresh Railway deploy starts in. */
const bare  = boot(3337, {});
/* seven characters — one below the floor, to prove it is ignored rather than
   half-honoured */
const short = boot(3340, { HALL_KEY: 'K7m2Qx9' });
const hall  = boot(3338, { HALL_KEY: HALL_PASS });
const admin = boot(3339, { ADMIN_KEY: ADMIN_PASS });

const done = makeDone(bare.proc, bare.dir);

(async () => {
  await bare.ready(); await hall.ready(); await admin.ready(); await short.ready();

  let fails = 0, ran = 0;
  const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
    catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

  /* every request made up front, so the checks stay synchronous — check() does
     not await, and a check that returns a promise reports a pass and then
     throws its real failure somewhere nobody is looking */
  const bareHall   = await bare.post('/api/host/create',  { kind: 'hall' });
  const bareGuess  = await bare.post('/api/host/create',  { kind: 'hall', key: 'not-the-passcode' });
  const bareClass  = await bare.post('/api/host/create',  { kind: 'class', label: '3E' });

  const hallRight  = await hall.post('/api/host/create',  { kind: 'hall', key: HALL_PASS });
  const hallWrong  = await hall.post('/api/host/create',  { kind: 'hall', key: HALL_PASS + 'x' });
  const hallShort  = await hall.post('/api/host/create',  { kind: 'hall', key: HALL_PASS.slice(0, -1) });
  const hallNone   = await hall.post('/api/host/create',  { kind: 'hall' });
  const hallClass  = await hall.post('/api/host/create',  { kind: 'class' });

  const shortKeyHall  = await short.post('/api/host/create', { kind: 'hall', key: 'K7m2Qx9' });
  const shortKeyClass = await short.post('/api/host/create', { kind: 'class' });

  /* five wrong guesses in a row, timed, against a fresh server so the counter
     starts at zero */
  const guesser = boot(3341, { HALL_KEY: HALL_PASS });
  await guesser.ready();
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) await guesser.post('/api/host/create', { kind:'hall', key:'wrongkey' + i });
  const guessMs = Date.now() - t0;

  const admHall    = await admin.post('/api/host/create', { kind: 'hall', key: ADMIN_PASS });
  const admNone    = await admin.post('/api/host/create', { kind: 'hall' });

  check('with no passcode set on the server, no hall opens at all', () => {
    assert.ok(bareHall.error, 'a hall opened on a server with no passcode');
    assert.ok(/passcode/i.test(bareHall.error),
      'the refusal does not say what is needed: ' + bareHall.error);
    assert.ok(bareGuess.error, 'a guessed passcode opened a hall');
  });

  check('a classroom needs nothing, on any server', () => {
    /* Teachers open their own rooms all day. This is the check that stops a
       later tightening of the guard from locking them out too. */
    assert.ok(!bareClass.error, 'a teacher was refused their own classroom: ' + bareClass.error);
    assert.strictEqual(bareClass.kind, 'class');
    assert.ok(!hallClass.error, 'a classroom was refused on a passcode-carrying server');
  });

  check('the event passcode opens a hall', () => {
    assert.ok(!hallRight.error, 'the right passcode was refused: ' + hallRight.error);
    assert.strictEqual(hallRight.kind, 'hall');
    assert.ok(hallRight.hostKey, 'no host key came back');
  });

  check('a near-miss passcode does not', () => {
    assert.ok(hallWrong.error, 'a passcode with one extra character opened a hall');
    assert.ok(hallShort.error, 'a passcode with one character missing opened a hall');
    assert.ok(hallNone.error, 'no passcode at all opened a hall');
  });

  check('an eight-character passcode is accepted — that is the documented floor', () => {
    assert.strictEqual(HALL_PASS.length, 8, 'this test no longer exercises the minimum length');
    assert.ok(!hallRight.error, 'the shortest allowed passcode was refused');
  });

  check('a passcode below the floor is ignored, not quietly honoured', () => {
    /* A seven-character HALL_KEY must not half-work. The server treats it as
       unset — and says so at boot — rather than accepting a key too short to
       be worth anything. */
    assert.ok(shortKeyHall.error, 'a 7-character HALL_KEY opened a hall');
    assert.ok(!shortKeyClass.error, 'a classroom broke on a server with a too-short HALL_KEY');
  });

  check('wrong guesses are slowed down', () => {
    /* Eight characters is only safe if guessing is expensive. Five wrong
       guesses should take meaningfully longer than five right ones. */
    assert.ok(guessMs > 1000,
      `five wrong passcodes took ${guessMs}ms — there is no escalating delay on the hall door`);
  });

  check('the admin key opens a hall too, so one forgotten variable is not fatal', () => {
    /* HALL_KEY is unset on this server. ADMIN_KEY is the stronger credential
       and is already set in production, so a HALL_KEY nobody added to Railway
       is a recoverable mistake on the morning rather than a dead event. */
    assert.ok(!admHall.error, 'ADMIN_KEY did not open a hall: ' + admHall.error);
    assert.strictEqual(admHall.kind, 'hall');
    assert.ok(admNone.error, 'a hall opened with no key on an ADMIN_KEY-only server');
  });

  check('the passcode is never echoed back', () => {
    for (const r of [hallRight, admHall]) {
      const raw = JSON.stringify(r);
      assert.ok(!raw.includes(HALL_PASS), 'the hall passcode came back in the response');
      assert.ok(!raw.includes(ADMIN_PASS), 'the admin key came back in the response');
    }
  });

  await cleanupServer(hall.proc, hall.dir);
  await cleanupServer(admin.proc, admin.dir);
  await cleanupServer(short.proc, short.dir);
  await cleanupServer(guesser.proc, guesser.dir);

  if (!ran) console.error('FAIL  hall-passcode.test.js ran zero checks — a server likely never started');
  /* `return`, unlike the older files in this directory: done() only schedules
     the exit, so falling through prints a cheerful summary line underneath a
     list of failures. */
  if (fails || !ran) return done(1);
  console.log('PASS  hall passcode — a hall takes the event passcode, a classroom takes nothing');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
