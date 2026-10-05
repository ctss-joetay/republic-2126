/* A group finishes building its country and presses Commit — that locks name,
   flag, ministers, points, policies, buildings and industries, and is the
   gate the teacher counts before ending the lesson. Committing needs a name
   and a Leader, is refused while the teacher has bounced the name back
   (renameAsked), recomputes founding meters (so a practice scenario card
   really was free), and a second commit is harmless.

   `locked` is also the field the hall later inherits unchanged (Task 8's
   moveTeam does not clear it) — so this file also pins that `writable()`'s
   locked refusal applies only in the prep phase. Get that wrong and every
   committed country in the hall is refused every scenario choice and trade
   offer, which is the whole mass game telling students to undo the very
   step that got them there. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const E = require('../game_engine.js');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3325, BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-mod-'));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }).then(r=>r.json());
const get  = (p) => fetch(BASE + p).then(r=>r.json());
const server = spawn('node', ['server.js'], { cwd:ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT), DATA_DIR}, stdio:'ignore' });
const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i=0;i<60;i++){ try{ const r=await fetch(BASE+'/health'); if(r.ok) break; }catch{} await new Promise(r=>setTimeout(r,100)); }
  let fails = 0, ran = 0;
  const check = (label, fn) => { ran++; try { fn(); console.log('PASS  '+label); } catch(e){ console.error('FAIL  '+label+' — '+e.message); fails++; } };

  const r = await post('/api/host/create', { kind:'class', label:'3H' });
  const g = await post('/api/host/groups', { room:r.room, hostKey:r.hostKey, n:2 });
  const one = g.roster[0];

  const noName = await post('/api/team/commit', { code: one.code });
  check('an unnamed country cannot commit', () => {
    assert.ok(noName.error, 'a country with no name committed');
  });

  await post('/api/team/save', { code: one.code, country: { name:'Solaria' } });
  const noLeader = await post('/api/team/commit', { code: one.code });
  check('a country with no Leader cannot commit', () => {
    assert.ok(noLeader.error, 'a country with nobody named as Leader committed');
  });

  await post('/api/team/save', { code: one.code, country: { members:{ leader:'Ana' } } });
  const ok = await post('/api/team/commit', { code: one.code });
  check('a finished country commits', () => {
    assert.ok(!ok.error, 'commit was refused: ' + ok.error);
  });

  const edit = await post('/api/team/save', { code: one.code, country: { name:'Sneaky Rename' } });
  const after = await get('/api/state?code=' + one.code);
  check('a committed country is locked', () => {
    assert.ok(edit.error, 'a committed country was edited');
    assert.strictEqual(after.team.name, 'Solaria');
    assert.strictEqual(after.team.locked, true);
    assert.strictEqual(after.team.ready, true, 'commit should also mark the group ready');
  });
  const twice = await post('/api/team/commit', { code: one.code });
  check('committing twice is harmless', () => {
    assert.ok(!twice.error, 'a second commit errored: ' + twice.error);
    assert.strictEqual(twice.already, true);
  });

  /* renameAsked has no route to set it yet (that lands in Task 7), so craft
     the state directly through host/import — the same technique rooms.test.js
     and roles.test.js already use to plant arbitrary room state. */
  const bounced = Object.assign(E.blankCountry(), {
    code:'BOUNCE1', viewCode:'BOUNCVW', pid:'BOUNCPID', name:'Bounceland',
    homeland:'delta', slot:1, members:{ leader:'Cy', edu:'', def:'', trade:'', infra:'' },
    renameAsked:true
  });
  bounced.meters = E.foundingMeters(bounced);
  // Final-review finding 5: host/import now requires a LIVE room with a
  // matching hostKey, not just any code — mint one for real first.
  const bounceHost = await post('/api/host/create', { kind:'class' });
  const bounceRoom = {
    code:bounceHost.room, hostKey:bounceHost.hostKey, kind:'class', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0,
    teams:{ BOUNCE1:bounced }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const bounceImport = await post('/api/host/import', { snapshot: bounceRoom });
  check('a crafted room with a bounced name imports cleanly', () => {
    assert.ok(!bounceImport.error, 'import failed: ' + bounceImport.error);
  });
  const bounceCommit = await post('/api/team/commit', { code:'BOUNCE1' });
  check('a country the teacher bounced back cannot commit', () => {
    assert.ok(bounceCommit.error, 'a country with renameAsked committed anyway');
  });

  /* This is the regression Correction 2 exists to prevent: a country carried
     into the hall keeps locked:true forever (moveTeam never clears it), so
     writable()'s locked refusal must not apply once phase is 'game' — craft
     a hall-phase room with two already-committed countries and confirm both
     a scenario choice and a trade offer still go through. */
  const hallA = Object.assign(E.blankCountry(), {
    code:'HALLA001', viewCode:'HALLAVW1', pid:'HALLAPID', name:'Hallandia',
    homeland:'delta', slot:1, locked:true, ready:true,
    members:{ leader:'Di', edu:'', def:'', trade:'', infra:'' }
  });
  hallA.meters = E.foundingMeters(hallA);
  const hallB = Object.assign(E.blankCountry(), {
    code:'HALLB001', viewCode:'HALLBVW1', pid:'HALLBPID', name:'Hallmark',
    homeland:'high', slot:2, locked:true, ready:true,
    members:{ leader:'Ed', edu:'', def:'', trade:'', infra:'' }
  });
  hallB.meters = E.foundingMeters(hallB);
  const hallHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const hallRoom = {
    code:hallHost.room, hostKey:hallHost.hostKey, kind:'hall', label:'', phase:'game', round:1, maxRounds:10,
    scenario:'haze', scenarioRound:1,
    teams:{ HALLA001:hallA, HALLB001:hallB }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const hallImport = await post('/api/host/import', { snapshot: hallRoom });
  check('a crafted hall room with committed countries imports cleanly', () => {
    assert.ok(!hallImport.error, 'import failed: ' + hallImport.error);
  });
  const hallChoose = await post('/api/scenario/choose', { code:'HALLA001', choice:'a' });
  check('a locked country in the hall (phase game) can still choose a scenario', () => {
    assert.ok(!hallChoose.error, 'a committed country was refused a scenario choice in the hall: ' + hallChoose.error);
  });
  const hallOffer = await post('/api/trade/offer', { code:'HALLA001', to:'HALLBPID', give:{F:1}, want:{M:1} });
  check('a locked country in the hall (phase game) can still send a trade offer', () => {
    assert.ok(!hallOffer.error, 'a committed country was refused a trade offer in the hall: ' + hallOffer.error);
  });
  /* Sending is only half the trade. The second, separate `from.locked` check
     inside trade/respond (guarding the OTHER side of an accept) is unscoped
     by phase on its own — a hall-phase offer could be sent but never
     accepted, refusing every trade in the mass game just as surely as the
     writable() branch this task already fixed. Accept end-to-end and check
     resources actually moved, or this second guard goes unexercised. */
  const hallRespond = await post('/api/trade/respond', { code:'HALLB001', id: hallOffer.offer.id, accept:true });
  check('a locked country in the hall (phase game) can still accept a trade offer', () => {
    assert.ok(!hallRespond.error, 'a committed country could not accept a trade offer in the hall: ' + hallRespond.error);
  });
  const hallAState = await get('/api/state?code=HALLA001');
  const hallBState = await get('/api/state?code=HALLB001');
  check('accepting the offer actually moved resources between the two hall countries', () => {
    assert.strictEqual(hallAState.team.stock.F, -1, 'HALLA did not lose the Food it gave');
    assert.strictEqual(hallAState.team.stock.M, 1, 'HALLA did not receive the Materials it wanted');
    assert.strictEqual(hallBState.team.stock.F, 1, 'HALLB did not receive the Food it was given');
    assert.strictEqual(hallBState.team.stock.M, -1, 'HALLB did not pay the Materials it owed');
  });

  const two = g.roster[1];
  await post('/api/team/save', { code: two.code, country: { name:'Rude Word Republic', members:{ leader:'Bo' } } });
  await post('/api/team/commit', { code: two.code });

  const bounced2 = await post('/api/host/country', { room:r.room, hostKey:r.hostKey, code:two.code, act:'askRename' });
  let st = await get('/api/state?code=' + two.code);
  check('asking for a rename clears the name and unlocks the country', () => {
    assert.ok(!bounced2.error, 'askRename failed: ' + bounced2.error);
    assert.strictEqual(st.team.name, '');
    assert.strictEqual(st.team.renameAsked, true);
    assert.strictEqual(st.team.locked, false, 'a bounced group cannot fix a name it is locked out of');
    assert.strictEqual(st.team.ready, false);
  });

  const blocked = await post('/api/team/commit', { code: two.code });
  check('a bounced country cannot commit until it is renamed', () => {
    assert.ok(blocked.error, 'a country committed while under a rename request');
  });

  /* Task 16's fix: the critical defect the 2026-07-31 acceptance report
     found in Step 4. Before this, ANY non-blank incoming name — including
     the leader's own stale, unedited local copy, silently re-posted by
     doCommit()'s save()-then-commit sequence — was treated as proof the
     group had renamed, clearing renameAsked and letting the rejected name
     straight through to commit. A teacher who rejected "Rude Word
     Republic" would see the group show up committed under that exact name
     moments later, with no error and no way to notice.

     Resubmitting the exact rejected name (trimmed, case-insensitive in all
     three variants below) must now be REFUSED with an error — not silently
     ignored — so the leader's device learns the retype did not register,
     rather than typing into a void. renameAsked must survive every one of
     these calls, and commit must stay blocked throughout. */
  const resubmitExact = await post('/api/team/save', { code: two.code, country: { name:'Rude Word Republic' } });
  const resubmitUpper = await post('/api/team/save', { code: two.code, country: { name:'RUDE WORD REPUBLIC' } });
  const resubmitPadded = await post('/api/team/save', { code: two.code, country: { name:'  rude word republic  ' } });
  check('resubmitting the exact rejected name is refused, not silently ignored', () => {
    assert.ok(resubmitExact.error, 'the exact rejected name was accepted back');
  });
  check('resubmitting the rejected name in a different case is refused too', () => {
    assert.ok(resubmitUpper.error, 'an upper-cased version of the rejected name was accepted');
  });
  check('resubmitting the rejected name with extra whitespace is refused too', () => {
    assert.ok(resubmitPadded.error, 'a padded/whitespace version of the rejected name was accepted');
  });
  st = await get('/api/state?code=' + two.code);
  check('renameAsked survives all three resubmission attempts — a team/save carrying the stale name cannot clear it', () => {
    assert.strictEqual(st.team.renameAsked, true, 'renameAsked was cleared by a resubmitted rejected name');
    assert.strictEqual(st.team.name, '', 'the blanked name was overwritten by a refused resubmission');
  });
  const stillBlocked = await post('/api/team/commit', { code: two.code });
  check('commit is still refused after every resubmission attempt, while renameAsked remains set', () => {
    assert.ok(stillBlocked.error, 'a country committed after only resubmitting its rejected name');
  });

  /* The comparison trims BOTH sides — rejectedName is copied straight from
     whatever the leader last typed as team.name, which server-side is
     stored untrimmed (leading/trailing spaces and all), so a rejected name
     that itself carried stray whitespace must still be matched against a
     cleanly-typed resubmission. Crafted directly through host/import, the
     same technique the bounced-country and hall-room fixtures above use,
     since there is no route that plants a padded name as the CURRENT
     rejection in one call. */
  const paddedOrigin = Object.assign(E.blankCountry(), {
    code:'PADORIG1', viewCode:'PADORVW1', pid:'PADORPID', name:'',
    homeland:'delta', slot:1, members:{ leader:'Pat', edu:'', def:'', trade:'', infra:'' },
    renameAsked:true, rejectedName:'  Padded Republic  '
  });
  paddedOrigin.meters = E.foundingMeters(paddedOrigin);
  const padHost = await post('/api/host/create', { kind:'class' });
  const padRoom = {
    code:padHost.room, hostKey:padHost.hostKey, kind:'class', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0,
    teams:{ PADORIG1:paddedOrigin }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const padImport = await post('/api/host/import', { snapshot: padRoom });
  check('a crafted room with a whitespace-padded rejected name imports cleanly', () => {
    assert.ok(!padImport.error, 'import failed: ' + padImport.error);
  });
  const padResubmit = await post('/api/team/save', { code:'PADORIG1', country:{ name:'Padded Republic' } });
  check('a rejected name that itself carried surrounding whitespace is still matched once both sides are trimmed', () => {
    assert.ok(padResubmit.error, 'a cleanly-typed resubmission matching the padded rejected name (once trimmed) was accepted');
  });

  await post('/api/team/save', { code: two.code, country: { name:'Verdana' } });
  st = await get('/api/state?code=' + two.code);
  check('saving a new name clears the request', () => {
    assert.strictEqual(st.team.renameAsked, false, 'the nudge banner would never go away');
    assert.strictEqual(st.team.name, 'Verdana');
  });
  const genuineCommit = await post('/api/team/commit', { code: two.code });
  check('a genuine rename clears the flag and lets commit through', () => {
    assert.ok(!genuineCommit.error, 'commit was still refused after a genuinely different name was saved: ' + genuineCommit.error);
  });
  const afterGenuine = await get('/api/state?code=' + two.code);
  check('the committed country carries the genuinely new name, not the rejected one', () => {
    assert.strictEqual(afterGenuine.team.locked, true);
    assert.strictEqual(afterGenuine.team.name, 'Verdana');
  });

  const teacherFix = await post('/api/host/country', { room:r.room, hostKey:r.hostKey, code:one.code, act:'rename', name:'Solaria Prime' });
  check('a teacher can rename a country directly', () => {
    assert.ok(!teacherFix.error, 'rename failed: ' + teacherFix.error);
    assert.strictEqual(teacherFix.roster.find(x => x.code === one.code).name, 'Solaria Prime');
  });

  const reopened = await post('/api/host/country', { room:r.room, hostKey:r.hostKey, code:one.code, act:'reopen' });
  const edited = await post('/api/team/save', { code: one.code, country: { motto:'Onward' } });
  check('reopening lets a group fix a genuine mistake', () => {
    assert.ok(!reopened.error);
    assert.ok(!edited.error, 'a reopened country was still locked: ' + edited.error);
  });

  /* A classroom teacher owns their own roster — a duplicate group, a country
     made while setting up, a group that merged into another. This used to be
     refused outright, and the refusal pointed at 🔓 (reopen), which unlocks a
     country but leaves its name, so the suggested route never actually worked:
     the only way through was ↩️ and then the bin. The console confirms by name
     before it gets here. */
  const removedNamed = await post('/api/host/country', { room:r.room, hostKey:r.hostKey, code:one.code, act:'remove' });
  const afterRemove = await post('/api/host/roster', { room:r.room, hostKey:r.hostKey });
  check('a teacher can remove a group that has already built something', () => {
    assert.ok(!removedNamed.error, 'a classroom teacher could not clear a country off their own roster: ' + removedNamed.error);
    assert.ok(!afterRemove.roster.some(x => x.code === one.code), 'the row is still on the roster after being removed');
  });
  const ghost = await get('/api/state?code=' + one.code);
  check('a removed country cannot be reached by its old leader code', () => {
    assert.ok(ghost.error, 'a deleted country still answers to its leader code');
  });

  /* The hall keeps the old refusal. Removing a country there is the same
     "vanishes from a projected leaderboard mid-game, with no notice and no
     route back" that askRename is refused for below — and unlike a classroom
     roster, nobody in the hall owns that country's work. */
  const hallRemove = await post('/api/host/country',
    { room:hallHost.room, hostKey:hallHost.hostKey, code:'HALLA001', act:'remove' });
  const hallStill = await post('/api/host/roster', { room:hallHost.room, hostKey:hallHost.hostKey });
  check('a country playing in the hall is still not removable', () => {
    assert.ok(hallRemove.error, 'a committed country was deleted off a projected hall leaderboard');
    assert.ok(hallStill.roster.some(x => x.code === 'HALLA001'), 'the hall country went anyway');
  });

  const notHost = await post('/api/host/country', { room:r.room, hostKey:'WRONGKEY', code:two.code, act:'askRename' });
  check('moderation needs the host key', () => {
    assert.ok(notHost.error, 'anyone could moderate this room');
  });

  /* -------- final-review finding 2: ask-to-rename must be refused on a hall
     room, server-side, not merely hidden behind the console's ↩️ button. On
     a hall roster blanking a country's name (server.js: team.name='') drops
     it straight out of board()'s name filter — the country vanishes from
     the projected leaderboard mid-game, with no student-side notice (the
     rename banner and toast are both prep-phase/classroom-only) and no way
     back (the group's own retype is refused by the rejectedName guard).
     hallHost (still live from the fixture above, kind:'hall') is reused
     here. -------- */
  const hallAskRename = await post('/api/host/country', { room:hallHost.room, hostKey:hallHost.hostKey, code:'HALLA001', act:'askRename' });
  check('ask-to-rename is refused on a hall room', () => {
    assert.ok(hallAskRename.error, 'a hall room accepted the askRename action — this can vanish a country from the projected leaderboard mid-game');
  });
  check('the refusal says where name moderation actually belongs, not just "no"', () => {
    assert.ok(/classroom/i.test(hallAskRename.error),
      'the refusal does not tell the teacher to do this in the classroom instead: ' + hallAskRename.error);
  });
  const hallAAfterRefusal = await get('/api/state?code=HALLA001');
  check('the refused askRename left the hall country exactly as it was — still named, still on the board', () => {
    assert.strictEqual(hallAAfterRefusal.team.name, 'Hallandia', 'a refused askRename still blanked the country\'s name');
    assert.strictEqual(hallAAfterRefusal.team.renameAsked, false, 'a refused askRename still set renameAsked');
  });
  const boardAfterRefusal = await get('/api/room?room=' + hallHost.room);
  check('the country is still on the hall board after the refused askRename', () => {
    assert.ok(boardAfterRefusal.board.some(row => row.name === 'Hallandia'),
      'the country vanished from the projected hall board despite askRename being refused');
  });

  if (!ran) console.error('FAIL  moderation.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  moderation — committing locks a country in prep, and never blocks play in the hall');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
