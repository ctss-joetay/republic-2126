/* Practice must cost nothing. A classroom runs one drill card once every group
   has committed, watches its meters move, and ends exactly where it started.

   Coins are the half of that promise this file owns. chooseScenario's clamp
   (Math.max(0, coins+coin)) makes reversing a coin delta impossible in general
   — a group on 3 coins hit by -5 lands on 0, and adding 5 back gives 5, not 3 —
   so a classroom card must never move coins in the FIRST place. And that
   suppression has to be scoped to classrooms: a hall card must still move coins
   normally, or the fix has quietly broken the mass game.

   The drill's gate, its rationing and its meter snapshot are pinned separately,
   in tests/drill.test.js. */
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
const PORT = 3326;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-prac-'));
const KEY = 'a-very-long-admin-key-for-practice-tests'; // needed to reach POST /api/admin/rooms below

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

  const E2 = require('../game_engine.js');
  /* `dodger` (below) migrates to the hall through join-hall, which now
     correctly refuses a country whose classroom was never issued from
     /admin — so this room, unlike a room a student opens at /host, has to
     be genuinely admin-issued, the way a real teacher's class actually is. */
  const r = (await post('/api/admin/rooms', { key:KEY, labels:['3J'] })).rooms[0];
  const g = await post('/api/host/groups', { room:r.room, hostKey:r.hostKey, n:1 });
  const one = g.roster[0];
  await post('/api/team/save', { code: one.code, country:{ name:'Practica', members:{ leader:'Ana' } } });

  /* The hall deck is server-side now — required directly, which a test running
     inside the repo may do and a browser may not. */
  const { HALL } = require('../hall-scenarios.js');
  /* Four real cards to throw, chosen BY KEY rather than by position. The array
     order is the host console's running order and is expected to change — the
     four cards written for the 7 August hall were moved to the top of the deck,
     which silently changed which card this file was asserting on. `COIN_CARD`
     is thrown last, so it is the one left open for the coin check below. */
  const COIN_CARD = 'quake';
  const hallKeys = HALL.map(s => s.key).filter(k => k !== COIN_CARD).slice(0, 3).concat(COIN_CARD);

  /* The classroom drill runs AFTER every group has committed — the mechanics of
     that gate, the rationing and the meter snapshot are pinned in
     tests/drill.test.js. What this file still owns is the coin promise: a
     classroom card must move no coins at all, and that suppression must not
     leak into the hall, where cards move coins normally. */
  const early = await post('/api/host/act', { room:r.room, hostKey:r.hostKey, act:'scenario' });
  check('the drill waits for the room to be committed', () => {
    assert.ok(early.error, 'the drill ran before any group had committed');
  });

  await post('/api/team/commit', { code: one.code });
  /* A card now opens with a discussion window in which nobody may decide. A
     10-second card clock is shorter than the 15-second floor discussionEnd()
     leaves to decide in, so the window clamps into the past and the card is
     answerable at once — this test is about what a drill costs, not about the
     window. See tests/discussion-minute.test.js for the window itself. */
  await post('/api/host/act', { room:r.room, hostKey:r.hostKey, act:'timer', secs:10 });
  const dealt  = await post('/api/host/act', { room:r.room, hostKey:r.hostKey, act:'scenario' });
  const second = await post('/api/host/act', { room:r.room, hostKey:r.hostKey, act:'scenario' });
  check('a committed class room gets exactly one drill', () => {
    assert.ok(!dealt.error, 'the drill was refused: ' + dealt.error);
    assert.ok(second.error, 'a second drill was dealt');
  });
  const room3 = await get('/api/room?room=' + r.room);
  check('the console can see the drill has been used', () => {
    assert.strictEqual(room3.practiceLeft, 0);
  });

  /* Choice 'b' — hire private doctors — carries coin:-11 and no ally clause, so
     it is a plain unambiguous coin cost to check against. Named rather than
     indexed blindly, so a reordered card cannot silently make this vacuous. */
  const scChoice = E2.DRILL.choices.find(c => c.key === 'b');
  check('the drill choice used here actually carries a nonzero coin cost', () => {
    assert.ok(scChoice, "the drill has no choice 'b' any more — pick a different deliberate one");
    assert.notStrictEqual(scChoice.coin, 0, 'this choice carries no coin cost, so it cannot prove coins are protected');
    assert.ok(!scChoice.ally, 'an ally choice has its coin cost rewritten by chooseScenario — pick a plain one');
  });

  const beforeChoice = await get('/api/state?code=' + one.code);
  const coinsBefore  = beforeChoice.team.coins;
  const metersBefore = beforeChoice.team.meters;
  await post('/api/scenario/choose', { code: one.code, choice: scChoice.key });
  const during = await get('/api/state?code=' + one.code);

  check('a drill choice actually moves the meters — otherwise restoring them proves nothing', () => {
    const moved = E2.METER_KEYS.some(k => Math.round(during.team.meters[k]) !== Math.round(metersBefore[k]));
    assert.ok(moved, 'the drill choice did not move any meter');
  });
  check('a drill choice does not move coins, even on a choice with a coin cost', () => {
    assert.strictEqual(during.team.coins, coinsBefore,
      'the drill changed coins in a class room — practice is no longer free');
    assert.strictEqual(during.team.chosen.coin, 0,
      'the recorded decision still shows a coin cost the group never actually paid');
  });

  await post('/api/host/act', { room:r.room, hostKey:r.hostKey, act:'clear' });
  const after = await get('/api/state?code=' + one.code);
  check('closing the drill leaves no mark on a committed country', () => {
    assert.ok(during.team.chosen, 'the drill choice was never recorded, so this proves nothing');
    assert.ok(!after.team.chosen, 'a drill choice was carried forward');
    for (const k of E2.METER_KEYS)
      assert.strictEqual(Math.round(after.team.meters[k]), Math.round(metersBefore[k]),
        `${k} still carries drill damage after the card closed`);
  });
  check('coins are still exactly startCoins after a drill and a commit', () => {
    assert.strictEqual(after.team.coins, E2.GAME.startCoins,
      'coins drifted from startCoins even though the only thing this country ever did was commit and run the drill');
  });

  /* A class room never calls advanceRound, so the indecision penalty cannot
     fire there. A group that ignores a practice card entirely pays nothing. */
  const g2 = await post('/api/host/groups', { room:r.room, hostKey:r.hostKey, n:2 });
  const dodger = g2.roster.find(x => x.slot !== one.slot);
  await post('/api/team/save', { code: dodger.code, country:{ name:'Ducker', members:{ leader:'Bo' } } });
  const beforeDodge = await get('/api/state?code=' + dodger.code);
  const foundingDodge = E2.foundingMeters(beforeDodge.team);
  check('a group that ignores every practice card pays nothing', () => {
    for (const k of E2.METER_KEYS)
      assert.strictEqual(Math.round(beforeDodge.team.meters[k]), Math.round(foundingDodge[k]),
        `${k} moved for a country that never touched a practice card — a class room must never call advanceRound`);
  });

  /* A hall room is not rationed. */
  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  /* Every card dealt below has to be answerable straight away: a 10-second
     card clock is under the 15-second floor discussionEnd() leaves to decide
     in, so each window clamps into the past. This block is about coins moving
     in a hall, not about the discussion window. */
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'timer', secs:10 });
  const many = [];
  for (const k of hallKeys) many.push(await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'scenario', key:k }));
  check('a hall room is not rationed', () => {
    assert.ok(many.every(m => !m.error), 'the hall ran out of scenario cards');
  });

  /* The coin suppression must be scoped to a class room, not collateral
     damage to the mass game: a country that migrates into the hall and
     chooses a scenario card there must have its coins move normally.
     writable() only refuses a locked country while phase==='prep', so the
     hall has to be moved into 'game' before a committed country can act
     there — no team has joined the hall yet, so advancing the phase (which
     also runs advanceRound once, since round is still 0) penalises nobody. */
  await post('/api/host/act', { room: hall.room, hostKey: hall.hostKey, act:'phase', phase:'game' });
  await post('/api/team/commit', { code: dodger.code });
  const toHall = await post('/api/team/join-hall', { code: dodger.code, room: hall.room });
  check('the committed dodger reaches the hall', () => {
    assert.ok(!toHall.error, 'moving the committed country into the hall failed: ' + toHall.error);
  });
  /* COIN_CARD was the last card pushed above, so it is the hall's currently
     open scenario. Its choice 'b' carries coin:-4 and no ally clause — a
     plain, unambiguous coin cost to check against, with no ally multiplier to
     confuse the arithmetic. */
  const hallSc = HALL.find(s => s.key === COIN_CARD);
  const hallChoice = hallSc.choices[1];
  const beforeHallChoice = await get('/api/state?code=' + dodger.code);
  const hallCoinsBefore = beforeHallChoice.team.coins;
  check('the hall scenario choice used for this check actually carries a nonzero coin cost', () => {
    assert.ok(hallSc, `the deck no longer contains a '${COIN_CARD}' card — point COIN_CARD at another card whose middle choice costs coins`);
    assert.notStrictEqual(hallChoice.coin, 0, 'this hall card carries no coin cost, so it cannot prove coins still move there');
    assert.ok(!hallChoice.ally, 'the chosen option has an ally clause, which scales its coin cost — pick a plain one');
  });
  const hallChosen = await post('/api/scenario/choose', { code: dodger.code, choice: hallChoice.key });
  check('a hall room applies a scenario choice', () => {
    assert.ok(!hallChosen.error, 'the hall refused a scenario choice from a committed country: ' + hallChosen.error);
  });
  const afterHallChoice = await get('/api/state?code=' + dodger.code);
  check('a hall room\'s scenario choice moves coins normally — that is not collateral damage from the practice fix', () => {
    assert.strictEqual(afterHallChoice.team.coins, hallCoinsBefore + hallChoice.coin,
      'a hall country\'s coins did not move by the card\'s coin value — the class-room coin suppression leaked into the hall');
  });

  if (!ran) console.error('FAIL  practice.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  practice — the drill is free in a class room, and the hall still moves coins');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
