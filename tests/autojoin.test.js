/* /play?code=ABCDE — the QR code on a group's printed slip.

   Thirty groups typing a five-letter code into a phone keyboard is thirty
   chances to mistype it, and each one becomes a hand in the air during the ten
   minutes a teacher has to get a class started. This is the path that skips
   the typing, so it has to be exactly as trustworthy as the field it replaces:
   the same endpoint, the same refusals, and no way for a malformed link to
   join something it should not.

   Both codes on the slip go through here — /api/state decides which one it was
   handed, so a leader code opens the country and a class code opens it
   read-only, and this function never needs to know the difference. That is
   pinned end to end against a real server below. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractFn, makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PORT = 3347;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-auto-'));
const KEY = 'a-very-long-admin-key-for-autojoin-tests';

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_KEY: KEY }, stdio: 'ignore'
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

  /* ---- the function itself, pulled out of the shipped page ---- */
  const autoJoin = new Function('return ' + extractFn('autoJoin') + '; ')();
  const run = (search) => {
    const seen = { filled: null, joins: 0 };
    const out = autoJoin(search, v => { seen.filled = v; }, () => { seen.joins++; });
    return { ...seen, out };
  };

  check('a slip\'s code fills the field and joins, without being typed', () => {
    const r = run('?code=ABCDE');
    assert.strictEqual(r.out, true);
    assert.strictEqual(r.filled, 'ABCDE');
    assert.strictEqual(r.joins, 1, 'scanning the slip did not join');
  });
  check('a lower-case code off a scanner still works', () => {
    const r = run('?code=abcde');
    assert.strictEqual(r.filled, 'ABCDE', 'the code was not upper-cased before use');
    assert.strictEqual(r.joins, 1);
  });
  check('surrounding whitespace does not stop a scan', () => {
    assert.strictEqual(run('?code=%20ABCDE%20').filled, 'ABCDE');
  });
  check('the code survives other parameters on the link', () => {
    const r = run('?room=WXYZ&code=ABCDE&utm=x');
    assert.strictEqual(r.filled, 'ABCDE');
    assert.strictEqual(r.joins, 1);
  });
  for (const [name, search] of [
    ['no code at all',        '?room=WXYZ'],
    ['an empty code',         '?code='],
    ['a four-letter code',    '?code=ABCD'],
    ['a six-letter code',     '?code=ABCDEF'],
    ['nothing in the address','']
  ]) {
    check(`${name} joins nothing, and leaves the group typing as before`, () => {
      const r = run(search);
      assert.strictEqual(r.out, false);
      assert.strictEqual(r.joins, 0, 'a malformed link tried to join anyway');
    });
  }

  /* ---- and end to end: the codes a slip will actually carry ---- */
  const cls = (await post('/api/admin/rooms', { key: KEY, labels: ['3I1'] })).rooms[0];
  await post('/api/host/groups', { room: cls.room, hostKey: cls.hostKey, n: 1 });
  const team = (await post('/api/host/roster', { room: cls.room, hostKey: cls.hostKey })).roster[0];
  await post('/api/team/save', { code: team.code, country: { name: 'Solaria', members: { leader: 'Ana' } } });

  const asLeader = await get('/api/state?code=' + team.code);
  const asMember = await get('/api/state?code=' + team.viewCode);
  check('the leader code on the slip opens the country to drive it', () => {
    assert.strictEqual(asLeader.role, 'leader');
    assert.strictEqual(asLeader.team.name, 'Solaria');
  });
  check('the class code on the same slip opens it to watch', () => {
    assert.strictEqual(asMember.role, 'member');
    assert.strictEqual(asMember.team.name, 'Solaria');
  });
  check('both codes are the five letters the QR will encode', () => {
    assert.strictEqual(team.code.length, 5, 'a leader code is not 5 letters — autoJoin would refuse the slip');
    assert.strictEqual(team.viewCode.length, 5, 'a class code is not 5 letters — autoJoin would refuse the slip');
  });
  const bogus = await get('/api/state?code=ZZZZZ');
  check('a code that belongs to nobody is refused, so a bad scan lands on the join screen', () => {
    assert.ok(bogus.error, 'an unknown code was accepted');
  });

  if (!ran) console.error('FAIL  autojoin.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  autojoin — a scanned slip joins, a malformed link does not');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
