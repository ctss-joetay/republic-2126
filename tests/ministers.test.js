/* Four more codes per country, one per ministry. This file is the server half.

   The bug this exists to prevent has already happened once, to viewCode:
   /api/host/groups minted it and /api/join did not, so a group who made their
   own country had nothing to hand round but the code that drives it. Every
   credential in this game has to be minted at EVERY door or it is minted at
   none. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
// /api/team/join-hall only accepts a country from a room /api/admin/rooms
// issued (origin:'admin') — trusted(), same as rooms.test.js and
// provenance.test.js already rely on for this exact migration sequence.
const KEY = 'a-very-long-admin-key-for-ministers-tests';
const PORT = 3341;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-ministers-'));
const MIN = ['edu', 'def', 'trade', 'infra'];

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, ADMIN_KEY: KEY, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
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

  /* ---------- door one: the teacher provisions a class ---------- */
  const r = await post('/api/host/create', { kind:'class', label:'3G' });
  const g = await post('/api/host/groups', { room:r.room, hostKey:r.hostKey, n:2 });
  const one = g.roster[0], two = g.roster[1];

  check('a provisioned country carries four ministry codes', () => {
    assert.ok(one.minCodes, 'no minCodes on the provisioned country at all');
    for (const m of MIN) {
      assert.strictEqual(typeof one.minCodes[m], 'string');
      assert.strictEqual(one.minCodes[m].length, 5, `${m}'s code is not five letters`);
    }
  });

  check('all six of a country\'s codes are different from each other', () => {
    const all = [one.code, one.viewCode, one.pid, ...MIN.map(m => one.minCodes[m])];
    assert.strictEqual(new Set(all).size, all.length,
      'a country was minted two identical codes — one of them is a live credential on the leaderboard');
  });

  check('no two countries share a ministry code', () => {
    const a = MIN.map(m => one.minCodes[m]), b = MIN.map(m => two.minCodes[m]);
    assert.strictEqual(new Set([...a, ...b]).size, 8, 'two countries were minted the same ministry code');
  });

  /* This only proves the code resolves to the right country — NOT that
     /api/state reports the ministry's own role back. That role echo
     (st.role === m) is Task 4's to assert: today GET /api/state still
     collapses every non-view role to 'leader', and widening that is a
     redaction change with its own test, in its own commit. */
  for (const m of MIN) {
    const st = await get('/api/state?code=' + one.minCodes[m]);
    check(`the ${m} code opens its own country`, () => {
      assert.ok(!st.error, `${m}'s code opened nothing: ${st.error}`);
      /* pid, not name — a freshly provisioned country has no name yet, so an
         empty string would match trivially. pid is unique and already minted
         by this point, so equality here actually proves the code opened
         ONE's own country and not some other team's. */
      assert.strictEqual(st.team.pid, one.pid);
    });
  }

  /* ---------- door two: a group makes its own country ---------- */
  const openRoom = await openClassRoom(post, { label:'3H' });
  const joined = await post('/api/join', { room:openRoom.room, name:'Selfmade', homeland:'delta' });
  const openRoster = await post('/api/host/roster', { room:openRoom.room, hostKey:openRoom.hostKey });
  const selfMade = (openRoster.roster || []).find(t => t.code === joined.code);

  check('a country made through open joining gets four ministry codes too', () => {
    assert.ok(selfMade, 'the self-made country never reached the roster');
    assert.ok(selfMade.minCodes, 'a self-made country has no ministry codes — its four ministers have nothing to scan');
    for (const m of MIN)
      assert.strictEqual((selfMade.minCodes[m] || '').length, 5, `${m} was not minted at the join door`);
  });

  check('a self-made country\'s ministry codes are its own', () => {
    const mine = MIN.map(m => selfMade.minCodes[m]);
    const theirs = MIN.map(m => one.minCodes[m]);
    assert.strictEqual(new Set([...mine, ...theirs, selfMade.code, selfMade.pid]).size, 10,
      'a self-made country was minted a code that already belonged to something else');
  });

  /* ---------- migrating a committed country into the hall ---------- */
  /* moveTeam() (called by both /api/team/join-hall, the door ~300 students
     actually walk through, and pullCountry(), the teacher's rescue console)
     calls unregTeam() on the way out, which now deletes all six codes from
     CODES — not just the leader and class code. If moveTeam() only
     re-registers the leader and class code at the destination room, a
     country's four ministry codes go dead the instant it arrives in the
     hall — exactly where the Trade and Defence ministers start mattering. */
  const migHost = (await post('/api/admin/rooms', { key:KEY, labels:['Migrating Class'] })).rooms[0];
  const migGroups = await post('/api/host/groups', { room:migHost.room, hostKey:migHost.hostKey, n:1 });
  const migrant = migGroups.roster[0];
  await post('/api/team/save', { code:migrant.code, country:{ name:'Migrantia', members:{ leader:'Mig' } } });
  const migCommit = await post('/api/team/commit', { code:migrant.code });
  check('the migrating country committed cleanly, so the migration itself is what is under test', () => {
    assert.ok(!migCommit.error, 'setup failed to commit the migrating country: ' + migCommit.error);
  });
  const migHall = await post('/api/host/create', { kind:'hall', key:HALL_PASS });
  const migMove = await post('/api/team/join-hall', { code:migrant.code, room:migHall.room });
  check('the migrating country actually reached the hall', () => {
    assert.ok(!migMove.error, 'join-hall refused the migration: ' + migMove.error);
  });
  const migOpened = [];
  for (const m of MIN) migOpened.push(await get('/api/state?code=' + migrant.minCodes[m]));
  check('all four ministry codes still open the country after it migrates to the hall', () => {
    for (let i = 0; i < MIN.length; i++)
      assert.ok(!migOpened[i].error,
        `${MIN[i]}'s code stopped working the moment the country reached the hall: ${migOpened[i].error}`);
  });

  /* ---------- shrinking a class must not leave live codes behind ---------- */
  const shrinkRoom = await post('/api/host/create', { kind:'class', label:'3J' });
  const sg = await post('/api/host/groups', { room:shrinkRoom.room, hostKey:shrinkRoom.hostKey, n:3 });
  const doomed = sg.roster[2];
  await post('/api/host/groups', { room:shrinkRoom.room, hostKey:shrinkRoom.hostKey, n:2 });
  const orphans = [];
  for (const m of MIN) orphans.push(await get('/api/state?code=' + doomed.minCodes[m]));
  /* NOT coverage of unregTeam() itself — findTeam()'s self-heal deletes a
     CODES entry that points at a team room.teams no longer has and answers
     "Country code not found." whether or not unregTeam() ever ran, so this
     route alone cannot tell the two apart. This only proves what a student
     sees: a removed country's codes are unreachable. unregTeam()'s own
     effect on CODES is asserted directly, in-process, in
     tests/minister-roles.test.js. */
  check('a removed country is unreachable through its ministry codes', () => {
    for (let i = 0; i < MIN.length; i++)
      assert.ok(orphans[i].error,
        `${MIN[i]}'s code still opens a country that was removed from the class`);
  });

  /* ---------- a country saved before any of this existed ---------- */
  /* Every country in the 7 August export is one of these. Without a backfill
     they come back with four dead codes, and the teacher discovers it on the
     morning of the next event. */
  /* /api/host/import needs the room's own host key, which a made-up snapshot
     has no way to know. Create the room first, then import over it — the same
     sequence a teacher restoring yesterday's file follows. */
  const legacyRoom = await post('/api/host/create', { kind:'class', label:'3K' });
  /* A real pre-ministries export still has every OTHER field blankCountry()
     has always set — picks, meters, industries, and the rest all predate
     minCodes by a long way. Built from blankCountry() itself, with minCodes
     stripped back out, so this snapshot is missing exactly the one thing a
     genuinely old file is missing, not a hand-picked handful of fields that
     would make roundIncome() (called by GET /api/state below) crash on
     something this test isn't about. */
  const legacyTeam = { ...E.blankCountry(), code:'AAAAA', viewCode:'BBBBB', pid:'CCCCC', slot:1,
                        name:'Oldland', homeland:'delta' };
  delete legacyTeam.minCodes;
  const legacySnap = {
    kind:'class', code:legacyRoom.room, hostKey:legacyRoom.hostKey, label:'3K', phase:'prep', round:0,
    feed: [], offers: [],
    teams: { AAAAA: legacyTeam }
  };
  const imported = await post('/api/host/import',
    { room:legacyRoom.room, hostKey:legacyRoom.hostKey, snapshot:legacySnap });
  check('importing a country from before ministries mints its four codes', () => {
    assert.ok(!imported.error, 'the import was refused: ' + imported.error);
  });
  const backRoster = await post('/api/host/roster',
    { room:legacyRoom.room, hostKey:legacyRoom.hostKey });
  const revived = (backRoster.roster || []).find(t => t.name === 'Oldland');
  check('a backfilled country has four ministry codes', () => {
    assert.ok(revived, 'the imported country never reached the roster');
    for (const m of MIN)
      assert.strictEqual((revived.minCodes && revived.minCodes[m] || '').length, 5,
        `${m} was not backfilled — that ministry's iPad opens nothing`);
  });
  const backOpen = revived ? await get('/api/state?code=' + revived.minCodes.edu) : null;
  check('a backfilled ministry code actually opens the country', () => {
    assert.ok(backOpen && !backOpen.error, 'the backfilled code was minted but never registered');
    /* pid, not role — same discipline as the door-one checks further up this
       file (see the comment there): GET /api/state still collapses every
       non-view role to 'leader', and this file deliberately does not assert
       role for that reason. That widening is Task 4's, with its own role
       assertions in its own tests. pid is unique and already known (the
       snapshot fixed it at 'CCCCC'), so equality here proves the backfilled
       code opened Oldland specifically, not merely some country. */
    assert.strictEqual(backOpen.team.pid, 'CCCCC');
    assert.strictEqual(backOpen.team.name, 'Oldland');
  });

  /* ---------- a country half-repaired by an interrupted earlier load ---------- */
  /* The backfill loop in migrateRoom() guards each ministry independently
     (`if(!t.minCodes[m])`), not the whole minCodes object at once — so a
     country that already picked up SOME of its four codes (an earlier
     restore()/import that got this far and then the process died, or simply
     a generation of the file mid-rollout) must keep exactly the codes it
     already has and only mint the two still missing. A regression that
     collapsed this to an all-or-nothing `if(!t.minCodes)` guard would still
     make every check above pass — four working codes either way — so the
     only way to catch it is to check that the two PRESENT codes come back
     byte-for-byte unchanged, not merely present. */
  const partialRoom = await post('/api/host/create', { kind:'class', label:'3L' });
  const partialTeam = { ...E.blankCountry(), code:'PARTL', viewCode:'PARTV', pid:'PARTP', slot:1,
                         name:'Halfland', homeland:'delta' };
  partialTeam.minCodes = { edu:'EDUAA', trade:'TRDAA' };   // def, infra: genuinely absent keys
  const partialSnap = {
    kind:'class', code:partialRoom.room, hostKey:partialRoom.hostKey, label:'3L', phase:'prep', round:0,
    feed: [], offers: [],
    teams: { PARTL: partialTeam }
  };
  const partialImported = await post('/api/host/import',
    { room:partialRoom.room, hostKey:partialRoom.hostKey, snapshot:partialSnap });
  check('a partially-repaired country imports cleanly', () => {
    assert.ok(!partialImported.error, 'the import was refused: ' + partialImported.error);
  });
  const partialRoster = await post('/api/host/roster',
    { room:partialRoom.room, hostKey:partialRoom.hostKey });
  const halfland = (partialRoster.roster || []).find(t => t.name === 'Halfland');
  check('the two codes it already had come back byte-for-byte unchanged', () => {
    assert.ok(halfland, 'the partially-repaired country never reached the roster');
    assert.strictEqual(halfland.minCodes.edu, 'EDUAA', 'edu was reminted even though it already had a code');
    assert.strictEqual(halfland.minCodes.trade, 'TRDAA', 'trade was reminted even though it already had a code');
  });
  check('the two it was missing were freshly minted, five letters each', () => {
    assert.strictEqual((halfland.minCodes.def || '').length, 5, 'def was left dead — its guard fired on the whole object, not its own key');
    assert.strictEqual((halfland.minCodes.infra || '').length, 5, 'infra was left dead — its guard fired on the whole object, not its own key');
  });
  check('all four ministry codes, on a partially-repaired country, are distinct from each other and from its other codes', () => {
    const all = [halfland.code, halfland.viewCode, halfland.pid,
                 halfland.minCodes.edu, halfland.minCodes.def, halfland.minCodes.trade, halfland.minCodes.infra];
    assert.strictEqual(new Set(all).size, all.length, 'a partial repair minted a code that collided with one already live');
  });
  const halfOpenOld = await get('/api/state?code=' + halfland.minCodes.edu);
  const halfOpenNew = await get('/api/state?code=' + halfland.minCodes.def);
  check('both the untouched and the freshly minted ministry codes actually open the country', () => {
    assert.ok(!halfOpenOld.error, `edu — the code that was already there — opened nothing: ${halfOpenOld.error}`);
    assert.strictEqual(halfOpenOld.team.pid, 'PARTP');
    assert.ok(!halfOpenNew.error, `def — the freshly minted code — opened nothing: ${halfOpenNew.error}`);
    assert.strictEqual(halfOpenNew.team.pid, 'PARTP');
  });

  /* ---------- a country that already has all four: the no-op case ---------- */
  const wholeRoom = await post('/api/host/create', { kind:'class', label:'3M' });
  const wholeTeam = { ...E.blankCountry(), code:'WHOLE', viewCode:'WHOLV', pid:'WHOLP', slot:1,
                       name:'Fullland', homeland:'delta' };
  wholeTeam.minCodes = { edu:'EDUCC', def:'DEFCC', trade:'TRACC', infra:'NFRCC' };
  const wholeSnap = {
    kind:'class', code:wholeRoom.room, hostKey:wholeRoom.hostKey, label:'3M', phase:'prep', round:0,
    feed: [], offers: [],
    teams: { WHOLE: wholeTeam }
  };
  const wholeImported = await post('/api/host/import',
    { room:wholeRoom.room, hostKey:wholeRoom.hostKey, snapshot:wholeSnap });
  check('a country that already carries all four codes imports cleanly', () => {
    assert.ok(!wholeImported.error, 'the import was refused: ' + wholeImported.error);
  });
  const wholeRoster = await post('/api/host/roster',
    { room:wholeRoom.room, hostKey:wholeRoom.hostKey });
  const fullland = (wholeRoster.roster || []).find(t => t.name === 'Fullland');
  check('a country with all four codes already has none of them touched', () => {
    assert.ok(fullland, 'the fully-provisioned country never reached the roster');
    assert.strictEqual(fullland.minCodes.edu, 'EDUCC');
    assert.strictEqual(fullland.minCodes.def, 'DEFCC');
    assert.strictEqual(fullland.minCodes.trade, 'TRACC');
    assert.strictEqual(fullland.minCodes.infra, 'NFRCC');
  });

  /* ---------- redaction ---------- */
  /* The role split is theatre if a device is handed the credentials it is
     being kept away from. roles.test.js proved this for the class code; with
     six codes the rule is the general one — you receive the code you arrived
     with and nothing else. */
  const bodies = {
    leader: await get('/api/state?code=' + one.code),
    member: await get('/api/state?code=' + one.viewCode)
  };
  for (const m of MIN) bodies[m] = await get('/api/state?code=' + one.minCodes[m]);

  const everyCode = { leader:one.code, member:one.viewCode,
                      ...Object.fromEntries(MIN.map(m => [m, one.minCodes[m]])) };

  for (const [who, body] of Object.entries(bodies)) {
    /* The leader is the documented exception, twice over: they read the
       class code and the ministry codes out to their group. A row for the
       leader here would either be vacuous (skip the body and still print
       PASS) or fail by design, so it is left out entirely — the positive
       assertion for the leader's two exempt codes is
       'the leader keeps the two codes they read out', below. */
    if (who === 'leader') continue;
    check(`a ${who} device receives no code but its own`, () => {
      const json = JSON.stringify(body);
      for (const [other, codeVal] of Object.entries(everyCode)) {
        if (other === who) continue;
        assert.ok(!json.includes(codeVal),
          `a ${who} device was handed ${other}'s code — the split is theatre`);
      }
    });
  }

  check('a ministry device is told which ministry it is', () => {
    for (const m of MIN) assert.strictEqual(bodies[m].role, m);
    assert.strictEqual(bodies.leader.role, 'leader');
    assert.strictEqual(bodies.member.role, 'member');
  });

  check('a ministry device sees its own code where the country\'s code goes', () => {
    for (const m of MIN)
      assert.strictEqual(bodies[m].team.code, one.minCodes[m],
        `${m}'s device got something other than its own code in team.code`);
  });

  check('a ministry device still sees the country it belongs to', () => {
    /* pid, not name — same discipline as the door-one checks earlier in this
       file: a freshly provisioned country has no name yet, so comparing
       name would be "" === "" on both sides and pass no matter which
       country a ministry code actually resolved to. pid is unique and
       already minted by this point, so equality here actually proves the
       ministry code opened ONE's own country and not some other team's. */
    for (const m of MIN)
      assert.strictEqual(bodies[m].team.pid, bodies.leader.team.pid,
        `${m}'s device resolved to a different country than its own leader`);
  });

  check('the leader keeps the two codes they read out', () => {
    assert.strictEqual(bodies.leader.team.viewCode, one.viewCode);
    for (const m of MIN)
      assert.strictEqual(bodies.leader.team.minCodes[m], one.minCodes[m],
        `the leader cannot reissue ${m}'s code when a slip goes missing`);
  });

  /* ---------- the point of the whole feature ---------- */
  /* Two ministers saving independently. Under `team.picks = c.picks` the
     second call wipes the first, silently, and a group loses a ministry's
     cards with no error anywhere. */
  const P = await post('/api/host/create', { kind:'class', label:'3L' });
  const pg = await post('/api/host/groups', { room:P.room, hostKey:P.hostKey, n:1 });
  const co = pg.roster[0];
  await post('/api/team/save', { code:co.code, country:{ name:'Concordia',
    members:{ leader:'Ana', edu:'Bo', def:'Cai', trade:'Dee', infra:'Eli' },
    split:{ edu:6, def:6, trade:6, infra:6 } } });

  /* Whatever the decks actually hold — read them from the engine rather than
     hard-coding a key, so this test survives a deck rewrite. `E` is required
     at the top of this file, beside the other requires. */
  const cheapest = (m) => E.CARDS[m].slice().sort((a,b)=>a.cost-b.cost)[0].key;

  const eduPick = cheapest('edu'), defPick = cheapest('def');
  await post('/api/team/save', { code:co.minCodes.edu,  country:{ picks:{ edu:[eduPick] } } });
  await post('/api/team/save', { code:co.minCodes.def,  country:{ picks:{ def:[defPick] } } });
  const both = await get('/api/state?code=' + co.code);
  check('two ministers saving in turn both keep their cards', () => {
    assert.deepStrictEqual(both.team.picks.edu, [eduPick],
      'Education\'s card was wiped by Defence\'s save');
    assert.deepStrictEqual(both.team.picks.def, [defPick],
      'Defence\'s card never landed');
  });

  /* The other half: a stale full copy of the country, which is what a real
     device posts on a slow poll. Everything outside the caller's own ministry
     has to be ignored, not applied. */
  const stale = await post('/api/team/save', { code:co.minCodes.edu, country:{
    name:'Hijacked', motto:'mine now',
    members:{ leader:'Nobody' }, split:{ edu:24, def:0, trade:0, infra:0 },
    picks:{ edu:[eduPick], def:[] },
    buildings:{}, industries:{}, ready:true } });
  const after = await get('/api/state?code=' + co.code);
  check('a stale full country from a minister is not an error', () => {
    assert.ok(!stale.error, 'a normal autosave was refused: ' + stale.error);
  });
  check('a minister\'s stale copy changes nothing outside its ministry', () => {
    assert.strictEqual(after.team.name, 'Concordia', 'a minister renamed the country');
    assert.strictEqual(after.team.motto, '', 'a minister wrote the motto');
    assert.strictEqual(after.team.members.leader, 'Ana', 'a minister rewrote the cabinet');
    assert.strictEqual(after.team.split.edu, 6, 'a minister rewrote their own budget');
    assert.deepStrictEqual(after.team.picks.def, [defPick],
      'a minister wiped another ministry\'s cards through a stale copy');
    assert.strictEqual(after.team.ready, false, 'a minister declared the country ready');
  });

  const bKey = E.BUILDINGS[0].key;
  await post('/api/team/save', { code:co.minCodes.trade, country:{ buildings:{ [bKey]:1 } } });
  const noBuild = await get('/api/state?code=' + co.code);
  check('Trade & Industry cannot build', () => {
    assert.ok(!noBuild.team.buildings[bKey], 'the Trade Minister put up a building');
  });
  await post('/api/team/save', { code:co.minCodes.infra, country:{ buildings:{ [bKey]:1 } } });
  const didBuild = await get('/api/state?code=' + co.code);
  check('Infrastructure can build', () => {
    assert.strictEqual(didBuild.team.buildings[bKey], 1,
      'the Infrastructure Minister was refused the one thing that ministry does');
  });

  const viewSave = await post('/api/team/save',
    { code:co.viewCode, country:{ picks:{ edu:[] } } });
  check('a class code is refused, not silently ignored', () => {
    assert.ok(viewSave.error, 'a watching device was allowed to save');
  });

  const leaderAll = await post('/api/team/save', { code:co.code, country:{
    motto:'Ad astra', picks:{ edu:[eduPick], def:[defPick] } } });
  const asLeaderNow = await get('/api/state?code=' + co.code);
  check('the leader is still a superset', () => {
    assert.ok(!leaderAll.error, 'the leader was refused: ' + leaderAll.error);
    assert.strictEqual(asLeaderNow.team.motto, 'Ad astra');
    assert.deepStrictEqual(asLeaderNow.team.picks.edu, [eduPick]);
    assert.deepStrictEqual(asLeaderNow.team.picks.def, [defPick]);
  });

  /* ---------- a ministry cannot outspend its budget ---------- */
  /* The cap has always been a browser check. On one iPad that was tolerable;
     with four ministers saving independently it is the only thing that makes
     the leader's point split mean anything. */
  const B = await post('/api/host/create', { kind:'class', label:'3M' });
  const bgr = await post('/api/host/groups', { room:B.room, hostKey:B.hostKey, n:1 });
  const bc = bgr.roster[0];
  await post('/api/team/save', { code:bc.code, country:{ name:'Frugalia',
    members:{ leader:'Ana' }, split:{ edu:1, def:11, trade:6, infra:6 } } });

  const dear = E.CARDS.edu.slice().sort((a,b)=>b.cost-a.cost)[0];
  const over = await post('/api/team/save',
    { code:bc.minCodes.edu, country:{ picks:{ edu:[dear.key] } } });
  const afterOver = await get('/api/state?code=' + bc.code);
  check('a ministry cannot spend past its budget', () => {
    assert.ok(dear.cost > 1, 'the dearest Education card costs 1 or less — pick a smaller split');
    assert.ok(over.error, 'a minister spent points their ministry did not have');
    assert.deepStrictEqual(afterOver.team.picks.edu, [],
      'the over-budget pick was refused but landed anyway');
  });
  check('the refusal says what went wrong', () => {
    assert.ok(/point/i.test(over.error || ''), 'the refusal does not mention points: ' + over.error);
    assert.ok(!(over.error || '').includes('!'), 'no exclamation marks in student copy');
  });

  const cheap = E.CARDS.def.slice().sort((a,b)=>a.cost-b.cost)[0];
  const within = await post('/api/team/save',
    { code:bc.minCodes.def, country:{ picks:{ def:[cheap.key] } } });
  check('a ministry inside its budget is not blocked by the cap', () => {
    assert.ok(!within.error, 'a legitimate pick was refused: ' + within.error);
  });

  /* ---------- picks contents are validated, not just the field ---------- */
  /* Task 5 checked that the caller owns the key ('edu') and that the value is
     an array, but never what is inside it. A probe could store
     picks:{edu:['__no_such_card__','peace']} verbatim, where 'peace' is a
     Defence card sitting in Education's array — and public/host.html scans
     every ministry's array when it evaluates a scenario's `pick:` condition,
     so a minister could satisfy a condition with another ministry's card key
     at zero cost to their own budget. */
  const defOnly = E.CARDS.def.find(c => !E.CARDS.edu.some(e => e.key === c.key));
  const junk = await post('/api/team/save',
    { code:bc.minCodes.edu, country:{ picks:{ edu:['__no_such_card__', defOnly.key] } } });
  const afterJunk = await get('/api/state?code=' + bc.code);
  check('unknown and foreign-ministry card keys are dropped, not stored', () => {
    assert.ok(defOnly, 'every Defence card also exists in the Education deck — pick a different probe');
    assert.ok(!junk.error, 'a save with junk keys mixed in was refused outright: ' + junk.error);
    assert.deepStrictEqual(afterJunk.team.picks.edu, [],
      'a key nobody recognises, or a real card from a different ministry, survived into Education\'s array');
  });

  /* ---------- a refusal reverts the WHOLE country, not just the field that
     triggered it ---------- */
  /* team is a live reference into room.teams. name, split, and every other
     flat field are written in place BEFORE the picks/industries/buildings
     blocks run. A refusal from one of those later blocks used to snapshot
     and restore only that one field — so a save carrying name, split AND an
     over-budget picks array left the new name and the new (possibly
     invalid) split committed, while only picks bounced back. This is not
     contrived: public/index.html bundles the whole country into every save
     and never inspects the response for .error. */
  const R = await post('/api/host/create', { kind:'class', label:'3R' });
  const rgr = await post('/api/host/groups', { room:R.room, hostKey:R.hostKey, n:1 });
  const rc = rgr.roster[0];
  await post('/api/team/save', { code:rc.code, country:{ name:'Baseline',
    members:{ leader:'Ana' }, split:{ edu:1, def:11, trade:6, infra:6 } } });

  const rDear = E.CARDS.edu.slice().sort((a,b)=>b.cost-a.cost)[0];
  /* edu's split stays at 1 — the whole point is that the dear card is STILL
     over budget after this call, so the save is still refused. Only the
     OTHER three ministries' splits move, to prove even an unrelated split
     change bundled into the same refused call does not land. */
  const refusedPicks = await post('/api/team/save', { code:rc.code, country:{
    name:'RenamedDuringRefusal', split:{ edu:1, def:0, trade:0, infra:0 },
    picks:{ edu:[rDear.key] } } });
  const afterRefusedPicks = await get('/api/state?code=' + rc.code);
  check('a picks refusal leaves name and split exactly as they were, not just picks', () => {
    assert.ok(rDear.cost > 1, 'the dearest Education card costs 1 or less — pick a smaller split');
    assert.ok(refusedPicks.error, 'the over-budget combination was not refused');
    assert.strictEqual(afterRefusedPicks.team.name, 'Baseline',
      'the name landed even though the save that carried it was refused');
    assert.deepStrictEqual(afterRefusedPicks.team.split, { edu:1, def:11, trade:6, infra:6 },
      'the split landed even though the save that carried it was refused');
    assert.deepStrictEqual(afterRefusedPicks.team.picks.edu, [],
      'the over-budget pick landed too');
  });

  /* Same bug, the industries door. mayWrite makes industries the Trade
     Minister's alone and name the Leader's alone, so this call has to come
     from the Leader (a superset of every ministry) to touch both fields at
     once — exactly what a stale full-country autosave from the Leader's own
     device does every time it fires. */
  const industriesPlan = { fact:100 };  // 100 factories: no homeland has 300 Wealth to spend
  const refusedIndustries = await post('/api/team/save', { code:rc.code, country:{
    name:'RenamedDuringIndustriesRefusal', industries:industriesPlan } });
  const afterRefusedIndustries = await get('/api/state?code=' + rc.code);
  check('an industries refusal leaves the name exactly as it was too', () => {
    assert.ok(refusedIndustries.error, 'a 100-factory plan was not refused as unaffordable');
    assert.strictEqual(afterRefusedIndustries.team.name, 'Baseline',
      'the name landed even though the save that carried it was refused');
    assert.deepStrictEqual(afterRefusedIndustries.team.industries, {},
      'the unaffordable industries plan landed too');
  });

  /* Same bug, the buildings door. */
  const rBKey = E.BUILDINGS[0].key;
  const refusedBuildings = await post('/api/team/save', { code:rc.code, country:{
    name:'RenamedDuringBuildingsRefusal', buildings:{ [rBKey]:1000 } } });
  const afterRefusedBuildings = await get('/api/state?code=' + rc.code);
  check('a buildings refusal leaves the name exactly as it was too', () => {
    assert.ok(refusedBuildings.error, 'a 1000-unit building plan was not refused as unaffordable');
    assert.strictEqual(afterRefusedBuildings.team.name, 'Baseline',
      'the name landed even though the save that carried it was refused');
    assert.ok(!afterRefusedBuildings.team.buildings[rBKey],
      'the unaffordable building plan landed too');
  });

  /* ---------- the cap only judges the ministries THIS call actually wrote ---------- */
  /* split carries no validation against current spend — deliberately out of
     scope here. But the cap loop used to walk all four ministries on every
     picks-bearing save regardless of which one the request touched, so a
     Leader lowering split.def below what Defence had already spent poisoned
     every OTHER device's save in the room too: Education saving its own,
     perfectly affordable card got told it overspent a budget it cannot see
     and does not control. */
  const X = await post('/api/host/create', { kind:'class', label:'3X' });
  const xgr = await post('/api/host/groups', { room:X.room, hostKey:X.hostKey, n:1 });
  const xc = xgr.roster[0];
  await post('/api/team/save', { code:xc.code, country:{ name:'Isolatia',
    members:{ leader:'Ana' }, split:{ edu:6, def:6, trade:6, infra:6 } } });

  const xDefCard = E.CARDS.def.slice().sort((a,b)=>a.cost-b.cost)[0];
  await post('/api/team/save', { code:xc.minCodes.def, country:{ picks:{ def:[xDefCard.key] } } });
  /* Lower Defence's split below what Defence already spent. Nothing here
     refuses this — that inconsistency is explicitly out of scope — it just
     leaves Defence over its own cap from this point on. */
  await post('/api/team/save', { code:xc.code, country:{
    split:{ edu:6, def:Math.max(0, xDefCard.cost - 1), trade:6, infra:6 } } });

  const xEduCard = E.CARDS.edu.slice().sort((a,b)=>a.cost-b.cost)[0];
  const eduWhileDefOver = await post('/api/team/save',
    { code:xc.minCodes.edu, country:{ picks:{ edu:[xEduCard.key] } } });
  const afterEduWhileDefOver = await get('/api/state?code=' + xc.code);
  check('a ministry within its own budget saves fine while a different ministry is over its cap', () => {
    assert.ok(!eduWhileDefOver.error,
      'Education was refused for a budget it does not control: ' + eduWhileDefOver.error);
    assert.deepStrictEqual(afterEduWhileDefOver.team.picks.edu, [xEduCard.key],
      'Education\'s legitimate pick did not land');
  });

  /* Probe (b): the Leader posting two ministries in the SAME call, where the
     combination busts one of them, must still be refused — `touched` has to
     include every ministry the request actually wrote, not just the first. */
  const Y = await post('/api/host/create', { kind:'class', label:'3Y' });
  const ygr = await post('/api/host/groups', { room:Y.room, hostKey:Y.hostKey, n:1 });
  const yc = ygr.roster[0];
  await post('/api/team/save', { code:yc.code, country:{ name:'Combo',
    members:{ leader:'Ana' }, split:{ edu:6, def:1, trade:6, infra:6 } } });

  const yEduCard = E.CARDS.edu.slice().sort((a,b)=>a.cost-b.cost)[0];
  const yDefCard = E.CARDS.def.slice().sort((a,b)=>b.cost-a.cost)[0];
  const combo = await post('/api/team/save', { code:yc.code, country:{
    picks:{ edu:[yEduCard.key], def:[yDefCard.key] } } });
  const afterCombo = await get('/api/state?code=' + yc.code);
  check('the Leader posting two ministries at once still cannot bust just one of them', () => {
    assert.ok(yDefCard.cost > 1, 'the dearest Defence card costs 1 or less — pick a smaller split');
    assert.ok(combo.error, 'a combined save that busts Defence alone was not refused');
    assert.deepStrictEqual(afterCombo.team.picks.edu, [],
      'Education\'s pick landed even though the same call busted Defence');
    assert.deepStrictEqual(afterCombo.team.picks.def, [],
      'Defence\'s over-budget pick landed');
  });

  /* ---------- the routes ---------- */
  /* Defence owns alliances, Trade owns goods. That split is what sends two
     kids from two countries to the same corner of the hall to argue, so it is
     enforced on the server — the checkbox on the trade dialog is a convenience,
     not a gate. */
  const H = await post('/api/host/create', { kind:'hall', key:HALL_PASS, label:'Hall' });
  await post('/api/host/act', { room:H.room, hostKey:H.hostKey, act:'phase', phase:'game' });
  const K = await post('/api/host/create', { kind:'class', label:'3N' });
  /* A room opened through /api/host/create is stamped origin:'self' and is
     refused at the hall door until a teacher trusts it from /admin — the same
     path bite-applied.test.js and discussion-minute.test.js use to get a
     committed country into a hall at all. */
  await post('/api/admin/trust', { key:KEY, room:K.room });
  const kg = await post('/api/host/groups', { room:K.room, hostKey:K.hostKey, n:2 });
  const [x, y] = kg.roster;
  for (const t of [x, y]) {
    await post('/api/team/save', { code:t.code, country:{
      name:'C' + t.slot, members:{ leader:'L' + t.slot } } });
    await post('/api/team/commit', { code:t.code });
    await post('/api/team/join-hall', { code:t.code, room:H.room });
  }
  const hx = await get('/api/state?code=' + x.code);
  const hy = await get('/api/state?code=' + y.code);
  const yPid = hy.team.pid;

  const tradeByTrade = await post('/api/trade/offer',
    { code:x.minCodes.trade, to:yPid, give:{F:1}, want:{M:1} });
  check('the Trade Minister may send goods', () => {
    assert.ok(!tradeByTrade.error, 'the Trade Minister was refused a goods offer: ' + tradeByTrade.error);
  });
  const tradeByDef = await post('/api/trade/offer',
    { code:x.minCodes.def, to:yPid, give:{F:1}, want:{M:1} });
  check('the Defence Minister may not send goods', () => {
    assert.ok(tradeByDef.error, 'the Defence Minister sent a goods offer');
    assert.ok(/Trade/.test(tradeByDef.error), 'the refusal does not say who can: ' + tradeByDef.error);
  });
  const allyByTrade = await post('/api/trade/offer',
    { code:x.minCodes.trade, to:yPid, give:{}, want:{}, ally:true });
  check('the Trade Minister may not strike an alliance', () => {
    assert.ok(allyByTrade.error, 'the Trade Minister struck an alliance');
    assert.ok(/Defence/.test(allyByTrade.error), 'the refusal does not say who can: ' + allyByTrade.error);
  });
  const allyByDef = await post('/api/trade/offer',
    { code:x.minCodes.def, to:yPid, give:{}, want:{}, ally:true });
  check('the Defence Minister may propose an alliance with no goods in it', () => {
    assert.ok(!allyByDef.error, 'an alliance-only proposal was refused: ' + allyByDef.error);
    assert.ok(allyByDef.offer && allyByDef.offer.ally, 'the offer did not carry ally');
  });

  /* The same split applies on the receiving end. /api/trade/respond cannot
     know its act until it has found the offer it is answering, so the gate
     sits below the lookup rather than at the top like every other route's —
     but it still has to land on the RIGHT minister for what that offer is. */
  const respondGoodsByDef = await post('/api/trade/respond',
    { code:y.minCodes.def, id:tradeByTrade.offer.id, accept:true });
  check('the Defence Minister may not accept a goods offer', () => {
    assert.ok(respondGoodsByDef.error, 'the Defence Minister accepted a goods offer');
    assert.ok(/Trade/.test(respondGoodsByDef.error), 'the refusal does not say who can: ' + respondGoodsByDef.error);
  });
  const respondAllyByTrade = await post('/api/trade/respond',
    { code:y.minCodes.trade, id:allyByDef.offer.id, accept:true });
  check('the Trade Minister may not accept an alliance offer', () => {
    assert.ok(respondAllyByTrade.error, 'the Trade Minister accepted an alliance offer');
    assert.ok(/Defence/.test(respondAllyByTrade.error), 'the refusal does not say who can: ' + respondAllyByTrade.error);
  });

  const accepted = await post('/api/trade/respond',
    { code:y.minCodes.def, id:allyByDef.offer.id, accept:true });
  const alliedX = await get('/api/state?code=' + x.code);
  const alliedY = await get('/api/state?code=' + y.code);
  check('an alliance with no goods in it is struck, and struck both ways', () => {
    assert.ok(!accepted.error, 'the Defence Minister could not accept an alliance: ' + accepted.error);
    assert.ok((alliedX.team.allies || []).includes(alliedY.team.pid),
      'one side of the alliance is missing');
    assert.ok((alliedY.team.allies || []).includes(alliedX.team.pid),
      'the alliance is one-sided');
  });

  /* A single offer that carries BOTH ally:true and non-zero goods/coins is a
     THIRD act, distinct from either ministry's own — ally:true must not
     silently REPLACE the goods check and hand Defence a way to move
     resources alone, with no Trade Minister anywhere in the room. Only the
     Leader, who holds both acts, may send or accept a combined offer — the
     one-iPad fallback a group that never hands out ministry codes still
     needs. */
  const beforeCombo = await get('/api/state?code=' + x.code);
  const comboByDef = await post('/api/trade/offer',
    { code:x.minCodes.def, to:yPid, give:{F:1}, want:{M:1}, coins:5, ally:true });
  check('the Defence Minister may not send a combined alliance-and-goods offer', () => {
    assert.ok(comboByDef.error, 'the Defence Minister sent a combined offer alone');
  });
  const comboByTrade = await post('/api/trade/offer',
    { code:x.minCodes.trade, to:yPid, give:{F:1}, want:{M:1}, coins:5, ally:true });
  check('the Trade Minister may not send a combined alliance-and-goods offer', () => {
    assert.ok(comboByTrade.error, 'the Trade Minister sent a combined offer alone');
  });
  const afterComboAttempts = await get('/api/state?code=' + x.code);
  check('neither ministry\'s refused combined offer moved stock or coins', () => {
    assert.deepStrictEqual(afterComboAttempts.team.stock, beforeCombo.team.stock,
      'stock moved even though the combined offer was refused');
    assert.strictEqual(afterComboAttempts.team.coins, beforeCombo.team.coins,
      'coins moved even though the combined offer was refused');
  });

  const comboByLeader = await post('/api/trade/offer',
    { code:x.code, to:yPid, give:{F:1}, want:{M:1}, coins:5, ally:true });
  check('the Leader may still send the combined offer — the one-iPad fallback', () => {
    assert.ok(!comboByLeader.error, 'the Leader was refused a combined offer: ' + comboByLeader.error);
    assert.ok(comboByLeader.offer && comboByLeader.offer.ally, 'the combined offer lost its ally flag');
  });

  const comboRespondByDef = await post('/api/trade/respond',
    { code:y.minCodes.def, id:comboByLeader.offer.id, accept:true });
  check('a ministry cannot accept a combined offer, not even the ministry that owns half of it', () => {
    assert.ok(comboRespondByDef.error, 'the Defence Minister accepted a combined offer');
  });
  const comboRespondByTrade = await post('/api/trade/respond',
    { code:y.minCodes.trade, id:comboByLeader.offer.id, accept:true });
  check('the other ministry cannot accept a combined offer either', () => {
    assert.ok(comboRespondByTrade.error, 'the Trade Minister accepted a combined offer');
  });

  const beforeComboAccept = await get('/api/state?code=' + x.code);
  const comboAccepted = await post('/api/trade/respond',
    { code:y.code, id:comboByLeader.offer.id, accept:true });
  const afterComboX = await get('/api/state?code=' + x.code);
  const afterComboY = await get('/api/state?code=' + y.code);
  check('the Leader can accept a combined offer, and both halves actually move', () => {
    assert.ok(!comboAccepted.error, 'the Leader could not accept a combined offer: ' + comboAccepted.error);
    assert.ok((afterComboX.team.allies || []).includes(afterComboY.team.pid) &&
              (afterComboY.team.allies || []).includes(afterComboX.team.pid),
      'the combined offer did not strike the alliance');
    assert.strictEqual(afterComboX.team.coins, beforeComboAccept.team.coins - 5,
      'the coins in the combined offer did not move');
    assert.strictEqual(afterComboX.team.stock.F, beforeComboAccept.team.stock.F - 1,
      'the goods in the combined offer did not move');
  });

  /* Negative quantities. /api/trade/offer used to parse give/want with no
     lower clamp (coins already had one — Math.max(0, +b.coins||0) — give
     and want did not), so a negative give was not a trade, it was a
     withdrawal from the other country: /api/trade/respond's transfer
     (`from.stock[k] = ... - offer.give[k] + offer.want[k]`) runs backwards
     under a negative value, and the only affordability guard on creation
     (`give[k] > 0 && give[k] > fr[k]`) only ever tests the positive branch,
     so it never sees a negative coming. Pre-existing on main, not something
     ministries introduced — see the report. Clamped give/want the same way
     coins already was. */
  const beforeNegGive = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  const negGiveOffer = await post('/api/trade/offer',
    { code:x.minCodes.trade, to:yPid, give:{W:-5}, want:{} });
  check('a negative give is clamped to zero, not sent as a withdrawal', () => {
    assert.ok(!negGiveOffer.error, 'a harmless negative-give offer was refused outright: ' + negGiveOffer.error);
    assert.strictEqual(negGiveOffer.offer && negGiveOffer.offer.give.W, 0,
      'the negative give reached the stored offer unclamped');
  });
  const negGiveAccepted = await post('/api/trade/respond', { code:y.minCodes.trade, id:negGiveOffer.offer.id, accept:true });
  const afterNegGive = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  check('accepting a negative-give offer moves nothing, for either country', () => {
    assert.ok(!negGiveAccepted.error, 'the clamped offer could not even be accepted: ' + negGiveAccepted.error);
    assert.strictEqual(afterNegGive.x.team.stock.W, beforeNegGive.x.team.stock.W,
      'the sender\'s stock moved from a negative give');
    assert.strictEqual(afterNegGive.y.team.stock.W, beforeNegGive.y.team.stock.W,
      'the receiver\'s stock moved from a negative give — this is the theft the clamp exists to close');
  });

  const beforeNegWant = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  const negWantOffer = await post('/api/trade/offer',
    { code:x.minCodes.trade, to:yPid, give:{}, want:{F:-5} });
  check('a negative want is clamped to zero, not treated as a payment demand', () => {
    assert.ok(!negWantOffer.error, 'a harmless negative-want offer was refused outright: ' + negWantOffer.error);
    assert.strictEqual(negWantOffer.offer && negWantOffer.offer.want.F, 0,
      'the negative want reached the stored offer unclamped');
  });
  const negWantAccepted = await post('/api/trade/respond', { code:y.minCodes.trade, id:negWantOffer.offer.id, accept:true });
  const afterNegWant = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  check('accepting a negative-want offer moves nothing, for either country', () => {
    assert.ok(!negWantAccepted.error, 'the clamped offer could not even be accepted: ' + negWantAccepted.error);
    assert.strictEqual(afterNegWant.x.team.stock.F, beforeNegWant.x.team.stock.F,
      'the sender\'s stock moved from a negative want');
    assert.strictEqual(afterNegWant.y.team.stock.F, beforeNegWant.y.team.stock.F,
      'the receiver\'s stock moved from a negative want');
  });

  /* The exact reproduction: a Defence Minister reaching the combined act
     through a negative number instead of a positive one. offerAct() reads
     the RAW request, before the clamp runs, so a negative give still
     registers as goods (!== 0, not > 0 — see offerAct()'s comment) and
     still requires the Leader, the same as a positive combined offer does. */
  const beforeNegCombo = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  const negComboByDef = await post('/api/trade/offer',
    { code:x.minCodes.def, to:yPid, ally:true, give:{W:-5} });
  check('a Defence Minister cannot reach the combined act through a negative give', () => {
    assert.ok(negComboByDef.error, 'the Defence Minister sent a combined offer through a negative give');
  });
  const afterNegCombo = { x: await get('/api/state?code=' + x.code), y: await get('/api/state?code=' + y.code) };
  check('the refused negative-give combined offer moved nothing', () => {
    assert.strictEqual(afterNegCombo.x.team.stock.W, beforeNegCombo.x.team.stock.W,
      'the sender\'s stock moved even though the combined offer was refused');
    assert.strictEqual(afterNegCombo.y.team.stock.W, beforeNegCombo.y.team.stock.W,
      'the receiver\'s stock moved even though the combined offer was refused');
  });

  for (const m of MIN) {
    const chose = await post('/api/scenario/choose', { code:x.minCodes[m], choice:'a' });
    check(`the ${m} minister cannot answer the card`, () => {
      assert.ok(chose.error, `the ${m} minister answered the card`);
      assert.ok(/Leader/.test(chose.error), 'the refusal does not name the Leader: ' + chose.error);
    });
  }
  const mCommit = await post('/api/team/commit', { code:x.minCodes.infra });
  check('a minister cannot commit the country', () => {
    assert.ok(mCommit.error, 'a minister committed the country');
  });
  const mHall = await post('/api/team/join-hall', { code:x.minCodes.edu, room:H.room });
  check('a minister cannot take the country to the hall', () => {
    assert.ok(mHall.error, 'a minister moved the country into the hall');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();
