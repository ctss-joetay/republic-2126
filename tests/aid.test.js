/* Spec D. Harness copied from strike.test.js — a real running hall, because a
   hall country only exists at the end of the real join -> save -> commit ->
   join-hall path, and no unit test can fake the room state that path
   produces. This file is Task 7's; Tasks 8-10 append their own checks ABOVE
   the summary block (the console.log + done(...) at the bottom), using the
   same fixture bindings. done() returns synchronously — it registers an exit
   listener and calls kill(), it does not block — so any check placed AFTER
   it still runs, but against a `fails` count and a printed summary that were
   already locked in one line earlier. A check placed there can fail with
   zero effect on the reported result or the exit code: a silently discarded
   test. The fixture is left in `game` phase, deliberately and verified —
   every aid route requires it. An appended block that moves the phase away
   from `game` (as the last check in this file does, to reach the appeal
   route's own phase guard) must put it back before returning control, or
   the next task's first check fails on a phase refusal that has nothing to
   do with it. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, loadFn } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3365;
const BASE = `http://127.0.0.1:${PORT}`;
const HALL_PASS = 'letmein1';
const ADMIN_PASS = 'a-very-long-admin-key-for-aid-tests';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-aid-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p, q) => fetch(BASE + p + '?' + new URLSearchParams(q)).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, HALL_KEY: HALL_PASS, ADMIN_KEY: ADMIN_PASS },
  stdio: 'ignore'
});
const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  let fails = 0, ran = 0;
  const check = async (name, fn) => { ran++; try { await fn(); console.log('PASS  ' + name); }
    catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

  /* Fixture shape copied from strike.test.js/programmes.test.js; two
     countries, so a per-country cooldown can be shown not to leak into a
     country that was never struck. */
  const hall = await post('/api/host/create', { kind:'hall', key:HALL_PASS, label:'Hall' });
  assert.ok(!hall.error, 'could not open a hall room: ' + hall.error);
  const R = { room: hall.room, hostKey: hall.hostKey };

  const cls = await post('/api/host/create', { kind:'class' });
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
  const trust = await post('/api/admin/trust', { key:ADMIN_PASS, room:cls.room });
  assert.ok(!trust.error, 'fixture could not trust the classroom: ' + trust.error);

  const makeCountry = async (name) => {
    const j = await post('/api/join', { room:cls.room, name, homeland:'dry' });
    assert.ok(!j.error, 'fixture could not join: ' + j.error);
    /* estate:1, not 2 — the brief's fixture calls for 2, but on the 'dry'
       homeland (F3 base food, estate needs F2 each) a second estate drives
       Food to -1, so /api/team/save's free() check reverts the WHOLE call —
       including the members set in this same request — and commit then
       fails with "Name your Leader before you commit.". estate:1 is exactly
       programmes.test.js's already-affordable fixture and still leaves
       capacity() at 9, enough for a strike to move displaced off zero. */
    await post('/api/team/save', { code:j.code, country:{
      members:{ leader:'Kai', def:'Sara', trade:'Wen', infra:'Ali', edu:'Nur' },
      split:{ edu:6, def:6, trade:6, infra:6 }, buildings:{ estate:1 } } });
    await post('/api/team/save', { code:j.code, country:{ industries:{ fact:1, port:2 } } });
    const cm = await post('/api/team/commit', { code:j.code });
    assert.ok(!cm.error, 'fixture could not commit: ' + cm.error);
    const jh = await post('/api/team/join-hall', { code:j.code, room:hall.room });
    assert.ok(!jh.error, 'fixture could not join the hall: ' + jh.error);
    const st = await get('/api/state', { code:j.code });
    return { code:j.code, minCodes:j.team.minCodes, viewCode:j.team.viewCode, pid:st.team.pid, name };
  };

  const A = await makeCountry('Bakau');
  const B = await makeCountry('Selat');
  const state = (code) => get('/api/state', { code });

  /* ---------------- Task 7: the appeal ---------------- */

  /* Not tested here in 'prep': a committed hall country in 'prep' is refused
     by writable()'s own locked-check ("Your country is committed…") before
     the route body's `room.phase !== 'game'` line is ever reached — every
     country in this fixture is committed by the time it joins the hall, so
     that guard is unreachable from 'prep' by construction, not by oversight.
     The route's own phase guard is exercised below, in 'final', once the
     mass game has been called — writable()'s locked-check only fires for
     phase==='prep', so 'final' is the phase where this route's own check is
     the one that actually answers. */

  await post('/api/host/act', { ...R, act:'phase', phase:'game' });

  /* Three rounds of income here, before anybody is struck, the same way
     programmes.test.js funds its buys — Task 8's aid checks spend coins on
     top of what /api/team/save left each country holding, and the biggest
     spend (a deliberately oversized gift, to prove the clamp) needs more
     than a single round's income covers. Placed before any strike lands:
     advanceRound() decays displaced by 2 a round, so run here — while
     displaced is still 0 for everyone and there is nothing to decay — never
     after. */
  for (let i = 0; i < 3; i++) await post('/api/host/act', { ...R, act:'round' });

  await check('a country with nobody displaced cannot ask for help', async () => {
    const r = await post('/api/aid/appeal', { code:A.code });
    assert.ok(r.error, 'a country asked the hall for help it did not need');
  });

  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[A.pid] });

  await check('the Defence Minister can ask — the one whose defences just failed', async () => {
    const r = await post('/api/aid/appeal', { code:A.minCodes.def });
    assert.ok(!r.error, 'the Defence Minister was refused: ' + r.error);
  });

  await check('a second appeal inside the cooldown is refused, so the projector is not spammed', async () => {
    const r = await post('/api/aid/appeal', { code:A.minCodes.def });
    assert.ok(r.error, 'a group could hammer the feed');
  });

  await check('the Trade Minister cannot appeal, and is told who can', async () => {
    const r = await post('/api/aid/appeal', { code:A.minCodes.trade });
    assert.ok(r.error, 'Trade appealed');
    assert.ok(/Defence/.test(r.error), 'the refusal does not name who can do it: ' + r.error);
  });

  await check('the class code watches and does not drive', async () => {
    const r = await post('/api/aid/appeal', { code:A.viewCode });
    assert.ok(r.error, 'the class code appealed');
  });

  await check('the Leader can always appeal, whoever else can', async () => {
    /* A fresh strike on B rather than waiting out A's cooldown: the cooldown
       is per country, and this is a different country. */
    await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[B.pid] });
    const r = await post('/api/aid/appeal', { code:B.code });
    assert.ok(!r.error, 'the Leader was refused: ' + r.error);
  });

  await check('the appeal names how many, phrased in the singular for exactly one', async () => {
    /* At this fixture's founding Defence (50, untouched by raid's fx:{S,H})
       and capacity (9), one raid's hit is exactly 1 (see the comment on
       Task 8's fixture setup below for the same arithmetic) — B was struck
       once, immediately above, and the appeal that follows names it. The
       route used to write "1 people have lost their homes"; the singular
       reads "1 person lost their home". */
    const d = await get('/api/room', { room: hall.room });
    assert.ok(d.feed[0].text.includes('1 person lost their home'),
      'the appeal did not phrase a single displaced person in the singular: ' + d.feed[0].text);
  });

  await check('once the mass game is called, an appeal is refused by name, not by cooldown or by displaced', async () => {
    /* B is displaced (struck two checks up) and is inside its own 30s
       cooldown (the check just above succeeded) — both of those would also
       leave r.error truthy, so a bare truthiness assertion here could not
       tell "the mass game is over" apart from either of them. The exact
       text is what proves the phase guard, specifically, is what answered. */
    await post('/api/host/act', { ...R, act:'phase', phase:'final' });
    const r = await post('/api/aid/appeal', { code:B.code });
    assert.strictEqual(r.error, 'Help is asked for during the mass game.',
      'the phase guard is gone, or was reached for the wrong reason: ' + r.error);
  });

  /* The check above had to leave the room in 'final' to reach the appeal
     route's own phase guard — every aid route needs 'game', and this file is
     the shared foundation Tasks 8-10 append to, so it cannot hand off in
     'final' and leave the next task's first check failing on a phase refusal
     that has nothing to do with it. Put back explicitly rather than trusting
     the flip happened silently. */
  await post('/api/host/act', { ...R, act:'phase', phase:'game' });

  await check('the fixture hands off in game phase, restored after reaching for final above', async () => {
    const d = await get('/api/room', { room: hall.room });
    assert.strictEqual(d.phase, 'game',
      'the restore to game phase did not take — every appended check after this one will see the wrong phase');
  });

  /* ---------------- Task 8: aid ---------------- */

  /* Fixture setup, not a check: at this fixture's Defence meter (50) and
     capacity (9), one raid's exposure is (60-50)/60 ~= 0.167, so
     strikeCountry's `hit = ceil(capacity*exposure/3)` is exactly 1 — B's
     single strike from Task 7's "the Leader can always appeal" check left it
     with displaced:1, not enough for the checks below. `coins rehouse at the
     crisis rate` spends for 2 people specifically so that number can't be
     mistaken for a 1-for-1 coincidence, and the checks after it (giving
     moves Harmony -> strikes again -> rehousing clamped) walk displaced down
     assuming there is still somebody short after each step. Two more raids
     here walk B up to strikeCountry's own cap (`ceil(capacity/3) = 3`,
     confirmed by inspection — raid's fx:{S,H} never touches the shield meter
     D, so exposure and hence hit stay fixed at 1 across repeated strikes)
     before any Task 8 check runs. */
  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[B.pid] });
  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[B.pid] });
  const bAfterSetupStrikes = (await state(B.code)).team;
  assert.strictEqual(bAfterSetupStrikes.displaced, 3,
    'fixture: B should be walked up to the strike cap before the Task 8 checks begin, got ' + bAfterSetupStrikes.displaced);

  await check('the exchange rates are exported, so the button label and the server agree', () => {
    assert.strictEqual(E.AID_PER_PERSON, 2);
    assert.strictEqual(E.AID_COINS_PERSON, 6);
  });

  /* Fixture setup, not a check: the anti-farm gate needs a receiver that is
     genuinely never struck, sent from a country other than itself. Every
     country this file has touched so far (A, B) has already taken at least
     one raid by this point, so neither can stand in for "not asking for
     help." Tanjong is that spare, untouched throwaway — the same country the
     "negative goods" check below also uses, struck there once it needs
     displaced > 0 to accept a gift. */
  const tanjong = await makeCountry('Tanjong');

  await check('a country that is not struck cannot be gifted — the anti-farm gate', async () => {
    const st = await state(tanjong.code);
    assert.strictEqual(st.team.displaced, 0, 'fixture: Tanjong should not be struck here');
    /* Sent from B, not from Tanjong itself. The brief's original version of
       this check sent A -> A: sender and receiver were the same country, so
       the route's self-gift guard (two lines above the anti-farm gate)
       answered first and the gate itself was never reached — this check was
       redundant with "you cannot send help to yourself" right after it, and
       would have kept passing even with `to.displaced > 0` deleted from the
       route entirely. Sending B -> Tanjong reaches the gate for real, and
       asserting its own error text (not just truthiness) means a
       wrong-reason refusal — wrong minister, insufficient funds, a
       resurrected self-gift check — cannot satisfy this check either. */
    const r = await post('/api/aid/send', { code:B.minCodes.trade, to:tanjong.pid, coins:6 });
    assert.strictEqual(r.error, `${tanjong.name} is not asking for help.`,
      'the anti-farm gate did not answer, or answered for the wrong reason: ' + r.error);
  });

  await check('you cannot send help to yourself', async () => {
    const r = await post('/api/aid/send', { code:B.minCodes.trade, to:B.pid, coins:6 });
    assert.ok(r.error, 'a struck country rehoused itself out of its own pocket for free score');
  });

  await check('a negative gift is a theft, and is clamped to nothing', async () => {
    const before = (await state(B.code)).team;
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid, coins:-50 });
    const after = (await state(B.code)).team;
    assert.ok(after.coins >= before.coins, 'coins were taken OUT of a struck country');
    if (!r.error) assert.strictEqual(r.rehoused, 0, 'a negative gift rehoused somebody');
  });

  /* Not in the brief's own check above, added on self-review: that check
     sends coins:-50 alone, and with no goods offered `raw` (the person count)
     is negative on its own, so the route's `n<=0` bail-out catches it whether
     or not Math.max(0, ...) is actually applied — confirmed by deleting the
     clamp from the route and re-running the whole file: 19/19 still passed.
     The clamp only earns its keep once a genuine positive term is large
     enough to outweigh a hidden negative one — the exact shape that let a
     negative `give` become a withdrawal once accepted in /api/trade/offer.
     Coins are the cheap way to build that outweighing term here (goods would
     need a stockpile this fixture's giver does not have — /api/team/save's
     fixture leaves it 2 spare Materials and 1 spare Food, nowhere near
     enough): send negative goods alongside enough real coins to make the
     total person-count arithmetic come out positive anyway, and check the
     negative goods were never credited back as stock. Tanjong (the spare
     throwaway created above for the anti-farm gate check, still unstruck
     until the line below) rather than A or B, so this does not touch either
     country's own displaced trajectory the checks below depend on. */
  await check('negative goods cannot be hidden behind a big enough coin payment', async () => {
    await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[tanjong.pid] });
    const giverBefore = (await state(A.code)).team;
    const spend = 42; // floor(42/6)=7, enough to outweigh give:{M:-6,F:-6} (floor(-12/2)=-6) and still clear n>0
    assert.ok(giverBefore.coins >= spend, 'fixture: the giver cannot even afford to attempt this');
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:tanjong.pid,
                                            give:{ M:-6, F:-6 }, coins:spend });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    const giverAfter = (await state(A.code)).team;
    assert.ok((giverAfter.stock.M||0) <= (giverBefore.stock.M||0),
      `negative Materials came back as free stock: ${giverBefore.stock.M} -> ${giverAfter.stock.M}`);
    assert.ok((giverAfter.stock.F||0) <= (giverBefore.stock.F||0),
      `negative Food came back as free stock: ${giverBefore.stock.F} -> ${giverAfter.stock.F}`);
  });

  /* Review Finding 1, pinned: a mixed goods-and-coins gift used to charge
     Materials or Food that rehoused nobody, because usedGoods was the raw
     Math.min() rather than floored down to a whole multiple of
     AID_PER_PERSON first. No check above combines nonzero goods with nonzero
     coins on a path that reaches this arithmetic — "a negative gift is a
     theft" sends coins alone, and "negative goods cannot be hidden" clamps
     give to 0 before the charge is computed. Fresh giver and receiver, not
     A/B/Tanjong, so this pair does not touch the displaced/coin trajectory
     the checks around it depend on. Struck three times up front — the same
     cap B was walked to at the top of this section — so there is enough
     displaced for both cases below without a fixture restrike in between. */
  const giver1 = await makeCountry('Kallang');
  const taker1 = await makeCountry('Punggol');
  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[taker1.pid] });
  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[taker1.pid] });
  await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[taker1.pid] });
  const taker1AfterSetup = (await state(taker1.code)).team;
  assert.strictEqual(taker1AfterSetup.displaced, 3,
    'fixture: Punggol should be walked up to the strike cap before this pair of checks, got ' + taker1AfterSetup.displaced);

  await check('a mixed gift does not charge goods that rehoused nobody', async () => {
    /* raw = floor(give.M / AID_PER_PERSON) + floor(coins / AID_COINS_PERSON)
           = floor(1/2) + floor(13/6) = 0 + 2 — both credited people come
       from the coins; the 1 Material credits zero. Before the fix, usedGoods
       was Math.min(give.M+give.F, left*AID_PER_PERSON) = min(1, 4) = 1 — a
       whole Material charged for a person it never housed. */
    const fixtureCheck = await state(giver1.code);
    assert.ok(fixtureCheck.free.M >= 1 && fixtureCheck.team.coins >= 13,
      'fixture: Kallang cannot afford this case');
    const giverBefore = (await state(giver1.code)).team;
    const r = await post('/api/aid/send', { code:giver1.minCodes.trade, to:taker1.pid,
                                            give:{ M:1 }, coins:13 });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    assert.strictEqual(r.rehoused, 2, 'coins alone should have rehoused exactly 2');
    const giverAfter = (await state(giver1.code)).team;
    assert.strictEqual(giverAfter.stock.M, giverBefore.stock.M,
      'a Material that rehoused nobody was charged anyway');
  });

  await check('a mixed gift DOES charge goods that actually rehoused somebody', async () => {
    /* The other branch, so the check above cannot pass merely because goods
       are never charged at all: give.M=2 alone credits floor(2/2)=1 whole
       person, and that Material spend must actually be deducted. */
    const fixtureCheck = await state(giver1.code);
    assert.ok(fixtureCheck.free.M >= 2, 'fixture: Kallang cannot afford this case');
    const takerBefore = (await state(taker1.code)).team;
    assert.ok(takerBefore.displaced >= 1,
      'fixture: Punggol needs somebody left displaced for this case, got ' + takerBefore.displaced);
    const giverBefore = (await state(giver1.code)).team;
    const r = await post('/api/aid/send', { code:giver1.minCodes.trade, to:taker1.pid,
                                            give:{ M:2 }, coins:0 });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    assert.strictEqual(r.rehoused, 1, 'two Materials should have rehoused exactly 1 person');
    const giverAfter = (await state(giver1.code)).team;
    assert.strictEqual(giverAfter.stock.M, giverBefore.stock.M - 2,
      'Materials that actually rehoused somebody were not charged');
  });

  await check('the Education Minister cannot send aid, and is told who can', async () => {
    const r = await post('/api/aid/send', { code:A.minCodes.edu, to:B.pid, coins:6 });
    assert.ok(r.error, 'Education sent aid');
    assert.ok(/Trade/.test(r.error), 'the refusal does not name who can: ' + r.error);
  });

  await check('you cannot send coins you do not have', async () => {
    const mine = (await state(A.code)).team;
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid, coins:mine.coins + 500 });
    assert.ok(r.error, 'a country spent coins it never had');
  });

  await check('coins rehouse at the crisis rate and the giver is charged', async () => {
    const giverBefore = (await state(A.code)).team;
    const takerBefore = (await state(B.code)).team;
    const spend = E.AID_COINS_PERSON * 2;
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid, coins:spend });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    const giverAfter = (await state(A.code)).team;
    const takerAfter = (await state(B.code)).team;
    assert.strictEqual(giverAfter.coins, giverBefore.coins - spend, 'the giver was not charged');
    assert.strictEqual(takerAfter.displaced, takerBefore.displaced - r.rehoused, 'nobody was rehoused');
    assert.strictEqual(r.rehoused, 2);
  });

  await check('giving moves the GIVER\'s Harmony — this is the whole point', async () => {
    const before = (await state(A.code)).team.meters.H;
    await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[B.pid] });
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid, coins:E.AID_COINS_PERSON });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    const after = (await state(A.code)).team.meters.H;
    assert.ok(after > before, `Harmony did not move: ${before} -> ${after}`);
  });

  await check('rehousing is clamped to what is left, so a big gift is not wasted arithmetic', async () => {
    const taker = (await state(B.code)).team;
    const need = taker.displaced;
    assert.ok(need > 0, 'fixture: B is not struck');
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid,
                                            coins: E.AID_COINS_PERSON * (need + 10) });
    assert.ok(!r.error, 'aid was refused: ' + r.error);
    assert.strictEqual(r.rehoused, need, 'more people were rehoused than had lost their homes');
    assert.strictEqual((await state(B.code)).team.displaced, 0);
  });

  await check('a country rehoused to zero is no longer flagged as struck', async () => {
    const t = (await state(B.code)).team;
    assert.strictEqual(t.displaced, 0);
    assert.ok(!t.struck, 'the banner would still be up with nobody displaced');
  });

  /* Not in the brief's own Step 1 block, added on self-review: the third
     rule this whole route is built on — "achieve this by simply not calling
     discussing()" — has no regression guard without a check like this one.
     None of the checks above ever open a scenario card, so an edit that put
     a discussing() call back into /api/aid/send would leave every one of
     them green. Proves the window is genuinely open FIRST, the same way
     /api/trade/offer itself would answer if asked right now — otherwise a
     card that silently failed to open would let this check pass for the
     wrong reason. */
  await check('aid is not blocked by the discussion window, unlike trade — and the window is proven open first', async () => {
    await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[B.pid] });
    await post('/api/host/act', { ...R, act:'scenario' });
    const trade = await post('/api/trade/offer', { code:A.minCodes.trade, to:B.pid, give:{} });
    assert.ok(/discussing the card/.test(trade.error || ''),
      'fixture: the discussion window was not actually open — ' + (trade.error || '(no error)'));
    const before = (await state(B.code)).team;
    assert.ok(before.displaced > 0, 'fixture: B is not struck');
    const r = await post('/api/aid/send', { code:A.minCodes.trade, to:B.pid, coins:E.AID_COINS_PERSON });
    assert.ok(!r.error, 'aid was blocked by the discussion window: ' + r.error);
    await post('/api/host/act', { ...R, act:'clear' });
  });

  /* ---------------- the trap this design exists to avoid ---------------- */

  await check('a struck country\'s autosave echo restores nothing and moves nobody', async () => {
    /* THE reason displaced is server-owned. Hall buildings merge UPWARD
       (growCounts): an incoming count is only ever accepted when it is HIGHER
       than the stored one. Had this spec recorded damage by lowering a
       building count, the very next autosave from a student's iPad — which
       still holds the pre-strike map — would have read as new construction:
       the homes restored free, logGrowth writing "Built 2 x Homes", and a
       meter bonus paid for being bombed.
       This posts exactly that echo and asserts nothing moves. */
    await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[A.pid] });
    const before = (await state(A.code)).team;
    assert.ok(before.displaced > 0, 'fixture: A is not struck');
    const echo = await post('/api/team/save', { code:A.code, country:{
      buildings: before.buildings, industries: before.industries } });
    assert.ok(!echo.error, 'the echo itself was refused: ' + echo.error);
    const after = (await state(A.code)).team;
    assert.strictEqual(after.displaced, before.displaced,
      'an autosave echo changed how many people are displaced');
    assert.deepStrictEqual(after.buildings, before.buildings,
      'an autosave echo rebuilt something');
    assert.ok(after.struck, 'an autosave echo cleared the strike');
  });

  /* ---------------- Task 9: the banner ---------------- */
  const bannerFn = loadFn('strikeBanner', { esc:(s)=>String(s) }, path.join(ROOT, 'public', 'index.html'));

  await check('a country that was never struck draws no banner at all', () => {
    assert.strictEqual(bannerFn({ displaced:0 }, 'leader'), '');
    assert.strictEqual(bannerFn({}, 'leader'), '');
  });

  await check('a struck country reads its own strike, not a generic line', () => {
    const html = bannerFn({ displaced:4, struck:{ icon:'☠️', title:'Rogue nation raid',
      line:'Armed raiders crossed the border in the night.' } }, 'leader');
    assert.ok(html.includes('Rogue nation raid'), 'the headline is missing');
    assert.ok(html.includes('Armed raiders'), 'the story is missing');
    assert.ok(html.includes('4'), 'the number displaced is missing');
  });

  await check('the Leader and Defence get the button; nobody else does', () => {
    const s = { displaced:4, struck:{ icon:'☠️', title:'T', line:'L' } };
    assert.ok(bannerFn(s, 'leader').includes('askForHelp'), 'the Leader cannot ask');
    assert.ok(bannerFn(s, 'def').includes('askForHelp'), 'Defence cannot ask');
    assert.ok(!bannerFn(s, 'trade').includes('askForHelp'), 'Trade was given the appeal button');
    assert.ok(!bannerFn(s, 'edu').includes('askForHelp'), 'Education was given the appeal button');
    assert.ok(!bannerFn(s, 'member').includes('askForHelp'), 'a watching member was given the appeal button');
  });

  await check('a strike headline that looks like HTML is escaped, not rendered', () => {
    /* Every check above stubs esc as String(s), which cannot tell an escaped
       interpolation from an unescaped one — dropping esc() from the title
       would leave all of them green. Wire the REAL esc (extracted from the
       shipped page, no deps of its own) in for this one check. Same shape as
       cabinet-screen.test.js's Leader-name check; copy that, do not invent a
       new one. */
    const realEsc = loadFn('esc', {}, path.join(ROOT, 'public', 'index.html'));
    const strict = loadFn('strikeBanner', { esc: realEsc }, path.join(ROOT, 'public', 'index.html'));
    const html = strict({ displaced:1, struck:{ icon:'x', title:'<img src=x onerror=alert(1)>', line:'L' } }, 'leader');
    assert.ok(!html.includes('<img'), 'a strike title was injected as markup');
    assert.ok(html.includes('&lt;img'), 'the title was dropped rather than escaped');
  });

  /* ---------------- Task 10: the aid card ---------------- */
  const aidCardFn = loadFn('aidCard', { esc:(s)=>String(s), ENGINE:E }, path.join(ROOT, 'public', 'index.html'));

  const rows = [
    { pid:'AAAAA', name:'Bakau',  displaced:5, strk:'☠️' },
    { pid:'BBBBB', name:'Selat',  displaced:0, strk:'' },
    { pid:'CCCCC', name:'Merlion',displaced:2, strk:'🌊' }
  ];

  await check('a hall with nobody struck shows no aid card', () => {
    assert.strictEqual(aidCardFn([rows[1]], [], 'ZZZZZ', 'trade'), '');
  });

  await check('only struck countries are listed', () => {
    const html = aidCardFn(rows, [], 'ZZZZZ', 'trade');
    assert.ok(html.includes('Bakau'), 'a struck country is missing');
    assert.ok(html.includes('Merlion'), 'a struck country is missing');
    assert.ok(!html.includes('Selat'), 'an unstruck country is offered aid');
  });

  await check('your own country is never on the list', () => {
    const html = aidCardFn(rows, [], 'AAAAA', 'trade');
    assert.ok(!html.includes('Bakau'), 'a country was offered the chance to gift itself');
  });

  await check('allies come first and are marked', () => {
    /* Two allies and two non-allies, not one of each — the original fixture
       (one ally among three rows) could pass with a comparator that only
       moved that single ally to the front by luck of the initial order, so
       it did not prove EVERY ally sorts above EVERY non-ally. A dedicated
       fixture, not the shared `rows` above, so this does not disturb the
       other checks' expectations of what `rows` contains. */
    const mix = [
      { pid:'N1', name:'NonAllyOne', displaced:1, strk:'x' },
      { pid:'A1', name:'AllyOne',    displaced:1, strk:'x' },
      { pid:'N2', name:'NonAllyTwo', displaced:1, strk:'x' },
      { pid:'A2', name:'AllyTwo',    displaced:1, strk:'x' }
    ];
    const html = aidCardFn(mix, ['A1','A2'], 'ZZZZZ', 'trade');
    const posN1 = html.indexOf('NonAllyOne'), posN2 = html.indexOf('NonAllyTwo');
    const posA1 = html.indexOf('AllyOne'),    posA2 = html.indexOf('AllyTwo');
    assert.ok(posA1 < posN1 && posA1 < posN2, 'AllyOne did not sort before every non-ally');
    assert.ok(posA2 < posN1 && posA2 < posN2, 'AllyTwo did not sort before every non-ally');
    assert.ok(html.includes('🤝'), 'an ally is not marked');
  });

  await check('the number still displaced is shown, so a gift is not wasted', () => {
    /* A bare /5/ or /2/ regex passes even with `${r.displaced}` deleted from
       the markup: the card's own border-color hex (#b3452f) contains both
       digits, and every row's send button embeds the hardcoded rate
       AID_PER_PERSON=2 regardless of r.displaced. Matching the surrounding
       phrase, which only exists where the count is genuinely interpolated,
       is the fix — confirmed by deleting the interpolation and watching this
       check (and only this one) go red; see the report for the transcript. */
    const html = aidCardFn(rows, [], 'ZZZZZ', 'trade');
    assert.ok(/5 still without a home/.test(html), 'Bakau\'s displaced count is missing or not interpolated');
    assert.ok(/2 still without a home/.test(html), 'Merlion\'s displaced count is missing or not interpolated');
  });

  /* Fix round 2 (review, owner decision): a send button is now conditional on
     BOTH role and alliance, not role alone — allies keep the one-tap Send,
     everyone else is pointed at the Trade tab's typed pid field instead. Both
     dimensions are pinned separately below: role, holding alliance fixed at
     "nobody is allied" (the shape the check below this one used to assume for
     everybody); and alliance, holding role fixed at the two roles that could
     ever send. */
  await check('Education, Defence, Infrastructure and a watching member never get a send button', () => {
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'edu').includes('sendAid'), 'Education was given a send button');
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'def').includes('sendAid'), 'Defence was given a send button');
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'infra').includes('sendAid'), 'Infrastructure was given a send button');
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'member').includes('sendAid'), 'a member was given a send button');
  });

  await check('Trade and the Leader get no send button either, once nobody struck is an ally', () => {
    /* This is the check the exploit lived in: before this fix, `rows` (no
       allies passed) still drew a tap-to-send button on every struck country
       for these two roles — the whole hall, one tap each, no conversation. */
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'trade').includes('sendAid'), 'Trade got a send button with no allies struck');
    assert.ok(!aidCardFn(rows, [], 'ZZZZZ', 'leader').includes('sendAid'), 'the Leader got a send button with no allies struck');
    assert.ok(/Trade goods/.test(aidCardFn(rows, [], 'ZZZZZ', 'trade')),
      'a stranger row does not point to the Trade goods card');
  });

  await check('Trade and the Leader DO get a send button for a struck ally, and only for the ally row', () => {
    /* Bakau (AAAAA) is made an ally, Merlion (CCCCC) is not — both rows are
       struck (see `rows` above), so alliance is the only variable between
       them. Sliced by name so a button that leaked onto the wrong row (or a
       stray match from the explanatory text) cannot pass this by accident. */
    for (const role of ['trade', 'leader']) {
      const html = aidCardFn(rows, ['AAAAA'], 'ZZZZZ', role);
      const bakauSection = html.slice(html.indexOf('Bakau'), html.indexOf('Merlion'));
      const merlionSection = html.slice(html.indexOf('Merlion'));
      assert.ok(bakauSection.includes('sendAid'), `${role} got no send button for a struck ally`);
      assert.ok(!merlionSection.includes('sendAid'), `${role} got a one-tap send button for a stranger`);
      assert.ok(/Trade goods/.test(merlionSection), `${role}'s stranger row does not point to the Trade goods card`);
    }
  });

  await check('the pid reaches sendAid through this.value, not interpolated into the onclick string', () => {
    /* renderStrikePicker in host.html deliberately avoided exactly this — see
       its own comment — because esc() turning a quote into &#39; only
       protects the HTML attribute; the browser decodes it straight back to a
       real quote before the onclick STRING is parsed as JS. Pids come from a
       fixed alphabet so this was never exploitable, but the two consoles
       should not disagree on the pattern. */
    const html = aidCardFn(rows, ['AAAAA'], 'ZZZZZ', 'trade');
    assert.ok(html.includes(`value="AAAAA"`), 'the pid is not carried in a value attribute');
    assert.ok(html.includes(`onclick="sendAid(this.value`), 'onclick does not read the pid via this.value');
    assert.ok(!html.includes(`sendAid('AAAAA'`), 'the pid is still interpolated straight into the onclick string');
  });

  await check('a country name that looks like HTML is escaped', () => {
    /* The REAL esc, for the reason the banner check above gives: an identity
       stub cannot tell an escaped interpolation from an unescaped one. */
    const realEsc = loadFn('esc', {}, path.join(ROOT, 'public', 'index.html'));
    const strict = loadFn('aidCard', { esc: realEsc, ENGINE:E }, path.join(ROOT, 'public', 'index.html'));
    const html = strict([{ pid:'XXXXX', name:'<img src=x onerror=alert(1)>', displaced:1, strk:'x' }],
                        [], 'ZZZZZ', 'trade');
    assert.ok(!html.includes('<img'), 'a country name was injected as markup');
    assert.ok(html.includes('&lt;img'), 'the name was dropped rather than escaped');
  });

  console.log('');
  console.log(ran - fails + '/' + ran + ' passed');
  done(fails ? 1 : 0);
})();
