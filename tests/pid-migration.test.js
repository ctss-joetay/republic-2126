/* Task 3 made boardRow() publish pid instead of code. restore()'s old guard
   (`if(t.pid == null) t.pid = t.code`) was harmless while boardRow still
   published code — it is not harmless now. A room saved before pid existed
   comes back publishing its leader codes on the shared board exactly as
   before the fix, and a room saved by the currently deployed build for one
   moment before this migration shipped comes back with every trade refused,
   because its allies/offers still hold codes that boardRow/teamByPid no
   longer resolve.

   migrateTeam()/migrateRoom() fix both: a team with no pid gets a freshly
   minted one (never its own code), and every code recorded in allies[] or
   offers[].from/.to is rewritten to the pid it now maps to — through both
   restore() (a full process restart) and POST /api/host/import (a teacher's
   backup file). This pins both entry points, using the same crafted
   rooms.json harness rooms.test.js built for the pid field default. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../game_engine.js');
const { cleanupServer } = require('./helpers');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';

const ROOT = path.join(__dirname, '..');
const post = (base, p, body) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (base, p) => fetch(base + p).then(r => r.json());
const waitUp = async (base) => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
};

let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

function makeTeam(code, name, allies) {
  const t = Object.assign(E.blankCountry(), { code, name, homeland: 'delta' });
  t.meters = E.foundingMeters(t);
  delete t.pid;              // simulate a room saved before pid existed
  t.allies = allies || [];   // legacy allies recorded as leader codes
  return t;
}

(async () => {
  /* ---------------- scenario 1: restore() migrates a legacy room ---------------- */
  const PORT1 = 3330;
  const BASE1 = `http://127.0.0.1:${PORT1}`;
  const DATA_DIR1 = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-migr-'));

  const alice = makeTeam('ALICE01', 'Aliceland', ['BOBBY02']);
  const bob   = makeTeam('BOBBY02', 'Bobland', ['ALICE01']);

  const legacyRoom = {
    code: 'MIGR', hostKey: 'migratehost1', kind: 'hall', label: '', phase: 'prep', round: 0, maxRounds: 10,
    scenario: null, scenarioRound: 0,
    teams: { ALICE01: alice, BOBBY02: bob },
    /* one resolvable offer (both endpoints are codes for teams still in the
       room) and one that references a team that no longer exists — the
       second must be dropped, not left dangling on a pid nothing owns. */
    offers: [
      { id: 'OFR001', from: 'ALICE01', to: 'BOBBY02', fromName: 'Aliceland', toName: 'Bobland',
        give: { W: 0, M: 0, F: 1 }, want: { W: 0, M: 1, F: 0 }, coins: 0, ally: false, status: 'pending', t: Date.now() },
      { id: 'OFR002', from: 'ALICE01', to: 'GHOST99', fromName: 'Aliceland', toName: 'Ghostland',
        give: { W: 0, M: 0, F: 1 }, want: { W: 0, M: 1, F: 0 }, coins: 0, ally: false, status: 'pending', t: Date.now() }
    ],
    feed: [], openJoin: false, practiceLeft: 0,
    timerEndsAt: null, timerSecs: 0, rev: 1, created: Date.now(), touched: Date.now()
  };
  fs.mkdirSync(DATA_DIR1, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR1, 'rooms.json'), JSON.stringify({ v: 1, saved: Date.now(), rooms: [legacyRoom] }));

  const server1 = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT1), DATA_DIR: DATA_DIR1 }, stdio: 'ignore'
  });
  await waitUp(BASE1);

  const roomView1 = JSON.stringify(await get(BASE1, '/api/room?room=MIGR'));
  const sAlice = await get(BASE1, '/api/state?code=ALICE01');
  const sBob   = await get(BASE1, '/api/state?code=BOBBY02');

  check('restore() mints a fresh pid for a legacy team, not its own code', () => {
    assert.ok(sAlice.team && sAlice.team.pid, 'Alice has no pid after restore()');
    assert.ok(sBob.team && sBob.team.pid, 'Bob has no pid after restore()');
    assert.notStrictEqual(sAlice.team.pid, 'ALICE01', 'Alice\'s pid is still her own leader code');
    assert.notStrictEqual(sBob.team.pid, 'BOBBY02', 'Bob\'s pid is still his own leader code');
    assert.notStrictEqual(sAlice.team.pid, sBob.team.pid, 'two teams in the same room were minted the same pid');
  });
  check('a restored legacy room leaks no leader code on its board', () => {
    assert.ok(!roomView1.includes('ALICE01'), 'ALICE01 leaked onto the restored room\'s board');
    assert.ok(!roomView1.includes('BOBBY02'), 'BOBBY02 leaked onto the restored room\'s board');
  });
  check('an ally recorded as a code before migration is an ally recorded as a pid after', () => {
    assert.ok(sAlice.team.allies.includes(sBob.team.pid), 'Alice\'s allies do not hold Bob\'s pid');
    assert.ok(!sAlice.team.allies.includes('BOBBY02'), 'Alice\'s allies still hold Bob\'s leader code');
    assert.ok(sBob.team.allies.includes(sAlice.team.pid), 'Bob\'s allies do not hold Alice\'s pid');
    assert.ok(!sBob.team.allies.includes('ALICE01'), 'Bob\'s allies still hold Alice\'s leader code');
  });
  check('a resolvable legacy offer survives migration, addressed by pid', () => {
    const offer = (sAlice.offers || []).find(o => o.id === 'OFR001');
    assert.ok(offer, 'the resolvable offer did not survive migration');
    assert.strictEqual(offer.from, sAlice.team.pid, 'the offer\'s from is still a leader code');
    assert.strictEqual(offer.to, sBob.team.pid, 'the offer\'s to is still a leader code');
  });
  check('an offer whose endpoint cannot be resolved is dropped, not left dangling', () => {
    assert.ok(!roomView1.includes('OFR002'), 'the unresolvable offer is still in the room');
    assert.ok(!roomView1.includes('GHOST99'), 'a dangling code from a dropped offer is still published');
  });

  await cleanupServer(server1, DATA_DIR1);

  /* ---------------- scenario 2: host/import migrates a legacy backup ---------------- */
  const PORT2 = 3331;
  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const DATA_DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-migr-import-'));
  const server2 = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT2), DATA_DIR: DATA_DIR2 }, stdio: 'ignore'
  });
  await waitUp(BASE2);

  /* Final-review finding 5 closed host/import's unauthenticated write hole:
     it now requires a LIVE room whose hostKey matches, not just any code.
     Mint a real live room first and reuse its code/hostKey for the backup —
     the crafted legacy state (codes-not-pids, missing fields) is otherwise
     unchanged, only the route in is now the authorised one. */
  const importTarget = await post(BASE2, '/api/host/create', { kind: 'hall', key: HALL_PASS });
  const carol = makeTeam('CAROL01', 'Carolland', ['DEREK02']);
  const derek = makeTeam('DEREK02', 'Derekland', ['CAROL01']);
  const backupSnapshot = {
    code: importTarget.room, hostKey: importTarget.hostKey, kind: 'hall', label: '', phase: 'prep', round: 0, maxRounds: 10,
    scenario: null, scenarioRound: 0,
    teams: { CAROL01: carol, DEREK02: derek },
    offers: [
      { id: 'OFR010', from: 'CAROL01', to: 'DEREK02', fromName: 'Carolland', toName: 'Derekland',
        give: { W: 0, M: 0, F: 1 }, want: { W: 0, M: 1, F: 0 }, coins: 0, ally: false, status: 'pending', t: Date.now() }
    ],
    feed: [], openJoin: false, practiceLeft: 0,
    timerEndsAt: null, timerSecs: 0, rev: 1, created: Date.now(), touched: Date.now()
  };

  const imported = await post(BASE2, '/api/host/import', { snapshot: backupSnapshot });
  check('an old backup imports without error', () => {
    assert.ok(!imported.error, 'importing a legacy backup was refused: ' + imported.error);
  });

  const roomView2 = JSON.stringify(await get(BASE2, '/api/room?room=' + importTarget.room));
  const sCarol = await get(BASE2, '/api/state?code=CAROL01');
  const sDerek = await get(BASE2, '/api/state?code=DEREK02');

  check('host/import mints a fresh pid for a legacy team, not its own code', () => {
    assert.ok(sCarol.team && sCarol.team.pid, 'Carol has no pid after import');
    assert.notStrictEqual(sCarol.team.pid, 'CAROL01', 'Carol\'s pid is still her own leader code');
    assert.notStrictEqual(sDerek.team.pid, 'DEREK02', 'Derek\'s pid is still his own leader code');
  });
  check('an imported legacy room leaks no leader code on its board', () => {
    assert.ok(!roomView2.includes('CAROL01'), 'CAROL01 leaked onto the imported room\'s board');
    assert.ok(!roomView2.includes('DEREK02'), 'DEREK02 leaked onto the imported room\'s board');
  });
  check('host/import rewrites allies from codes to pids', () => {
    assert.ok(sCarol.team.allies.includes(sDerek.team.pid), 'Carol\'s allies do not hold Derek\'s pid after import');
    assert.ok(!sCarol.team.allies.includes('DEREK02'), 'Carol\'s allies still hold Derek\'s leader code after import');
  });
  check('host/import lets the imported room trade immediately, by pid', () => {
    const offer = (sCarol.offers || []).find(o => o.id === 'OFR010');
    assert.ok(offer, 'the imported offer did not survive migration');
    assert.strictEqual(offer.to, sDerek.team.pid, 'the imported offer is still addressed by leader code — trading would be refused');
  });

  await cleanupServer(server2, DATA_DIR2);

  if (!ran) console.error('FAIL  pid-migration.test.js ran zero checks — a server likely never started');
  if (fails || !ran) process.exit(1);
  console.log('PASS  pid migration — restore() and host/import both mint fresh pids and rewrite allies/offers');
  process.exit(0);
})().catch(e => { console.error('FAIL ', e); process.exit(1); });
