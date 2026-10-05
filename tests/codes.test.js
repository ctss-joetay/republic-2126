/* Country codes are handed out per room but looked up across every room. With
   one room that mismatch was invisible; with a class room per form teacher it
   hands a group somebody else's country. The index below is the fix, and these
   assertions are what stop it rotting. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3322;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-codes-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
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

  /* Two codes never colliding in one run of two rooms is true whether or not
     the global index exists (the old per-room loop resolves non-colliding
     codes correctly too), so it cannot be pinned black-box. A genuine
     cross-room collision cannot be forced from outside the process without
     mocking Math.random. What CAN be pinned externally is which mechanism is
     wired in: codes must come from freeCode() (checked against the global
     CODES map), not from a per-room "while(room.teams[tc])" loop that only
     ever checks the room it is handed. */
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const joinBlock = /'POST \/api\/join': async \(b\) => \{[\s\S]*?\n  \},/.exec(src);
  check('country codes are allocated from the global index, not a per-room loop', () => {
    assert.ok(joinBlock, 'could not find the /api/join route in server.js');
    assert.ok(/freeCode\(/.test(joinBlock[0]),
      '/api/join no longer allocates codes through freeCode() — a code could collide with one already live in another room');
    assert.ok(!/while\s*\(\s*room\.teams\[/.test(joinBlock[0]),
      '/api/join is back to checking uniqueness only against room.teams — the per-room bug this task fixed would return');
  });

  const dropBlock = /function dropRoom\([^)]*\)\s*\{[^}]*\}/.exec(src);
  check('dropping a room unregisters its codes before deleting it', () => {
    assert.ok(dropBlock, 'could not find dropRoom() in server.js');
    assert.ok(/unregRoom\(/.test(dropBlock[0]),
      'dropRoom() no longer calls unregRoom() — a deleted room would leave its codes pointing at nothing');
  });

  const rA = await openClassRoom(post);
  const rB = await openClassRoom(post);
  const a1 = await post('/api/join', { room: rA.room, name: 'Alpha', homeland: 'delta' });
  const b1 = await post('/api/join', { room: rB.room, name: 'Beta', homeland: 'high' });

  const sA = await get('/api/state?code=' + a1.code);
  const sB = await get('/api/state?code=' + b1.code);
  check('a code resolves to its own room', () => {
    assert.strictEqual(sA.room, rA.room, 'code from room A resolved elsewhere');
    assert.strictEqual(sB.room, rB.room, 'code from room B resolved elsewhere');
  });

  /* Deleting a room must purge its codes, not just delete the room. A code
     left in CODES after its room is gone is a silent time bomb: findTeam's
     self-heal happens to return null for it today (ROOMS.get(e.room) is
     undefined), so a direct /api/state probe on the freed code cannot tell
     purged apart from merely orphaned — dropRoom deleting unregRoom entirely
     would still pass that check.

     This used to prove it by re-importing the freed code's own room under a
     fresh, not-yet-live room code — but the final-review fix that closed
     POST /api/host/import's unauthenticated write hole (a snapshot for a
     room code that is not currently live is refused outright now, live room
     + matching hostKey only) makes that path unreachable on purpose. The
     same invariant is provable the authorised way instead: a second,
     genuinely live room "reclaims" the just-freed code by importing a
     snapshot of ITSELF (its own code, its own real hostKey) that happens to
     also carry a team using a1.code. That import can only succeed if CODES
     has actually forgotten a1.code belonged to the now-deleted rA — if the
     purge never ran, the per-team clash guard below refuses it, citing rA. */
  const expBeforeReset = await get(`/api/host/export?room=${rA.room}&hostKey=${rA.hostKey}`);
  await post('/api/host/act', { room: rA.room, hostKey: rA.hostKey, act: 'reset' });

  const rD = await openClassRoom(post);
  const dExp = await get(`/api/host/export?room=${rD.room}&hostKey=${rD.hostKey}`);
  const reclaim = JSON.parse(JSON.stringify(dExp.snapshot));
  const freedTeam = JSON.parse(JSON.stringify(expBeforeReset.snapshot.teams[a1.code]));
  reclaim.teams[freedTeam.code] = freedTeam; // freedTeam.code === a1.code
  const reimport = await post('/api/host/import', { snapshot: reclaim });
  check('resetting a room purges its country codes', () => {
    assert.ok(!reimport.error,
      `country code ${a1.code} was still claimed by the deleted room, so a live room importing a snapshot reusing it was wrongly refused: ${reimport.error}`);
  });
  const afterReimport = await get('/api/state?code=' + a1.code);
  check('the purged code now resolves under its re-imported room, not the deleted one', () => {
    assert.strictEqual(afterReimport.room, rD.room,
      'the country code did not follow the re-import to its new room');
  });

  /* Importing a backup whose country codes are live in a DIFFERENT room would
     silently repoint them. It has to be refused, naming the clash — proven
     here through a live room (rE) restoring itself with a snapshot that also
     carries a team code actually owned by the still-live rB, the same
     authorised-import shape as the reclaim check just above. */
  const exp = await get(`/api/host/export?room=${rB.room}&hostKey=${rB.hostKey}`);
  const rE = await openClassRoom(post);
  const eExp = await get(`/api/host/export?room=${rE.room}&hostKey=${rE.hostKey}`);
  const clash = JSON.parse(JSON.stringify(eExp.snapshot));
  const stolenTeam = JSON.parse(JSON.stringify(exp.snapshot.teams[b1.code]));
  clash.teams[stolenTeam.code] = stolenTeam;
  const imp = await post('/api/host/import', { snapshot: clash });
  check('import is refused when its codes belong to another live room', () => {
    assert.ok(imp.error, 'an import silently stole another live room\'s country codes');
    assert.ok(/already/i.test(imp.error), 'the refusal does not explain the clash: ' + imp.error);
  });
  /* Re-review LOW item: the hall-specific wording (rooms.test.js's "Gamma"
     scenario) deliberately withholds a room code — "the hall" is specific
     enough on its own, and naming ABCD-style codes for a room with 300
     students in it invites exactly the "go close it" instinct that finding
     3 exists to prevent. But rB here is an ordinary classroom, not the hall
     — for THAT case the teacher is left with nothing to act on at all
     unless the clashing room's code comes back, so it must still be named. */
  check('the refusal names the clashing room\'s code when the clash is NOT the hall', () => {
    assert.ok(imp.error.includes(rB.room),
      'a classroom-vs-classroom code clash gives the teacher nothing to act on — the clashing room\'s own code is missing: ' + imp.error);
  });

  /* Final-branch review, fix 2 (BLOCKER): the clash guard just above only
     ever iterated [t.code, t.viewCode] — 2 of the 6 codes every team now
     carries — while regRoom() registers all six (see regRoom() in
     server.js). Reproduced live before this fix:

       live room KH45 Defence code KJTQG -> room KH45, role def
       import a snapshot claiming KJTQG  -> {"ok":true}
       after import: KJTQG -> room IMPT, country "Attacker"

     A restore could silently repoint a live room's ministry credential at
     someone else's country, with no refusal at all — and crucially, this
     happens even when the LEADER and CLASS codes carried by the import do
     NOT clash with anything, which is exactly why the guard's narrower scope
     matters: a leader-code clash was already caught before this fix, so the
     test has to isolate the ministry door specifically, or it would pass
     for the wrong reason (proven below: the same shape built from a whole
     stolen team, leader code and all, passes even against the unfixed
     guard, because the leader-code clash alone already trips it).

     rF is a live room whose Defence code this test tries to steal. rH is a
     SEPARATE live room restoring ITSELF — its own leader and class codes are
     genuinely its own and clash with nothing — except this snapshot swaps
     one field, its own team's minCodes.def, for rF's live Defence code. The
     only code doing anything suspicious here is the ministry one. */
  const rF = await openClassRoom(post);
  const f1 = await post('/api/join', { room: rF.room, name: 'Fortis', homeland: 'delta' });
  const fDefCode = f1.team.minCodes.def; // the live Defence credential this test tries to steal

  const rH = await openClassRoom(post);
  const h1 = await post('/api/join', { room: rH.room, name: 'Honoria', homeland: 'high' });
  const hExp = await get(`/api/host/export?room=${rH.room}&hostKey=${rH.hostKey}`);
  const minClash = JSON.parse(JSON.stringify(hExp.snapshot));
  minClash.teams[h1.code].minCodes.def = fDefCode; // the ONLY borrowed code in this snapshot
  const minImp = await post('/api/host/import', { snapshot: minClash });
  check('import is refused when a MINISTRY code (not the leader or class code) belongs to another live room', () => {
    assert.ok(minImp.error,
      `a Defence code (${fDefCode}) was silently repointed at another room's import — the clash guard only checked the leader/view codes`);
  });
  const stillLive = await get('/api/state?code=' + fDefCode);
  check('the ministry code still resolves to its real room after the refused import', () => {
    assert.strictEqual(stillLive.room, rF.room,
      'the ministry code now resolves to the wrong room — a refused import still repointed the credential');
  });

  /* Final-review finding 5: POST /api/host/import used to check hostKey only
     when a room with this code happened to already be live —
     `if(live && live.hostKey !== s.hostKey)` — so any code that was NOT live
     accepted a snapshot from anyone, no authentication at all. Reproduced
     live before this fix: 300 anonymous rooms planted in well under a
     second. The fix requires a LIVE room whose hostKey matches; prove all
     three shapes — cold (no room there at all), live but wrong key, and the
     real, legitimate use — or a partial fix (e.g. only closing the message,
     or only checking `live`) would still leave the hole or lock teachers
     out of their own restore. */
  const cold = await post('/api/host/import', { snapshot: {
    code: 'QQQQ', hostKey: 'attacker-supplied-key', teams: {}, offers: [], feed: [],
    kind: 'hall', label: '', phase: 'prep', maxRounds: 6,
    round: 0, created: Date.now(), touched: Date.now(), rev: 1
  } });
  check('an unauthenticated import for a room code that is not currently live is refused', () => {
    assert.ok(cold.error, 'a snapshot for a room code that was never live was accepted with no authentication at all');
  });
  const coldRoom = await get('/api/room?room=QQQQ');
  check('the refused cold import planted no room at all', () => {
    assert.ok(coldRoom.error, 'a room now exists at QQQQ despite the import being refused');
  });

  const rG = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const wrongKey = await post('/api/host/import', { snapshot: {
    code: rG.room, hostKey: 'not-the-real-host-key', teams: {}, offers: [], feed: [],
    kind:'hall', label:'', phase:'prep', maxRounds:6, round:0, created:Date.now(), touched:Date.now(), rev:1
  } });
  check('importing into a live room under the wrong host key is still refused', () => {
    assert.ok(wrongKey.error, 'a live room accepted an import under the wrong host key');
  });

  const rGExp = await get(`/api/host/export?room=${rG.room}&hostKey=${rG.hostKey}`);
  const rGRestore = JSON.parse(JSON.stringify(rGExp.snapshot));
  rGRestore.label = 'Reimported';
  const rGReal = await post('/api/host/import', { snapshot: rGRestore });
  check('a teacher can still restore their own live room under its real host key — the real use case the fix must not break', () => {
    assert.ok(!rGReal.error, 'restoring a live room under its own real host key was refused: ' + rGReal.error);
  });

  if (!ran) console.error('FAIL  codes.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  code index — codes are globally unique, purged on delete, guarded on import');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
