/* A classroom gets one drill card, and only once every country in it is
   committed. Its whole job is to check that all groups know what happens when a
   card appears in the hall — it appears, the cabinet argues, the Leader picks,
   the meters move — and then to cost nothing.

   Costing nothing is the hard part, and it is why the old practice cards ran
   BEFORE commit: committing recomputes a country's meters, which wiped the
   rehearsal for free. This one runs after, so the meters are put back from a
   snapshot instead.

   Running after commit also walks straight into writable(), which refuses a
   committed country every write while the room is in prep. The drill is the one
   exception, and it is a narrow one: meters only, no coins, and put back. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PORT = 3340;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-drill-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
});
const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  let fails = 0, ran = 0;
  const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
    catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

  const E = require('../game_engine.js');
  const room = await openClassRoom(post, { label:'3E' });
  const a = await post('/api/join', { room:room.room, name:'Alpha', homeland:'delta' });
  const b = await post('/api/join', { room:room.room, name:'Beta',  homeland:'high' });
  for (const [code, name] of [[a.code,'Alpha'], [b.code,'Beta']])
    await post('/api/team/save', { code, country:{ name, members:{ leader:'Ana' } } });

  const act = (body) => post('/api/host/act', { room:room.room, hostKey:room.hostKey, ...body });

  const tooEarly = await act({ act:'scenario' });
  const commitA = await post('/api/team/commit', { code:a.code });
  const stillEarly = await act({ act:'scenario' });
  const commitB = await post('/api/team/commit', { code:b.code });

  const before = (await get('/api/state?code=' + a.code)).team.meters;
  /* A card now opens with a discussion window in which nobody may decide or
     trade. A 10-second card clock is shorter than the 15-second floor that
     discussionEnd() leaves to decide in, so the window clamps into the past
     and the card is answerable at once — which is what this test is about,
     not the window. See tests/discussion-minute.test.js for the window itself. */
  await act({ act:'timer', secs:10 });
  const dealt  = await act({ act:'scenario' });
  const openState = await get('/api/state?code=' + a.code);
  const chose = await post('/api/scenario/choose', { code:a.code, choice:'a' });
  const during = (await get('/api/state?code=' + a.code)).team;
  const second = await act({ act:'scenario' });
  await act({ act:'clear' });
  const after = (await get('/api/state?code=' + a.code)).team;

  check('the fixtures committed, or nothing below means anything', () => {
    assert.ok(!commitA.error, 'Alpha could not commit: ' + commitA.error);
    assert.ok(!commitB.error, 'Beta could not commit: ' + commitB.error);
  });

  check('the drill is refused until every country is committed', () => {
    assert.ok(tooEarly.error, 'the drill ran with nobody committed');
    assert.ok(/commit/i.test(tooEarly.error), 'the refusal does not say why: ' + tooEarly.error);
    assert.ok(stillEarly.error, 'the drill ran with only one of two committed');
  });

  check('once everyone is committed, the drill runs', () => {
    assert.ok(!dealt.error, 'the drill was refused: ' + dealt.error);
    assert.strictEqual(openState.scenario, E.DRILL.key);
  });

  check('a committed country may answer the drill', () => {
    /* writable() refuses a committed country every write while the room is in
       prep — correct for everything else, fatal for a card that runs after
       commit by design. */
    assert.ok(!chose.error, 'a committed country was refused its own drill: ' + chose.error);
  });

  check('it is one drill, not a series', () => {
    assert.ok(second.error, 'a second drill was dealt');
  });

  check('choosing moves the meters, so groups feel the consequence', () => {
    assert.ok(during.chosen, 'the choice was not recorded');
    assert.notDeepStrictEqual(during.meters, before, 'the drill moved nothing at all');
  });

  check('closing the drill puts every meter back exactly', () => {
    assert.deepStrictEqual(after.meters, before,
      'the drill left the meters changed — this rides into the hall');
    assert.ok(!after.chosen, 'the drill left a decision on the country');
  });

  check('the drill never moves coins', () => {
    assert.strictEqual(during.coins, after.coins, 'coins changed across the drill');
  });

  const stillLocked = await post('/api/team/save', { code:a.code, country:{ name:'Renamed Mid-Prep' } });
  check('the exception is exactly one card wide — the country is still committed', () => {
    /* If letting a committed country answer the drill also let it keep editing,
       commit would have stopped meaning anything. */
    assert.ok(stillLocked.error, 'a committed country was editable after the drill');
    assert.ok(/committed/i.test(stillLocked.error), 'refused for the wrong reason: ' + stillLocked.error);
  });

  if (!ran) console.error('FAIL  drill.test.js ran zero checks — the server likely never started');
  if (fails || !ran) return done(1);
  console.log('PASS  drill — one card, after commit, and it costs nothing');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
