/* Task 8 — the classroom-to-hall handover. A group builds its country in its
   own classroom, a week later the whole cohort meets in a hall for the mass
   game, and the leader types the hall code to carry the country across,
   keeping its own code the whole way. If this breaks on the day, a class of
   students cannot take part. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3324;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-migr-'));
const KEY = 'a-very-long-admin-key-for-migration-tests'; // needed to reach POST /api/admin/rooms below

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

  /* cls used to be opened the way a student would at /host, stamped 'self'.
     The join-hall guard this branch added now correctly refuses countries
     from a room like that, so the whole handover flow this file exists to
     prove (one/two/four/five all migrating through join-hall below) needs
     a genuinely admin-issued classroom instead — exactly what a real
     teacher's class actually is on the day. The two checks further down
     that specifically prove a SELF-MADE room's countries are refused get
     their own dedicated, separate self-made fixture instead of continuing
     to borrow this room. */
  const cls  = (await post('/api/admin/rooms', { key:KEY, labels:['3E'] })).rooms[0];
  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  /* n:5 — one/two/three drive the original handover flow; four is left
     deliberately uncommitted (I3's "cannot pull an uncommitted country"
     guard needs one); five is saved and committed but only migrated in
     later, once a scenario card is already open (I4's arrival-exemption
     guard needs one that was never asked the open card). */
  const g = await post('/api/host/groups', { room:cls.room, hostKey:cls.hostKey, n:5 });
  const one = g.roster[0], two = g.roster[1], three = g.roster[2], four = g.roster[3], five = g.roster[4];
  for (const t of [one, two, three, five])
    await post('/api/team/save', { code:t.code, country:{ name:'Country'+t.slot, members:{ leader:'L'+t.slot } } });

  const early = await post('/api/team/join-hall', { code: one.code, room: hall.room });
  check('an uncommitted country cannot go to the hall', () => {
    assert.ok(early.error, 'an unfinished country reached the hall');
    assert.ok(/commit/i.test(early.error), 'the refusal does not say what to do: ' + early.error);
  });

  await post('/api/team/commit', { code: one.code });
  const preMove = await get('/api/state?code=' + one.code);
  const moved = await post('/api/team/join-hall', { code: one.code, room: hall.room });
  const st = await get('/api/state?code=' + one.code);
  check('a committed country arrives in the hall keeping its code', () => {
    assert.ok(!moved.error, 'migration failed: ' + moved.error);
    assert.strictEqual(st.room, hall.room, 'the country did not move');
    assert.strictEqual(st.team.name, 'Country1');
    assert.strictEqual(st.team.origin, cls.room, 'the country forgot where it came from');
  });
  check('the commit that let it into the hall is not undone by arriving', () => {
    assert.strictEqual(st.team.locked, true,
      'moveTeam cleared locked on arrival — that strands the entire mass game behind the writable() prep gate');
  });
  /* I2 (review): one field-by-field assertion closing all seven destructive
     mutations the review found survived unpinned — meters, stock,
     buildings/industries, allies, colours/emblem, slot, and a copy-pasted
     `team.meters = E.foundingMeters(team)` (exactly what /api/team/commit
     does — the single most plausible line to accidentally reuse here).
     Only origin, round and chosen are moveTeam's own legitimate edits;
     arrived is added to that list too — it did not exist when the review was
     written, and is the field this same round of fixes introduces (I4) so
     advanceRound can tell an arrival apart from a country that ducked a
     card. Every other field must come through byte-identical. */
  /* allies joins the exclusion list here (final review, finding 4): moveTeam
     now deliberately filters allies against the destination room's own
     livePids, the same discipline migrateRoom() already applies, so a
     classroom alliance with a country that never migrates does not keep
     paying roundIncome's ally bonus in the hall for a pid nobody there can
     resolve. This one's country (`one`) has no allies in this flow, so the
     filter is a no-op here either way — the dedicated ally checks further
     down (in-process, via S.moveTeam) are what actually prove the filter
     runs and drops the right thing. */
  check('the arriving country is otherwise byte-identical to what it committed with', () => {
    const before = { ...preMove.team };
    const after  = { ...st.team };
    for (const k of ['origin', 'round', 'chosen', 'arrived', 'allies']) { delete before[k]; delete after[k]; }
    assert.deepStrictEqual(after, before,
      'moveTeam changed a field beyond origin/round/chosen/arrived/allies — the country did not arrive intact');
  });
  const stView = await get('/api/state?code=' + one.viewCode);
  check('the class code follows the country', () => {
    assert.strictEqual(stView.room, hall.room, 'members were left behind in the classroom');
    assert.strictEqual(stView.role, 'member');
  });
  const classRoom = await get('/api/room?room=' + cls.room);
  check('the classroom no longer holds it', () => {
    /* named teams remaining: two, three, five (four is deliberately left
       unnamed/uncommitted for I3's guard tests) */
    assert.strictEqual(classRoom.count, 3, 'the country was copied, not moved');
  });

  /* Point 2 of the brief: PIDS carries no room, so a move re-registers no pid
     — but the pid must still resolve inside the hall's own room.teams (which
     is all teamByPid ever searches) and must no longer show up on the
     classroom's board, or the same public id would be readable from two
     rooms at once. */
  const hallBoardEarly = await get('/api/room?room=' + hall.room);
  check('the moved country is visible on the hall board under its pid', () => {
    assert.ok(hallBoardEarly.board.some(r => r.pid === one.pid),
      'the arriving country does not appear on the hall board — teamByPid would not find it in this room');
  });
  check('the moved country is gone from the classroom board', () => {
    assert.ok(!classRoom.board.some(r => r.pid === one.pid),
      'the departed country is still listed on the classroom board — the same pid now reads from two rooms');
  });

  /* I1 (review, confirmed and worse than originally reported): unregTeam()
     releases a team's pid from the global PIDS set as a side-effect, and
     moveTeam never reversed that, so a moved country's pid sat unreserved
     for the rest of the event — not degraded, empty, for every hall pid.
     PIDS is a 5-character draw over a 32-character alphabet (~33.5M
     combinations), so hoping a *statistical* test against Math.random()
     would ever actually redraw one specific value is not a real regression
     guard — it would pass even with the bug present. Proving the invariant
     directly needs in-process access to the one Set moveTeam is supposed to
     touch, which is exactly what requiring server.js (skipping its listen()
     path — see the require.main guard at server.js's very end) gives, with
     no new HTTP surface and nothing reachable over the network. */
  const pidDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-migr-pid-'));
  const savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = pidDataDir;
  const S = require('../server.js');
  process.env.DATA_DIR = savedDataDir;
  const fromRoomPid = S.newRoom('class', 'PidTest');
  const toRoomPid   = S.newRoom('hall', '');
  const pidTeam = Object.assign(require('../game_engine.js').blankCountry(),
    { code:'PIDTC1', viewCode:'PIDTV1', pid:'PIDTPD', name:'Pidland' });
  fromRoomPid.teams[pidTeam.code] = pidTeam;
  S.reg(fromRoomPid.code, pidTeam.code, pidTeam.code, 'leader');
  S.reg(fromRoomPid.code, pidTeam.code, pidTeam.viewCode, 'view');
  S.PIDS.add(pidTeam.pid);
  S.moveTeam(pidTeam, fromRoomPid, toRoomPid);
  check("a migrated country's pid stays reserved in PIDS after the move", () => {
    assert.ok(S.PIDS.has(pidTeam.pid),
      'moveTeam released the pid from PIDS — a later freeCode()/freePid() draw could mint it as a live leader code, or as a duplicate pid teamByPid would resolve to the wrong country');
  });
  fs.rmSync(pidDataDir, { recursive:true, force:true });

  /* I2 continued: the HTTP-flow "byte-identical" check above cannot actually
     distinguish moveTeam's most dangerous mutation — `team.meters =
     E.foundingMeters(team)` — from correct behaviour. A freshly committed
     team's meters already equal E.foundingMeters(team) by construction
     (that is what /api/team/commit itself just did, on the same
     unchanged picks/homeland), so recomputing the exact same pure function
     again is a silent no-op in that flow. Proving it needs a team whose
     recorded state could not coincidentally match a reset or a recompute —
     built directly, in-process, reusing the S/E handles above. */
  const E2 = require('../game_engine.js');
  const intactTeam = Object.assign(E2.blankCountry(), {
    code:'INTC01', viewCode:'INTV01', pid:'INTP01', name:'Intactland', locked:true,
    meters:{ E:71, H:22, S:63, K:8, D:44, G:91 },
    stock:{ W:3, M:5, F:2 },
    buildings:{ mixed:2 }, industries:{ farm:3 },
    allies:['ALLYPID'], emblem:'🐲', col1:'#123456', col2:'#abcdef', slot:7,
    /* A group cannot actually reach the hall with a live decision through the
       HTTP routes alone — commit() itself already clears chosen, and a
       classroom room can never be flipped to phase 'game' to answer one
       after committing. Crafting it directly is the only way to prove
       moveTeam is what guarantees a country never arrives already counted
       as decided; see the check just below. */
    chosen:{ scenario:'haze', choice:'b', label:'Practice choice', fx:{}, coin:0 }
  });
  const intactFrom = S.newRoom('class', 'IntactTest');
  const intactTo   = S.newRoom('hall', '');
  intactFrom.teams[intactTeam.code] = intactTeam;
  S.reg(intactFrom.code, intactTeam.code, intactTeam.code, 'leader');
  S.reg(intactFrom.code, intactTeam.code, intactTeam.viewCode, 'view');
  S.PIDS.add(intactTeam.pid);
  const intactBefore = JSON.parse(JSON.stringify(intactTeam));
  S.moveTeam(intactTeam, intactFrom, intactTo);
  const intactAfter = { ...intactTeam };
  /* allies is deliberately excluded here too, and for the same reason as the
     HTTP-flow check above: final-review finding 4 made moveTeam filter
     allies against the destination room's livePids on purpose, so a
     classroom alliance with a country that never migrates cannot keep
     collecting roundIncome's ally bonus in the hall for a pid nothing there
     resolves to. This fixture's intactTo is a brand-new, empty hall room, so
     'ALLYPID' resolves to nobody there and IS expected to be dropped — see
     the assertion immediately below this one, which pins that reversal
     explicitly instead of leaving it to fall out of an exclusion silently. */
  for (const k of ['origin', 'round', 'chosen', 'arrived', 'allies']) { delete intactBefore[k]; delete intactAfter[k]; }
  check('a crafted country with distinctive state arrives with every other field untouched', () => {
    assert.deepStrictEqual(intactAfter, intactBefore,
      'moveTeam changed a field beyond origin/round/chosen/arrived/allies — none of meters, stock, buildings, industries, colours/emblem or slot may be reset, defaulted or recomputed by a move');
  });
  check('an ally that resolves to nobody in the destination room is dropped by the move, not carried over as a phantom', () => {
    assert.deepStrictEqual(intactTeam.allies, [],
      'moveTeam carried an ally pid into the hall that resolves to nobody there — roundIncome would keep paying its bonus with no counterparty anyone can see (final-review finding 4)');
  });
  /* Task 8 review: a country carrying a decision made before the move must
     not arrive already counted as decided — it would escape that round's
     indecision penalty and inflate the console's "decided" count. The
     byte-identical check above deliberately excludes chosen (clearing it is
     one of moveTeam's own legitimate edits), so nothing else here catches a
     dropped `team.chosen = null;` in moveTeam. */
  check('moveTeam clears a decision the country made before the move', () => {
    assert.strictEqual(intactTeam.chosen, null,
      'a country arrived at the hall still carrying its classroom decision — it would be wrongly counted as already decided');
  });

  /* -------- final-review finding 4, reproduced end to end: A and B ally in
     the classroom, A commits and migrates alone; A's allies still names B's
     pid, which resolves to nobody in this hall, and roundIncome's allyBonus
     (1 + min(3, allies.length)*0.07) kept paying out for it regardless —
     up to +21% income, invisible to students and teacher alike, since the
     pid does not resolve on anyone's board. -------- */
  {
    const allyHall = S.newRoom('hall', '');
    const teamA = Object.assign(E2.blankCountry(), {
      code:'ALYA001', viewCode:'ALYAVW1', pid:'ALYAPID', name:'Allyland',
      allies:['NOWHRPID'] // struck with a country that has not (yet) migrated here
    });
    const classA = S.newRoom('class', 'AllyClassA');
    classA.teams[teamA.code] = teamA;
    S.reg(classA.code, teamA.code, teamA.code, 'leader');
    S.reg(classA.code, teamA.code, teamA.viewCode, 'view');
    S.PIDS.add(teamA.pid);
    const controlBonus = E2.roundIncome(Object.assign(E2.blankCountry(), { allies:[] })).allyBonus;
    S.moveTeam(teamA, classA, allyHall);
    check('a classroom ally that never migrates to the hall is dropped from allies on arrival', () => {
      assert.deepStrictEqual(teamA.allies, [],
        'moveTeam left a pid nobody in the hall resolves to sitting in allies');
    });
    check('roundIncome grants no ally bonus once the phantom ally is dropped', () => {
      assert.strictEqual(E2.roundIncome(teamA).allyBonus, controlBonus,
        'a classroom alliance with a country that never migrated is still paying an ally bonus in the hall, with no counterparty anyone can see');
    });

    /* Regression caught in re-review ("NEW-1"): migration happens one
       country at a time, so the FIRST arrival of an allied pair always has
       its own allies[] filtered against a hall that does not contain its
       ally yet — correct at that instant, but nothing ever revisited teamA
       once teamB actually arrived, so teamA stayed one-sided forever. With
       every allied pair in a cohort migrating the ordinary Session 1 →
       Session 2 way, EVERY alliance ended up one-sided, deterministically —
       contradicting README.md's "arrives exactly as it left it." The fix
       (moveTeam) repairs this symmetrically on the LATER arrival: when
       teamB's own filtered allies[] still names teamA (proof, via
       trade/respond's always-both-sides push, that the alliance was
       genuinely mutual), and teamA's allies[] is missing teamB back, teamB's
       pid is pushed onto teamA's allies right here — regardless of which of
       the pair migrated first. teamB's pid is deliberately the same
       'NOWHRPID' teamA's allies named above, so this also proves the two
       scenarios are the same country, not a coincidence. */
    const teamB = Object.assign(E2.blankCountry(), {
      code:'ALYB001', viewCode:'ALYBVW1', pid:'NOWHRPID', name:'Bystandia',
      allies:['ALYAPID']
    });
    const classB = S.newRoom('class', 'AllyClassB');
    classB.teams[teamB.code] = teamB;
    S.reg(classB.code, teamB.code, teamB.code, 'leader');
    S.reg(classB.code, teamB.code, teamB.viewCode, 'view');
    S.PIDS.add(teamB.pid);
    S.moveTeam(teamB, classB, allyHall);
    check('the later migrant keeps its ally, once both are genuinely present in the hall', () => {
      assert.ok(teamB.allies.includes('ALYAPID'),
        'the later migrant lost an ally that was already, genuinely, sitting in the same hall room');
    });
    /* This is the assertion the re-review found missing: re-reading teamA
       (the EARLIER migrant) instead of only teamB. Before the symmetric
       repair above, teamA.allies was still [] at this point — this line
       fails on the pre-fix code even though every other check in this block
       passed, which is exactly the "title promises a pairwise outcome,
       assertion checks one side" pattern flagged in re-review. */
    check('both sides of the alliance are restored once both countries have migrated, regardless of which arrived first', () => {
      assert.ok(teamA.allies.includes('NOWHRPID'),
        'the EARLIER migrant (teamA) never got its ally back — the alliance is still one-sided, just on the other foot now');
    });
    check('roundIncome pays the ally bonus again on the earlier migrant too, once the alliance is genuinely restored', () => {
      assert.strictEqual(E2.roundIncome(teamA).allyBonus, E2.roundIncome(teamB).allyBonus,
        'the two allied countries now sitting in the same hall room are paid different ally bonuses for the same alliance');
      assert.notStrictEqual(E2.roundIncome(teamA).allyBonus, controlBonus,
        'the earlier migrant is still paying no ally bonus at all despite its ally now genuinely sitting in the same room');
    });
  }

  const again = await post('/api/team/join-hall', { code: one.code, room: hall.room });
  check('arriving twice is harmless', () => {
    assert.ok(!again.error, 'a repeated arrival errored: ' + again.error);
    assert.strictEqual(again.already, true);
  });

  await post('/api/team/commit', { code: two.code });
  const byMember = await post('/api/team/join-hall', { code: two.viewCode, room: hall.room });
  check('a member cannot move the country', () => {
    assert.ok(byMember.error, 'a watching device moved the whole country');
  });

  const wrongKind = await post('/api/team/join-hall', { code: two.code, room: cls.room });
  check('a classroom code is not a hall code', () => {
    assert.ok(wrongKind.error, 'a country was sent to a classroom room as if it were the hall');
  });

  /* A group that arrives at round 3 keeps what it committed with. Back-filling
     the rounds it missed would let a late group out-earn one that turned up. */
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'phase', phase:'game' });
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'round' });
  const before = (await get('/api/state?code=' + two.code)).team.coins;
  await post('/api/team/join-hall', { code: two.code, room: hall.room });
  const late = await get('/api/state?code=' + two.code);
  check('a late arrival is not back-paid', () => {
    assert.strictEqual(late.team.coins, before, 'a country that missed two rounds was paid for them');
    assert.strictEqual(late.team.round, late.round, 'the late arrival is not on the current round');
  });

  /* The rescue for the group whose iPad died — but this needs a room that is
     genuinely self-made (origin:'self'), the way a STUDENT actually gets one
     from the open /host route, to prove Task 2's hall guard refuses to
     rescue anything from a room like that. `cls` (above) is now the
     admin-issued classroom the rest of this file's handover flow depends
     on, so this — and the sibling check just below it — get their own
     dedicated self-made room instead of continuing to borrow `cls`. Two
     slots: one committed (the stranded rescue), one left deliberately
     uncommitted (the trust-guard-fires-first check right after it). */
  const selfMade = await post('/api/host/create', { kind:'class', label:'Self-Opened' });
  const selfGroups = await post('/api/host/groups', { room:selfMade.room, hostKey:selfMade.hostKey, n:2 });
  const strandedSelf = selfGroups.roster[0];
  const untrustedSelf = selfGroups.roster[1]; // deliberately never named or committed
  await post('/api/team/save', { code:strandedSelf.code, country:{ name:'Strandia0', members:{ leader:'S0' } } });
  await post('/api/team/commit', { code: strandedSelf.code });
  const strandedFromSelf = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, code:strandedSelf.code, act:'pull' });
  check('a stranded country from a self-made room is refused, not rescued', () => {
    assert.strictEqual(strandedFromSelf.error, 'That country is not from a registered class room.');
  });

  /* The genuine rescue: a real teacher's classroom, created ahead of time
     through the admin route (Task 4) and stamped 'admin' — exactly what
     every classroom in production actually is. */
  const rescueRoom = (await post('/api/admin/rooms', { key:KEY, labels:['Rescue'] })).rooms[0];
  const rg = await post('/api/host/groups', { room:rescueRoom.room, hostKey:rescueRoom.hostKey, n:1 });
  const stranded = rg.roster[0];
  await post('/api/team/save', { code:stranded.code, country:{ name:'Strandia', members:{ leader:'Sam' } } });
  await post('/api/team/commit', { code: stranded.code });
  const pulled = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, code:stranded.code, act:'pull' });
  const stranded2 = await get('/api/state?code=' + stranded.code);
  check('the console can pull a stranded country in', () => {
    assert.ok(!pulled.error, 'pull failed: ' + pulled.error);
    assert.strictEqual(stranded2.room, hall.room);
  });
  check('a pulled country is still committed on arrival', () => {
    assert.strictEqual(stranded2.room, hall.room, 'checking the arrival state of a country that was not actually pulled');
    assert.strictEqual(stranded2.team.locked, true, 'the pulled country lost its committed state');
  });

  /* I3 (review): pullCountry has four guards, and only the already-in-hall
     no-op above was actually pinned. Three one-line checks close the rest.

     The trust guard runs BEFORE the committed guard (correctly — a teacher
     should never be told an untrusted country's commit status at all), so a
     single loose assert.ok(...error) against `untrustedSelf` (uncommitted,
     and stuck in the self-made `selfMade` room above) could not tell
     "refused for being untrusted" apart from "refused for being
     uncommitted" — it passed for the wrong reason once the trust guard
     shipped, exactly the phantom-assertion failure mode the rooms-and-roles
     follow-ups doc warns about. Split into the two cases the two guards
     actually produce, each pinned to its own string, so a future reordering
     (or the wrong guard firing) fails one of them. */
  const pullUntrusted = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, code:untrustedSelf.code, act:'pull' });
  check('an uncommitted country in a self-made (untrusted) room is refused for being untrusted, not for being uncommitted', () => {
    assert.strictEqual(pullUntrusted.error, 'That country is not from a registered class room.');
  });

  const uncommittedRoom = (await post('/api/admin/rooms', { key:KEY, labels:['Uncommitted'] })).rooms[0];
  const ug = await post('/api/host/groups', { room:uncommittedRoom.room, hostKey:uncommittedRoom.hostKey, n:1 });
  const uncommitted = ug.roster[0]; // never named or committed, and the room IS trusted — isolates the committed guard on its own
  const pullUncommitted = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, code:uncommitted.code, act:'pull' });
  check('the console cannot pull an uncommitted country into the hall, even from a trusted room', () => {
    assert.strictEqual(pullUncommitted.error, 'That country has not been committed yet.');
  });
  const pullByView = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, code:three.viewCode, act:'pull' });
  check('the console cannot pull a country in using its class code', () => {
    assert.ok(pullByView.error, 'a class code was accepted as a rescue credential');
  });
  const pullIntoClass = await post('/api/host/country', { room:cls.room, hostKey:cls.hostKey, code:four.code, act:'pull' });
  check('the console cannot pull a country into a classroom room', () => {
    assert.ok(pullIntoClass.error, 'a country was pulled into a classroom as if it were the hall');
  });

  /* Point 3 of the brief, the gap that let a hall-breaking bug through two
     tasks ago: a committed (locked:true) country must be able to play
     normally once it is in the hall — choose a scenario, AND complete a
     trade (send *and accept*), not merely be allowed to send one that never
     lands. One and two are both in the hall now, both still locked:true,
     and the hall is in phase 'game', where writable()'s locked+prep gate no
     longer applies. */
  /* A card now opens with a discussion window in which nobody may decide or
     trade. A 10-second card clock is shorter than the 15-second floor that
     discussionEnd() leaves to decide in, so the window clamps into the past
     and the card is answerable at once — which is what this test is about,
     not the window. See tests/discussion-minute.test.js for the window itself. */
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'timer', secs:10 });
  const scenarioPush = await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'scenario', key:'haze' });
  check('the console can open a scenario in the hall', () => {
    assert.ok(!scenarioPush.error, 'scenario push failed: ' + scenarioPush.error);
  });
  const chosen = await post('/api/scenario/choose', { code: one.code, choice:'b' });
  check('a committed country can still choose a scenario in the hall', () => {
    assert.ok(!chosen.error, 'a locked country was refused a scenario choice in the hall: ' + chosen.error);
  });

  const offer = await post('/api/trade/offer', { code: one.code, to: two.pid, give:{ F:2 }, want:{ M:2 } });
  check('a committed country can still send a trade offer in the hall', () => {
    assert.ok(!offer.error, 'a locked country was refused a trade offer in the hall: ' + offer.error);
  });
  const accept = await post('/api/trade/respond', { code: two.code, id: offer.offer && offer.offer.id, accept:true });
  check('a committed country can still accept a trade offer in the hall', () => {
    assert.ok(!accept.error, 'a locked country was refused a trade acceptance in the hall: ' + accept.error);
  });
  const stOneAfter = await get('/api/state?code=' + one.code);
  const stTwoAfter = await get('/api/state?code=' + two.code);
  check('the accepted trade actually moved resources between the two hall countries', () => {
    assert.strictEqual(stOneAfter.team.stock.F, -2, 'the sender did not lose the Food it gave — offer never really landed');
    assert.strictEqual(stOneAfter.team.stock.M, 2, 'the sender did not receive the Materials it was owed');
    assert.strictEqual(stTwoAfter.team.stock.M, -2, 'the acceptor did not lose the Materials it gave back');
    assert.strictEqual(stTwoAfter.team.stock.F, 2, 'the acceptor did not receive the Food it was owed');
  });
  check('both countries are still committed after trading in the hall', () => {
    assert.strictEqual(stOneAfter.team.locked, true, 'trading in the hall unlocked the sender');
    assert.strictEqual(stTwoAfter.team.locked, true, 'trading in the hall unlocked the acceptor');
  });

  /* I4 (review): a country that migrates in after a scenario card is already
     open was never asked that card either — an arrival is indistinguishable
     from a country that ducked it unless something tells advanceRound apart.
     'haze' is still open from the block above; five commits and joins the
     hall now, mid-card, and never answers it. */
  await post('/api/team/commit', { code: five.code });
  const fiveJoin = await post('/api/team/join-hall', { code: five.code, room: hall.room });
  check('a country can join the hall while a scenario is already open', () => {
    assert.ok(!fiveJoin.error, 'join failed: ' + fiveJoin.error);
  });
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'round' });
  const fiveOwnRound = await get('/api/state?code=' + five.code);
  check('an arrival is not penalised for the round it arrived in', () => {
    assert.ok(!fiveOwnRound.team.log.some(l => /Could not agree/i.test(l.note || '')),
      'an indecision penalty was logged against a country for a card it was never asked');
  });
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'round' });
  const fiveNextRound = await get('/api/state?code=' + five.code);
  check('the round after arriving, indecision is judged normally again', () => {
    assert.ok(fiveNextRound.team.log.some(l => /Could not agree/i.test(l.note || '')),
      'a country that still had not chosen escaped the indecision penalty on the round after it arrived');
  });

  /* M1 (review): a committed country already in a hall must not be movable
     to a DIFFERENT hall — a stray rehearsal-room code left on a slide would
     silently vanish a live country from the real hall's leaderboard, and
     overwrite the origin it already recorded. Guarded in both routes that
     call moveTeam. */
  const hall2 = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const hop = await post('/api/team/join-hall', { code: one.code, room: hall2.room });
  check('a country already in a hall cannot join-hall to a different hall', () => {
    assert.ok(hop.error, 'a hall-to-hall hop was allowed via join-hall');
  });
  const hopPull = await post('/api/host/country', { room:hall2.room, hostKey:hall2.hostKey, code:two.code, act:'pull' });
  check('the console cannot pull a country already in a different hall', () => {
    assert.ok(hopPull.error, 'the console pulled a country out of one hall and into another');
  });
  const stAfterHop = await get('/api/state?code=' + one.code);
  check('a refused hop does not actually move the country', () => {
    assert.strictEqual(stAfterHop.room, hall.room, 'the country left its hall despite the hop being refused');
    assert.strictEqual(stAfterHop.team.origin, cls.room, 'origin was overwritten by the refused hop');
  });

  /* A test Task 7 left unpinned: /api/host/country can rename, unlock and
     delete another class's work, and its success response carries every code
     in the room. A *valid* hostKey that simply belongs to a different room
     must be refused exactly like a fake one — isolation between two real
     rooms, not just between a real room and nonsense. */
  const crossRoom = await post('/api/host/country', { room:hall.room, hostKey:cls.hostKey, code:one.code, act:'rename', name:'Hijacked' });
  check('a valid hostKey from a different room cannot act on this room', () => {
    assert.ok(crossRoom.error, 'the classroom\'s real hostKey renamed a country in the hall');
  });
  const stillCalledOne = await get('/api/state?code=' + one.code);
  check('the cross-room attempt did not actually rename anything', () => {
    assert.strictEqual(stillCalledOne.team.name, 'Country1');
  });

  /* A room already sitting in Railway's volume, holding a country made by the
     build whose /api/join minted no class code. That group is stuck sharing
     the leader code for the life of the room unless a restart repairs it —
     and a restart is exactly what a deploy does. Planted through host/import,
     the same door restore() walks through, so this pins the repair both
     entry points share. */
  const E3 = require('../game_engine.js');
  const strandedHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const noClassCode = Object.assign(E3.blankCountry(), {
    code:'STRAND1', viewCode:'', pid:'STRNDPD', name:'Strandland', homeland:'delta', slot:1
  });
  noClassCode.meters = E3.foundingMeters(noClassCode);
  /* blankCountry() already carries programmes:[] — deleted here so this
     fixture is genuinely legacy-shaped for the one field that is new, rather
     than merely re-asserting what blankCountry already gives it. */
  delete noClassCode.programmes;
  /* Same story for mandate, added by the build right after programmes: a
     country saved before it existed carries no such key at all. */
  delete noClassCode.mandate;
  /* Spec D. blankCountry() already carries displaced:0 — deleted here for the
     same reason as programmes/mandate above: a country saved before Spec D
     has no such key at all, and this fixture has to be genuinely legacy-
     shaped for it, not merely re-assert what blankCountry already gives it. */
  delete noClassCode.displaced;
  const strandedImport = await post('/api/host/import', { snapshot:{
    code:strandedHost.room, hostKey:strandedHost.hostKey, kind:'hall', label:'', phase:'prep',
    round:0, maxRounds:10, scenario:null, scenarioRound:0,
    teams:{ STRAND1:noClassCode }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1,
    created:Date.now(), touched:Date.now()
  }});
  const strandedRoster = await post('/api/host/roster',
    { room:strandedHost.room, hostKey:strandedHost.hostKey });
  const repaired = (strandedRoster.roster || []).find(t => t.code === 'STRAND1');
  check('a restored country with no class code is given one', () => {
    assert.ok(!strandedImport.error, 'import failed: ' + strandedImport.error);
    assert.ok(repaired, 'the stranded country never reached the roster');
    assert.ok(repaired.viewCode, 'a country restored without a class code stayed without one — its group shares the leader code for the rest of the room');
    assert.notStrictEqual(repaired.viewCode, repaired.code, 'the minted class code was the leader code');
  });
  const repairedMember = repaired && repaired.viewCode
    ? await get('/api/state?code=' + repaired.viewCode) : null;
  check('the class code minted by the repair actually opens the country', () => {
    assert.ok(repairedMember && !repairedMember.error,
      'the repaired class code opened nothing — it was minted but never registered, and regRoom() had already run');
    assert.strictEqual(repairedMember.role, 'member');
    assert.strictEqual(repairedMember.team.name, 'Strandland');
  });
  const strandedState = await get('/api/state?code=STRAND1');
  check('a country imported before programmes existed restores with an empty list', () => {
    assert.ok(Array.isArray(strandedState.team.programmes),
      'migrateTeam did not backfill programmes to an array');
    assert.deepStrictEqual(strandedState.team.programmes, []);
  });
  check('a country imported before mandate existed restores fully open', () => {
    assert.deepStrictEqual(strandedState.team.mandate, { build:true, site:true, programme:true, ally:true },
      'migrateTeam did not backfill mandate — a restored room would refuse every minister every door');
  });
  // Spec D. Both paths, because migrateTeam runs on restore AND on import,
  // and Spec C shipped a backfill that was wired into only one of them.
  check('a team restored with no displaced key comes back with nobody displaced', () => {
    assert.strictEqual(strandedState.team.displaced, 0,
      'migrateTeam did not backfill a missing displaced to 0 — a restored country would carry undefined forever, and NaN would leak out of housed()');
  });

  /* A half-written mandate is a different shape from a missing one: a backup
     hand-edited, or written by a build that only ever wrote SOME of the four
     keys. migrateTeam's backfill loop defaults each flag independently
     (server.js, beside the programmes guard) rather than replacing the whole
     object the moment any key is missing — this is what stops that loop
     silently regressing to a single "if(!t.mandate...) fill all four"
     shortcut, which would look identical on every OTHER check in this file
     (they only ever test a mandate that is either fully absent or fully
     present) but would overwrite an explicit `build:false` sitting next to
     a missing `site`. A brand-new hall room, not strandedHost above: import
     replaces a room's whole team set, and reusing strandedHost here would
     silently delete STRAND1 rather than add to it. */
  const halfMandateHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const halfMandateTeam = Object.assign(E3.blankCountry(), {
    code:'HALFMD1', viewCode:'', pid:'HALFMPD', name:'Halfland', homeland:'delta', slot:1,
    mandate: { build:false },
    // Spec D, same hand-edited-backup story: a nonsense shape, not an absence.
    displaced: 'lots'
  });
  halfMandateTeam.meters = E3.foundingMeters(halfMandateTeam);
  const halfMandateImport = await post('/api/host/import', { snapshot:{
    code:halfMandateHost.room, hostKey:halfMandateHost.hostKey, kind:'hall', label:'', phase:'prep',
    round:0, maxRounds:10, scenario:null, scenarioRound:0,
    teams:{ HALFMD1:halfMandateTeam }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1,
    created:Date.now(), touched:Date.now()
  }});
  const halfMandateState = await get('/api/state?code=HALFMD1');
  check('a half-written mandate keeps its explicit flag and only backfills the missing ones', () => {
    assert.ok(!halfMandateImport.error, 'import failed: ' + halfMandateImport.error);
    assert.deepStrictEqual(halfMandateState.team.mandate,
      { build:false, site:true, programme:true, ally:true },
      'migrateTeam either lost the explicit build:false or left another key undefined instead of defaulting it');
  });
  check('a team imported with a nonsense displaced comes back with nobody displaced', () => {
    assert.strictEqual(halfMandateState.team.displaced, 0,
      'migrateTeam did not sanitise a non-numeric displaced — a hand-edited backup would leave a country permanently short of housing with no way to find out why');
  });

  /* Fix round 2 (review, Minor). migrateTeam's displaced backfill (just
     above) can land displaced at 0, but t.struck is a SEPARATE field that
     backfill never touches on its own — a country restored this way could
     carry a stale struck record with nobody displaced, exactly the
     "permanently flagged as struck" state clearIfRecovered() exists to
     prevent (server.js, right above strikeCountry). Harmless today because
     every reader gates on displaced > 0 before looking at struck, but it is
     still wrong data sitting in the room. A fresh room, for the same reason
     halfMandateHost is not reused above: import replaces a room's whole team
     set, and reusing it here would silently delete HALFMD1 rather than add
     to it. */
  const stuckHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const stuckTeam = Object.assign(E3.blankCountry(), {
    code:'STUCKD1', viewCode:'', pid:'STUCKPD', name:'Stuckland', homeland:'delta', slot:1,
    displaced: -5,   // a nonsense legacy value the backfill floors to 0
    struck: { kind:'raid', icon:'☠️', title:'Rogue nation raid',
      line:'Armed raiders crossed the border in the night.', displaced:5, coins:0, fx:{}, round:1, t:Date.now() }
  });
  stuckTeam.meters = E3.foundingMeters(stuckTeam);
  const stuckImport = await post('/api/host/import', { snapshot:{
    code:stuckHost.room, hostKey:stuckHost.hostKey, kind:'hall', label:'', phase:'prep',
    round:0, maxRounds:10, scenario:null, scenarioRound:0,
    teams:{ STUCKD1:stuckTeam }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1,
    created:Date.now(), touched:Date.now()
  }});
  const stuckState = await get('/api/state?code=STUCKD1');
  check('a restored country whose displaced backfills to 0 is not left flagged as struck', () => {
    assert.ok(!stuckImport.error, 'import failed: ' + stuckImport.error);
    assert.strictEqual(stuckState.team.displaced, 0, 'fixture: displaced did not backfill to 0');
    assert.ok(!stuckState.team.struck,
      'migrateTeam backfilled displaced to 0 but left struck in place — clearIfRecovered was never called');
  });

  if (!ran) console.error('FAIL  migration.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  migration — a committed country carries its own code, both codes, its locked state and its coins from the classroom into the hall');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
