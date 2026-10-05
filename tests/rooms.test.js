/* A form teacher's classroom room and the hall room for the mass game are not
   the same thing. A classroom room must not be able to start the mass game,
   and a hall room must not let a student mint a country just by typing the
   room code — that is the extra-country hole this task closes. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, cleanupServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3321;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-rooms-'));
const KEY = 'a-very-long-admin-key-for-rooms-tests'; // needed to reach POST /api/admin/rooms below

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT), DATA_DIR, ADMIN_KEY: KEY }, stdio: 'ignore'
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

  const cls = await post('/api/host/create', { kind:'class', label:'3E' });
  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS });

  let rc = await get('/api/room?room=' + cls.room);
  let rh = await get('/api/room?room=' + hall.room);
  check('a class room knows what it is', () => {
    assert.strictEqual(rc.kind, 'class');
    assert.strictEqual(rc.label, '3E');
    assert.strictEqual(rc.practiceLeft, 1, 'a class room gets one drill card, run once every group has committed');
  });
  check('a hall room refuses open joining from the start', () => {
    assert.strictEqual(rh.kind, 'hall');
    assert.strictEqual(rh.openJoin, false, 'a hall room must not let students mint countries');
  });

  const blocked = await post('/api/join', { room: hall.room, name: 'Sneaky', homeland: 'delta' });
  check('joining a hall room by room code is refused', () => {
    assert.ok(blocked.error, 'a student created a country in a hall room by typing the room code');
  });

  /* A teacher exploring the console must not be able to start a mass game in
     their own classroom — it burns rounds and pays income to half-built
     countries. */
  const started = await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act:'phase', phase:'game' });
  rc = await get('/api/room?room=' + cls.room);
  check('a class room cannot start the mass game', () => {
    assert.ok(started.error, 'a class room started a mass game');
    assert.strictEqual(rc.phase, 'prep', 'the class room left nation-building anyway');
  });

  /* A classroom now opens CLOSED, like a hall. Its room code is projected, so
     anything that code opens is open to whoever reads the screen — one group
     can mint a second country and trade with itself. Students get in with the
     leader and class codes the teacher hands out instead. */
  const openJoined = await post('/api/join', { room: cls.room, name: 'Early Bird', homeland: 'delta' });
  check('a brand-new class room refuses join-by-room-code', () => {
    assert.ok(openJoined.error,
      'a student minted a country in a freshly opened classroom just by typing the projected room code');
  });

  /* Task 13: the console's rollback lever. Neither branch below has any
     other coverage — the console test only pins that the client posts to
     this route, not that the server does the right thing with it. */
  const beforeOpen = await get('/api/room?room=' + cls.room);
  const openToggle = await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act:'openjoin' });
  const afterOpen = await get('/api/room?room=' + cls.room);
  check('the openjoin rollback lever actually flips openJoin', () => {
    assert.ok(!openToggle.error, 'openjoin was refused: ' + openToggle.error);
    assert.notStrictEqual(afterOpen.openJoin, beforeOpen.openJoin, 'openJoin did not change');
    assert.strictEqual(afterOpen.openJoin, true, 'the lever did not open a room that started closed');
  });
  /* The lever has to be a real way back in for a latecomer or a group that
     lost both codes, not just a flag that flips — which is the whole reason
     the default can be closed at all. */
  const latecomer = await post('/api/join', { room: cls.room, name: 'Latecomer', homeland: 'delta' });
  check('once the lever is on, the room code lets a latecomer in', () => {
    assert.ok(!latecomer.error, 'open joining was on and the room code still would not work: ' + latecomer.error);
  });
  await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act:'openjoin' }); // closed again for later checks

  /* Review finding (critical): the console hid the "Allow open joining"
     button in a hall, but hiding a button is not a security boundary — a
     direct API call (or a stray click before the fix) could still flip
     openJoin on a room projected in front of two hundred students with its
     code on the screen, reopening exactly the extra-country hole Tasks 4
     and 12 closed. The server itself must refuse it for a hall room. */
  const hallBeforeToggle = await get('/api/room?room=' + hall.room);
  const hallToggle = await post('/api/host/act', { room: hall.room, hostKey: hall.hostKey, act:'openjoin' });
  const hallAfterToggle = await get('/api/room?room=' + hall.room);
  check('a hall room refuses the openjoin rollback lever outright', () => {
    assert.ok(hallToggle.error, 'a hall room accepted the openjoin toggle — the console-only fix is not enough');
    assert.strictEqual(hallAfterToggle.openJoin, hallBeforeToggle.openJoin, 'openJoin changed on a hall room despite the refusal');
    assert.strictEqual(hallAfterToggle.openJoin, false, 'a hall room ended up with joining open');
  });
  const sneakAfterRefusal = await post('/api/join', { room: hall.room, name: 'Sneaky Two', homeland: 'delta' });
  check('a hall room still cannot mint a country after a refused openjoin attempt', () => {
    assert.ok(sneakAfterRefusal.error, 'a student minted a country in the hall after the refused toggle');
  });

  /* "Finish session" is a checklist, not an action: it must record a feed
     line and change nothing else about the room — no phase, round or
     committed count, and nothing locked or deleted. */
  const beforeFinish = await get('/api/room?room=' + cls.room);
  const finishR = await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act:'finish' });
  const afterFinish = await get('/api/room?room=' + cls.room);
  check('finish records a feed line and changes nothing else about the room', () => {
    assert.ok(!finishR.error, 'finish was refused: ' + finishR.error);
    assert.strictEqual(afterFinish.phase, beforeFinish.phase, 'finish changed the room phase');
    assert.strictEqual(afterFinish.round, beforeFinish.round, 'finish changed the round');
    assert.strictEqual(afterFinish.committed, beforeFinish.committed, 'finish changed the committed count');
    assert.strictEqual(afterFinish.count, beforeFinish.count, 'finish changed the country count');
    assert.ok(afterFinish.feed.some(f => /committed/i.test(f.text)),
      'finish left no feed line telling the class the session is done');
  });

  const E2 = require('../game_engine.js');
  const blank = E2.blankCountry();
  check('blankCountry carries the new fields', () => {
    for (const k of ['viewCode', 'pid', 'slot', 'locked', 'renameAsked', 'origin'])
      assert.ok(k in blank, `blankCountry() is missing ${k}`);
    assert.strictEqual(blank.locked, false);
    assert.strictEqual(blank.renameAsked, false);
  });

  /* restore()'s pid guard must test absence, not falsiness. A legacy room's
     team was saved before pid existed and has no such key at all; a team
     saved by current code carries pid:'' — not yet assigned, and must be
     left alone, or a restart would quietly publish its leader code as its
     public id. The only way to exercise restore() itself (rather than the
     live in-memory room) is to actually restart a server against a crafted
     rooms.json, the way the persistence tests do. */
  const PORT2 = 3329;
  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const DATA_DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-rooms-pid-'));

  const legacy = Object.assign(E2.blankCountry(), { code: 'LEGACY1', name: 'Legacyland', homeland: 'delta' });
  legacy.meters = E2.foundingMeters(legacy);
  delete legacy.pid; // simulate a room saved before pid existed — the key is absent, not falsy

  const fresh = Object.assign(E2.blankCountry(), { code: 'FRESH01', name: 'Freshland', homeland: 'delta' });
  fresh.meters = E2.foundingMeters(fresh);
  // fresh.pid stays '' — current code, provisioned but not yet assigned a public id

  const craftedRoom = {
    code: 'PIDR', hostKey: 'testhostkey0', kind: 'hall', label: '', phase: 'prep', round: 0, maxRounds: 10,
    scenario: null, scenarioRound: 0,
    teams: { LEGACY1: legacy, FRESH01: fresh },
    offers: [], feed: [], openJoin: false, practiceLeft: 0,
    timerEndsAt: null, timerSecs: 0, rev: 1, created: Date.now(), touched: Date.now()
  };

  /* Final-review finding 1: a room saved before `kind` existed at all (no
     such key, not merely a falsy one) predates the classroom/hall split
     entirely — every room back then behaved like an open-joining hall.
     migrateRoom() used to do `if(!room.kind) room.kind = 'hall'` and THEN
     derive openJoin from that just-defaulted kind — so a genuinely legacy
     room came back kind:'hall', openJoin:false: unjoinable, with no escape
     through any UI or API, the moment this build touched Railway's existing
     volume. Reproduced here exactly as it would happen on the day — no
     `kind` key, no `openJoin` key, one team — and restored the same way
     restore() actually runs it, through a real process boot against a
     crafted rooms.json, not through host/import (which now requires a live
     room and could not create this fixture in the first place). */
  const trulyLegacyTeam = Object.assign(E2.blankCountry(), { code: 'OLDWRLD1', name: 'Oldworld', homeland: 'delta' });
  trulyLegacyTeam.meters = E2.foundingMeters(trulyLegacyTeam);
  delete trulyLegacyTeam.pid;
  const trulyLegacyRoom = {
    code: 'OLDW', hostKey: 'trulylegacyhost1', label: '', phase: 'prep', round: 0, maxRounds: 10,
    scenario: null, scenarioRound: 0,
    teams: { OLDWRLD1: trulyLegacyTeam },
    offers: [], feed: [], practiceLeft: 0,
    timerEndsAt: null, timerSecs: 0, rev: 1, created: Date.now(), touched: Date.now()
    // kind and openJoin both intentionally absent — a genuinely pre-split room
  };
  assert.ok(!('kind' in trulyLegacyRoom) && !('openJoin' in trulyLegacyRoom),
    'test fixture bug: trulyLegacyRoom must not carry a kind or openJoin key at all');

  fs.mkdirSync(DATA_DIR2, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR2, 'rooms.json'),
    JSON.stringify({ v: 1, saved: Date.now(), rooms: [craftedRoom, trulyLegacyRoom] }));

  const server2 = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT2), DATA_DIR: DATA_DIR2 }, stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE2 + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  const sLegacy = await fetch(BASE2 + '/api/state?code=LEGACY1').then(r => r.json());
  const sFresh  = await fetch(BASE2 + '/api/state?code=FRESH01').then(r => r.json());
  const roomView2 = JSON.stringify(await fetch(BASE2 + '/api/room?room=PIDR').then(r => r.json()));
  /* Task 2 chose pid = code for a legacy team; Task 3's review overturned that,
     because boardRow() now publishes pid to every device in the room, and
     pid = code would republish the leader code it exists to hide. The
     migration mints a fresh 5-letter pid instead — this assertion pins that
     reversal, not the original design. */
  const PID_RE = /^[A-HJ-NP-Z2-9]{5}$/;
  check('restore() mints a fresh pid for a team that never had the field, not its own code', () => {
    assert.ok(sLegacy.team && PID_RE.test(sLegacy.team.pid),
      'a legacy team with no pid field at all should be given a real 5-letter pid');
    assert.notStrictEqual(sLegacy.team.pid, 'LEGACY1',
      'a legacy team\'s pid must not be its own leader code — that republishes the credential on the board');
  });
  check('a restored legacy room leaks no leader code onto its board', () => {
    assert.ok(!roomView2.includes('LEGACY1'), 'the legacy team\'s leader code is published on the restored room\'s board');
  });
  check('restore() leaves an unassigned pid alone', () => {
    assert.strictEqual(sFresh.team && sFresh.team.pid, '',
      'a team already carrying pid:\'\' (not yet assigned) was overwritten on restart — that would publish its leader code');
  });

  const oldwView = await fetch(BASE2 + '/api/room?room=OLDW').then(r => r.json());
  check('a room with no kind key at all restores as a hall (unchanged from before this fix)', () => {
    assert.strictEqual(oldwView.kind, 'hall', 'a truly legacy room did not default to hall');
  });
  check('a room with no kind key at all restores OPEN, not closed — "no flag day"', () => {
    assert.strictEqual(oldwView.openJoin, true,
      'a genuinely legacy room (no kind key at all) restored with openJoin:false — every room on Railway\'s existing volume would become unjoinable the moment this build deploys, with no recovery path');
  });
  const oldwJoin = await fetch(BASE2 + '/api/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'OLDW', name: 'Newcomer', homeland: 'high' })
  }).then(r => r.json());
  check('a room restored from before the kind/openJoin split can actually still be joined', () => {
    assert.ok(!oldwJoin.error, 'a legacy room came back unjoinable, with no escape through any API: ' + oldwJoin.error);
  });
  const oldwActToggle = await fetch(BASE2 + '/api/host/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'OLDW', hostKey: 'trulylegacyhost1', act: 'openjoin' })
  }).then(r => r.json());
  check('a legacy room defaults to hall, so the openjoin lever (classroom-only) refuses it, matching a fresh hall', () => {
    assert.ok(oldwActToggle.error, 'the openjoin rollback lever accepted a hall-defaulted legacy room');
  });

  await cleanupServer(server2, DATA_DIR2);

  const p = await post('/api/host/create', { kind:'class', label:'3F' });
  let g = await post('/api/host/groups', { room:p.room, hostKey:p.hostKey, n:6 });
  check('provisioning creates the groups and deals the homelands', () => {
    assert.ok(!g.error, 'provisioning failed: ' + g.error);
    assert.strictEqual(g.roster.length, 6);
    const lands = g.roster.map(r => r.homeland);
    assert.strictEqual(new Set(lands).size, 6, 'six groups did not get six different homelands');
    assert.deepStrictEqual(g.roster.map(r => r.slot), [1,2,3,4,5,6]);
  });
  check('leader and class codes are all different', () => {
    const all = g.roster.flatMap(r => [r.code, r.viewCode]);
    assert.strictEqual(new Set(all).size, 12, 'a code was issued twice');
    g.roster.forEach(r => assert.notStrictEqual(r.code, r.viewCode));
  });
  const afterProv = await get('/api/room?room=' + p.room);
  const sneak = await post('/api/join', { room:p.room, name:'Seventh', homeland:'delta' });
  check('a seventh country cannot be minted', () => {
    assert.strictEqual(afterProv.openJoin, false);
    assert.ok(sneak.error, 'a student minted an extra country after provisioning');
  });

  /* dealHomeland() (called from /api/host/groups) is the only thing that is
     meant to set a group's homeland — the whole point of dealing the spread
     is that a group cannot trade up to a better one just by posting over it.
     Group 3 (slot 3, untouched by the shrink/grow tests below) is used here
     so this check does not collide with the name-based tests that follow. */
  const dealtLand = g.roster[2].homeland;
  const otherLand = E2.HOMELANDS.map(h => h.key).find(k => k !== dealtLand);
  await post('/api/team/save', { code: g.roster[2].code, country: { homeland: otherLand } });
  const afterHomelandAttempt = await post('/api/host/roster', { room:p.room, hostKey:p.hostKey });
  check('POST /api/team/save cannot change a dealt homeland', () => {
    const row = afterHomelandAttempt.roster.find(r => r.code === g.roster[2].code);
    assert.ok(row, 'the group used for this check went missing from the roster');
    assert.strictEqual(row.homeland, dealtLand, 'a client posted a different homeland and it moved');
  });

  /* A slot with no name has never been used, so shrinking may take it. A named
     country is somebody's work and the stepper must never delete it. */
  await post('/api/team/save', { code: g.roster[0].code, country: { name: 'Aurelia' } });
  await post('/api/team/save', { code: g.roster[5].code, country: { name: 'Borealis' } });
  const shrinkOk = await post('/api/host/groups', { room:p.room, hostKey:p.hostKey, n:4 });
  check('shrinking removes empty slots, highest first', () => {
    assert.ok(!shrinkOk.error, 'shrinking was refused with two empty slots to spare: ' + shrinkOk.error);
    assert.strictEqual(shrinkOk.roster.length, 4);
    const slots = shrinkOk.roster.map(r => r.slot);
    assert.ok(slots.includes(1) && slots.includes(6), 'a named group was deleted');
    assert.ok(!slots.includes(5) && !slots.includes(4), 'the highest empty slots were not the ones removed');
  });
  const shrinkNo = await post('/api/host/groups', { room:p.room, hostKey:p.hostKey, n:1 });
  check('shrinking will not delete a named country', () => {
    assert.ok(shrinkNo.error, 'the stepper deleted a group that had already started');
    assert.ok(/1|6/.test(shrinkNo.error), 'the refusal does not name the groups in use: ' + shrinkNo.error);
  });
  check('slots are not renumbered', () => {
    assert.ok(shrinkOk.roster.map(r => r.slot).includes(6),
      'slots were renumbered — the codes already printed on paper are now wrong');
  });

  /* Review finding I2: rotation was keyed to slot number, and slots are
     never renumbered, so shrinking away a group left its homeland
     permanently unassignable — growing back could not recover it, and two
     groups ended up sharing a homeland instead. Room `p` is currently
     shrunk to four groups (slots 1, 2, 3, 6); growing it back to six must
     restore a full spread, not just avoid an error. */
  const growBack = await post('/api/host/groups', { room:p.room, hostKey:p.hostKey, n:6 });
  check('growing back after a shrink restores a full spread of homelands', () => {
    assert.ok(!growBack.error, 'growing back was refused: ' + growBack.error);
    assert.strictEqual(growBack.roster.length, 6);
    const lands = growBack.roster.map(r => r.homeland);
    assert.strictEqual(new Set(lands).size, 6,
      'shrink-then-grow left two groups sharing a homeland — the deal does not self-heal');
  });

  /* Pinning the defence the provisioning route depends on: freeCode() must
     exclude BOTH the live code index and the published-id index. Deleting
     either exclusion still leaves every check above passing (a forced
     collision cannot be produced from outside the process without seeding
     Math.random), so the mechanism itself has to be pinned by source. */
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const freeCodeBlock = /function freeCode\(n\)\{.*\}/.exec(serverSrc);
  check('freeCode excludes both live codes and published ids', () => {
    assert.ok(freeCodeBlock, 'could not find freeCode() in server.js');
    assert.ok(/CODES\.has\(c\)/.test(freeCodeBlock[0]),
      'freeCode() no longer excludes CODES — a freshly minted code could collide with a code already live in another room');
    assert.ok(/PIDS\.has\(c\)/.test(freeCodeBlock[0]),
      'freeCode() no longer excludes PIDS — a freshly minted code could equal a public id already published on a leaderboard');
  });
  const freePidBlock = /function freePid\(\)\{.*\}/.exec(serverSrc);
  check('freePid excludes both live codes and published ids, and reserves', () => {
    assert.ok(freePidBlock, 'could not find freePid() in server.js');
    assert.ok(/CODES\.has\(c\)/.test(freePidBlock[0]) && /PIDS\.has\(c\)/.test(freePidBlock[0]),
      'freePid() no longer excludes both CODES and PIDS');
    assert.ok(/PIDS\.add\(c\)/.test(freePidBlock[0]),
      'freePid() no longer reserves the pid it draws — a second draw in the same provisioning loop could repeat it');
  });

  /* Pinning the ordering fix itself: regRoom() (which registers a room's own
     codes) must run before migrateRoom() (which can mint a pid via
     freePid()) on both entry points that can hand a room back with a team
     missing a pid — a full restart, and a teacher's backup import. Getting
     this backwards is exactly what let a freshly minted pid equal one of the
     room's own live leader codes. */
  const restoreBlock = /function restore\(\)\{[\s\S]*?\n\}/.exec(serverSrc);
  check('restore() registers a room\'s codes before migrating it', () => {
    assert.ok(restoreBlock, 'could not find restore() in server.js');
    const order = restoreBlock[0];
    const iReg = order.indexOf('regRoom(r)');
    const iMig = order.indexOf('migrateRoom(r)');
    assert.ok(iReg !== -1 && iMig !== -1, 'restore() no longer calls both regRoom(r) and migrateRoom(r)');
    assert.ok(iReg < iMig, 'restore() migrates a room before its own codes are registered — a minted pid could collide with one of them');
  });
  const importBlock = /'POST \/api\/host\/import': async \(b\) => \{[\s\S]*?\n  \},/.exec(serverSrc);
  check('host/import registers a room\'s codes before migrating it', () => {
    assert.ok(importBlock, 'could not find the /api/host/import route in server.js');
    const order = importBlock[0];
    const iReg = order.indexOf('regRoom(s)');
    const iMig = order.indexOf('migrateRoom(s)');
    assert.ok(iReg !== -1 && iMig !== -1, 'host/import no longer calls both regRoom(s) and migrateRoom(s)');
    assert.ok(iReg < iMig, 'host/import migrates a room before its own codes are registered — a minted pid could collide with one of them');
  });

  /* Review finding I1: Number(undefined)||0, Number(null)||0 and
     Number('six')||0 (NaN) all used to collapse silently to n=1, which the
     shrink branch then treated as a real instruction to delete every group
     above 1 — no error, five already-printed code pairs gone. A dedicated
     room, so this cannot be confused with the shrink/grow room above. */
  const p2 = await post('/api/host/create', { kind:'class' });
  const g2 = await post('/api/host/groups', { room:p2.room, hostKey:p2.hostKey, n:6 });
  check('a second room is provisioned with six groups, to test the n guard against', () => {
    assert.ok(!g2.error, 'setup failed: ' + g2.error);
    assert.strictEqual(g2.roster.length, 6);
  });
  const rosterBefore = await post('/api/host/roster', { room:p2.room, hostKey:p2.hostKey });
  for (const bad of [{}, { n:null }, { n:'' }, { n:'six' }, { n:0 }]) {
    const attempt = await post('/api/host/groups', Object.assign({ room:p2.room, hostKey:p2.hostKey }, bad));
    check(`a call with n=${JSON.stringify(bad.n)} is refused, not silently coerced`, () => {
      assert.ok(attempt.error, `an invalid n (${JSON.stringify(bad.n)}) was silently accepted: ` + JSON.stringify(attempt));
    });
  }
  const rosterAfter = await post('/api/host/roster', { room:p2.room, hostKey:p2.hostKey });
  check('the roster is byte-for-byte unchanged after every invalid n attempt', () => {
    assert.strictEqual(rosterAfter.roster.length, rosterBefore.roster.length,
      'an invalid n destroyed provisioned slots');
    assert.deepStrictEqual(
      rosterAfter.roster.map(r => r.code).sort(),
      rosterBefore.roster.map(r => r.code).sort(),
      'the exact codes on the roster changed after an invalid n attempt — codes already printed on paper are now dead');
  });

  /* Review finding M4: a hall room's countries are meant to arrive by
     migration, not by provisioning — a stray call must not mint empty
     countries there. */
  const hallGroups = await post('/api/host/groups', { room:hall.room, hostKey:hall.hostKey, n:3 });
  check('provisioning a hall room is refused', () => {
    assert.ok(hallGroups.error, 'a hall room accepted /api/host/groups and minted empty countries there');
  });

  /* Review finding M3: migrateRoom() filtered offers against livePids but
     not allies, so an imported backup could carry allies naming nobody in
     the room — a permanent, fabricated bump to roundIncome's ally bonus
     (1 + min(3, allies.length)*0.07 — three fake entries are +21% forever). */
  const fabTeam = Object.assign(E2.blankCountry(), { code:'FABR01', name:'Fabricated', homeland:'delta' });
  fabTeam.meters = E2.foundingMeters(fabTeam);
  fabTeam.pid = 'FABPID'; // a post-pid backup: already has a real pid
  fabTeam.allies = ['GHOST1', 'GHOST2', 'GHOST3']; // resolve to nobody in this room
  /* Final-review finding 5 closed POST /api/host/import's unauthenticated
     write hole: it now requires a LIVE room whose hostKey matches, not just
     any code. Every crafted-room fixture in this file borrows a real room
     from host/create for its code and hostKey below — the crafted state
     (kind, teams, allies, missing fields…) is unchanged, only the route in
     is now the authorised one, exactly like a teacher restoring their own
     open room. */
  const fabHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const fabRoom = {
    code:fabHost.room, hostKey:fabHost.hostKey, kind:'hall', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0, teams:{ FABR01:fabTeam }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const fabImport = await post('/api/host/import', { snapshot: fabRoom });
  check('importing a backup with fabricated allies succeeds', () => {
    assert.ok(!fabImport.error, 'import failed: ' + fabImport.error);
  });
  const fabState = await get('/api/state?code=FABR01');
  check('a fabricated ally naming nobody in the room is dropped on import', () => {
    assert.ok(fabState.team, 'the imported team could not be found');
    assert.deepStrictEqual(fabState.team.allies, [],
      'fabricated allies survived import — permanent ally-bonus inflation');
  });
  check('allyBonus returns to 1 once the fabricated allies are dropped', () => {
    assert.strictEqual(fabState.income && fabState.income.allyBonus, 1,
      'roundIncome still grants a bonus for allies that resolve to nobody');
  });

  /* Re-review "NEW-1": moveTeam()'s one-directional ally bug (final-review
     finding 4, before its own fix) could leave a SAVED room one-sided
     (Alpha.allies=[], Beta.allies=[Alpha's pid]) — and a plain restart or
     re-import does not repair a snapshot that is already corrupted; it just
     migrates it faithfully as found. migrateRoom() now closes that too: an
     asymmetric pair is repaired to mutual on the way in, the same as
     moveTeam() repairs it on the way in for a live migration. */
  const oneSidedX = Object.assign(E2.blankCountry(), { code:'OSIDEX1', name:'Onesidia', homeland:'delta' });
  oneSidedX.meters = E2.foundingMeters(oneSidedX);
  oneSidedX.pid = 'OSIDXPD';
  oneSidedX.allies = ['OSIDYPD']; // names Y...
  const oneSidedY = Object.assign(E2.blankCountry(), { code:'OSIDEY1', name:'Twosidia', homeland:'high' });
  oneSidedY.meters = E2.foundingMeters(oneSidedY);
  oneSidedY.pid = 'OSIDYPD';
  oneSidedY.allies = []; // ...but Y does not name X back — the corrupted, one-sided state
  const oneSidedHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const oneSidedRoom = {
    code:oneSidedHost.room, hostKey:oneSidedHost.hostKey, kind:'hall', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0, teams:{ OSIDEX1:oneSidedX, OSIDEY1:oneSidedY }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const oneSidedImport = await post('/api/host/import', { snapshot: oneSidedRoom });
  check('importing a room with a one-sided (corrupted) alliance succeeds', () => {
    assert.ok(!oneSidedImport.error, 'import failed: ' + oneSidedImport.error);
  });
  const oneSidedXState = await get('/api/state?code=OSIDEX1');
  const oneSidedYState = await get('/api/state?code=OSIDEY1');
  check('migrateRoom repairs a one-sided alliance to mutual, on the side that was missing it', () => {
    assert.ok(oneSidedYState.team.allies.includes('OSIDXPD'),
      'Y still does not name X back after import — a saved one-sided alliance does not repair itself on restore/import');
  });
  check('the side that already named the other is left alone', () => {
    assert.deepStrictEqual(oneSidedXState.team.allies, ['OSIDYPD'],
      'the already-correct side of the alliance was changed by the repair');
  });
  check('both sides now carry the same ally bonus', () => {
    assert.strictEqual(oneSidedXState.income.allyBonus, oneSidedYState.income.allyBonus,
      'a repaired mutual alliance still pays the two sides different ally bonuses');
  });

  /* Round 3 review (MEDIUM): migrateRoom() used to default a missing
     openJoin to true regardless of kind — reachable in one click from the
     console's own Restore-from-file button, and restoring last lesson's
     backup is an entirely normal thing to do on the day. Not a regression
     from this task (the field simply predates openJoin), but reachable
     from the console this task just hardened, so it needed the same fix:
     default from kind, exactly as newRoom() does for a brand-new room. */
  const legacyHallTeam = Object.assign(E2.blankCountry(), { code:'LGCYH1', name:'LegacyHall', homeland:'delta' });
  legacyHallTeam.meters = E2.foundingMeters(legacyHallTeam);
  legacyHallTeam.pid = 'LGCYPID';
  const legacyHallHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const legacyHallRoom = {
    code:legacyHallHost.room, hostKey:legacyHallHost.hostKey, kind:'hall', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0, teams:{ LGCYH1:legacyHallTeam }, offers:[], feed:[],
    // openJoin intentionally absent — simulates a backup saved before the field existed
    practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const legacyImport = await post('/api/host/import', { snapshot: legacyHallRoom });
  check('importing a hall backup that predates openJoin succeeds', () => {
    assert.ok(!legacyImport.error, 'import failed: ' + legacyImport.error);
  });
  const legacyRoomView = await get('/api/room?room=' + legacyHallHost.room);
  check('a hall backup missing openJoin migrates to closed, not open', () => {
    assert.strictEqual(legacyRoomView.kind, 'hall');
    assert.strictEqual(legacyRoomView.openJoin, false, 'a legacy hall backup was restored with joining open');
  });
  const legacySneak = await post('/api/join', { room:legacyHallHost.room, name:'ImportSneak', homeland:'delta' });
  check('a restored legacy hall still cannot be joined by room code', () => {
    assert.ok(legacySneak.error, 'a student minted a country in a hall restored from a pre-openJoin backup');
  });

  // Mirror check: a legacy CLASSROOM backup should still default to open,
  // matching newRoom()'s own default — the fix must key off kind, not just
  // flip the old default to false across the board.
  const legacyClassTeam = Object.assign(E2.blankCountry(), { code:'LGCYC1', name:'', homeland:'delta' });
  legacyClassTeam.meters = E2.foundingMeters(legacyClassTeam);
  legacyClassTeam.pid = 'LGCCPID';
  const legacyClassHost = await post('/api/host/create', { kind:'class' });
  const legacyClassRoom = {
    code:legacyClassHost.room, hostKey:legacyClassHost.hostKey, kind:'class', label:'3E', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0, teams:{ LGCYC1:legacyClassTeam }, offers:[], feed:[],
    practiceLeft:3, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const legacyClassImport = await post('/api/host/import', { snapshot: legacyClassRoom });
  check('importing a classroom backup that predates openJoin succeeds', () => {
    assert.ok(!legacyClassImport.error, 'import failed: ' + legacyClassImport.error);
  });
  const legacyClassView = await get('/api/room?room=' + legacyClassHost.room);
  check('a classroom backup missing openJoin migrates to open, matching a freshly created classroom', () => {
    assert.strictEqual(legacyClassView.openJoin, true, 'a legacy classroom backup was restored closed to joining');
  });

  /* -------- final-review finding 3: the restore clash message must not tell
     the game master to destroy the live hall. Reproduced exactly as
     described: a classroom group ("Gamma") commits and migrates to the
     hall; the teacher then tries to restore a BACKUP OF THE CLASSROOM taken
     before that migration — its snapshot still lists Gamma under the
     classroom, and Gamma's code now belongs to the hall. The old message
     named the clashing room and said "Close that room first" — sound advice
     for two classrooms sharing a stale code, catastrophic when the clash is
     the hall with hundreds of students in it. -------- */
  /* Gamma's classroom must be one /api/admin/rooms actually issued (stamped
     origin:'admin'), not one opened here through /api/host/create (stamped
     origin:'self') — the join-hall guard this branch added now correctly
     refuses a self-made room's countries, and this whole scenario depends
     on Gamma's migration to the hall genuinely succeeding first. */
  const gammaHost = (await post('/api/admin/rooms', { key:KEY, labels:['Gamma Class'] })).rooms[0];
  const gammaGroups = await post('/api/host/groups', { room:gammaHost.room, hostKey:gammaHost.hostKey, n:1 });
  const gammaCode = gammaGroups.roster[0].code;
  await post('/api/team/save', { code:gammaCode, country:{ name:'Gamma', members:{ leader:'Gam' } } });
  await post('/api/team/commit', { code:gammaCode });
  // A backup taken right now, before Gamma migrates — this is what a teacher
  // restoring "last lesson's backup" would actually be holding.
  const gammaBackup = await get(`/api/host/export?room=${gammaHost.room}&hostKey=${gammaHost.hostKey}`);
  const massHall = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const gammaMigrate = await post('/api/team/join-hall', { code:gammaCode, room:massHall.room });
  check('Gamma genuinely migrated to the hall before the restore attempt', () => {
    assert.ok(!gammaMigrate.error, 'the setup for this test failed to migrate Gamma: ' + gammaMigrate.error);
  });

  /* The join-hall guard itself, pinned by exact string, in the same file
     that used to build its stranded-country fixture from a self-made room
     without noticing the door students actually walk through was
     unguarded. A country from a room opened at /host (origin:'self') must
     be refused, not silently let through. */
  const selfMade = await post('/api/host/create', { kind:'class', label:'Self-Opened' });
  const selfGroups = await post('/api/host/groups', { room:selfMade.room, hostKey:selfMade.hostKey, n:1 });
  const selfCode = selfGroups.roster[0].code;
  await post('/api/team/save', { code:selfCode, country:{ name:'Selfland', members:{ leader:'Sel' } } });
  await post('/api/team/commit', { code:selfCode });
  const selfJoinAttempt = await post('/api/team/join-hall', { code:selfCode, room:massHall.room });
  check('a country from a self-made room is refused by join-hall with the exact provenance message', () => {
    assert.strictEqual(selfJoinAttempt.error, 'That country is not from a registered class room.');
  });
  const gammaRestore = await post('/api/host/import', { snapshot: gammaBackup.snapshot });
  check('restoring a classroom backup whose group has since moved to the hall is refused', () => {
    assert.ok(gammaRestore.error, 'a stale classroom backup silently repointed a country the hall already has');
  });
  check('the refusal names the group, not just a room code', () => {
    assert.ok(/Gamma/.test(gammaRestore.error),
      'the restore refusal does not name the group whose code clashed: ' + gammaRestore.error);
  });
  check('the refusal identifies the clash as the hall, not merely "another room"', () => {
    assert.ok(/\bhall\b/i.test(gammaRestore.error),
      'the refusal does not tell the teacher the clash is specifically the live hall: ' + gammaRestore.error);
  });
  check('the refusal says nothing was changed', () => {
    assert.ok(/nothing was changed/i.test(gammaRestore.error),
      'the refusal does not reassure the teacher that the restore attempt itself did nothing: ' + gammaRestore.error);
  });
  check('the refusal never tells the teacher to close another room — that is the destructive instruction that reached "reset" on the live hall in the reviewer\'s reproduction', () => {
    assert.ok(!/close/i.test(gammaRestore.error),
      'the refusal still tells the teacher to "close" something — that sentence, followed literally, is what destroyed the live hall: ' + gammaRestore.error);
  });
  const hallStillUp = await get('/api/room?room=' + massHall.room);
  check('the live hall was never touched by the refused restore attempt', () => {
    assert.ok(!hallStillUp.error, 'the hall room no longer exists after the refused restore');
    assert.strictEqual(hallStillUp.count, 1, 'the hall\'s country count changed after a restore that should have changed nothing');
  });

  /* -------- final-review finding 6: four of the five host/* authorisation
     checks (roster, export, act, groups) had no assertion anywhere pinning
     that a wrong host key is refused — replacing each `if(b.hostKey !==
     room.hostKey)` with `if(false)` left all 396 assertions in this suite
     green. Every route is correct at runtime today; this closes the test
     gap on the one authorisation boundary this whole branch invented, and
     the one nobody had watched fail. One fresh room, one wrong key per
     route, plus a single revision check proving none of the four attempts
     mutated anything (host/act's 'reset' branch is the sharpest of these —
     a wrong key accepting it would delete the room outright). -------- */
  const authRoom = await post('/api/host/create', { kind:'class', label:'AuthCheck' });
  const WRONG = 'not-the-real-host-key';

  const rosterWrong = await post('/api/host/roster', { room:authRoom.room, hostKey:WRONG });
  check('host/roster refuses a wrong host key', () => {
    assert.ok(rosterWrong.error, 'host/roster answered a request with the wrong host key — every leader code, class code and pid in the room would leak');
  });

  const exportWrong = await get(`/api/host/export?room=${authRoom.room}&hostKey=${WRONG}`);
  check('host/export refuses a wrong host key', () => {
    assert.ok(exportWrong.error, 'host/export answered a request with the wrong host key — the full snapshot, including the real hostKey and every code, would leak');
  });

  const actWrong = await post('/api/host/act', { room:authRoom.room, hostKey:WRONG, act:'finish' });
  check('host/act refuses a wrong host key', () => {
    assert.ok(actWrong.error, 'host/act answered a request with the wrong host key');
  });
  const beforeReset = await get('/api/room?room=' + authRoom.room);
  const actWrongReset = await post('/api/host/act', { room:authRoom.room, hostKey:WRONG, act:'reset' });
  check('host/act refuses a wrong host key even for the destructive reset action', () => {
    assert.ok(actWrongReset.error, 'host/act accepted a "reset" from the wrong host key — this deletes the room outright');
  });
  const afterReset = await get('/api/room?room=' + authRoom.room);
  check('the room still exists after the refused reset attempt', () => {
    assert.ok(!afterReset.error, 'the room was dropped despite the reset attempt using the wrong host key');
    assert.strictEqual(afterReset.__etag, beforeReset.__etag, 'the room revision changed despite the reset attempt being refused');
  });

  const groupsWrong = await post('/api/host/groups', { room:authRoom.room, hostKey:WRONG, n:5 });
  check('host/groups refuses a wrong host key', () => {
    assert.ok(groupsWrong.error, 'host/groups answered a request with the wrong host key — provisioning can create or delete slots');
  });

  const afterAllAuthChecks = await get('/api/room?room=' + authRoom.room);
  check('none of the four wrong-key attempts above changed the room at all', () => {
    assert.strictEqual(afterAllAuthChecks.__etag, beforeReset.__etag,
      'the room revision changed after a run of refused wrong-host-key attempts — something mutated the room despite every check being refused');
    assert.strictEqual(afterAllAuthChecks.slots, 0, 'host/groups provisioned slots under a wrong host key');
  });

  if (!ran) console.error('FAIL  rooms.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  rooms — kind, label, openJoin, practiceLeft, and the mass-game guard');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
