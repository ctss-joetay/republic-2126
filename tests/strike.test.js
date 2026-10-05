/* Spec D. Two halves, in one file for the same reason mandate.test.js keeps
   both: the engine arithmetic can be asserted in-process, but the host act
   needs a real running hall — a hall country only exists at the end of the
   real join -> save -> commit -> join-hall path, and no unit test can fake
   the room state that path produces.

   The fixture below is hall-build.test.js's, copied verbatim rather than
   re-derived, for the traps recorded in that file's comments. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3364;
const BASE = `http://127.0.0.1:${PORT}`;
const HALL_PASS = 'letmein1';
const ADMIN_PASS = 'a-very-long-admin-key-for-strike-tests';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-strike-'));

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

  /* ---------------- Task 1: capacity / housed / displaced ---------------- */

  await check('a new country has nobody displaced', () => {
    assert.strictEqual(E.blankCountry().displaced, 0);
  });

  await check('capacity() is what housed() used to be — displaced does not touch it', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { home: 2 };
    const before = E.capacity(c);
    c.displaced = 3;
    assert.strictEqual(E.capacity(c), before,
      'capacity fell when people were displaced — the strike cap would then feed on its own output');
  });

  await check('housed() falls by exactly the number displaced', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { home: 2 };
    const full = E.housed(c);
    c.displaced = 3;
    assert.strictEqual(E.housed(c), full - 3);
  });

  await check('housed() never goes negative, however many are displaced', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.displaced = 9999;
    assert.strictEqual(E.housed(c), 0);
  });

  await check('a country with no displaced key at all behaves exactly as before', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { home: 2 };
    const withZero = E.housed(c);
    delete c.displaced;
    assert.strictEqual(E.housed(c), withZero,
      'an undefined displaced must read as 0, not as NaN');
  });

  /* ---------------- Task 2: workerPull ---------------- */

  await check('an unstruck country pulls exactly 1 — this change is inert for normal play', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { estate: 1 };
    c.industries = { fact: 1 };
    assert.strictEqual(E.roundIncome(c).workerPull, 1);
  });

  await check('losing a third of the workforce costs about a third of the output', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { estate: 1 };
    c.industries = { fact: 1, port: 3 };
    const full = E.roundIncome(c);
    assert.strictEqual(full.workerPull, 1, 'fixture is already short-staffed — retune it');
    c.displaced = Math.ceil(E.capacity(c) / 3);
    const hurt = E.roundIncome(c);
    assert.ok(hurt.workerPull < 1, 'a displaced workforce cost nothing');
    assert.ok(hurt.net < full.net, 'income did not fall');
  });

  await check('output never falls below the 0.35 floor a stalled industry already uses', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.buildings = { estate: 1 };
    c.industries = { fact: 1, port: 3 };
    c.displaced = 9999;
    assert.strictEqual(E.roundIncome(c).workerPull, 0.35);
  });

  await check('a country running no industries divides by nothing and still pulls 1', () => {
    const c = E.blankCountry();
    c.homeland = 'dry';
    c.displaced = 5;
    assert.strictEqual(E.roundIncome(c).workerPull, 1,
      'used(c).W is 0 here — this is the divide-by-zero guard');
  });

  /* ---------------- Task 3: the table and the arithmetic ---------------- */
  /* strikeCountry lives in server.js and is pulled out with loadFn, exactly
     as mandate.test.js pulls mandateBlock out — the same function the shipped
     server runs, not a retyped copy that could pass while the real one
     regressed. STRIKES is required directly: it is server-only content and a
     test is a server. */
  const { STRIKES } = require('../hall-scenarios.js');
  const { loadFn } = require('./helpers');
  /* strikeCountry closes over lostHomesPhrase (the shared pluraliser the
     log note and the appeal line now both call — see server.js) exactly the
     way it closes over E and STRIKES, so it needs the same treatment: pulled
     out of server.js for real, not stubbed, so a change to the wording is
     picked up here too rather than silently diverging from what the log
     actually writes. */
  const lostHomesPhraseFn = loadFn('lostHomesPhrase', {}, path.join(ROOT, 'server.js'));
  const strikeCountryFn = loadFn('strikeCountry', { E, STRIKES, lostHomesPhrase: lostHomesPhraseFn }, path.join(ROOT, 'server.js'));

  const struckFixture = () => {
    const c = E.blankCountry();
    c.name = 'Testland';
    c.homeland = 'dry';
    c.buildings = { estate: 2 };
    c.coins = 100;
    return c;
  };

  await check('every strike is well formed and shields on a real meter', () => {
    assert.ok(STRIKES.length >= 4, 'fewer than four kinds');
    assert.strictEqual(new Set(STRIKES.map(s => s.key)).size, STRIKES.length, 'two kinds share a key');
    for (const s of STRIKES) {
      assert.ok(s.key && s.icon && s.title && s.line, `${s.key} is missing a field`);
      assert.ok(E.METER_KEYS.includes(s.shield), `${s.key} shields on unknown meter ${s.shield}`);
      assert.ok(Object.keys(s.fx).length > 0, `${s.key} does nothing`);
      for (const m in s.fx) {
        assert.ok(E.METER_KEYS.includes(m), `${s.key} moves unknown meter ${m}`);
        assert.ok(s.fx[m] < 0, `${s.key} RAISES ${m} — a strike only ever costs`);
      }
    }
  });

  await check('more than one meter shields — Defence is not the only protection', () => {
    assert.ok(new Set(STRIKES.map(s => s.shield)).size >= 2,
      'every kind shields on the same meter, so only one pillar ever protects anyone');
  });

  await check('a country at or above 60 in the shielding meter is untouched', () => {
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 60 };
    const beforeMeters = { ...c.meters };
    const beforeCoins = c.coins;
    const row = strikeCountryFn(c, raid, 3);
    assert.strictEqual(row.held, true, 'a shielded country was not recorded as holding the line');
    assert.strictEqual(c.displaced, 0);
    assert.strictEqual(c.coins, beforeCoins, 'a shielded country was still charged');
    assert.deepStrictEqual(c.meters, beforeMeters,
      'a shielded country still had a meter moved — the held branch must return before applyFx runs');
  });

  await check('a hold never overwrites an ongoing crisis in t.struck', () => {
    /* t.struck is the record of damage a country is CURRENTLY living with,
       not a log of events — Task 5 clears it the instant displaced reaches 0.
       A country still displaced from strike 1 that then holds strike 2 is
       still living with strike 1, and must keep reporting it: overwriting
       t.struck with the held strike would replace a real casualty count with
       an event that cost nothing. */
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 0 };
    strikeCountryFn(c, raid, 3);
    const firstStruck = { ...c.struck };
    const firstDisplaced = c.displaced;
    assert.ok(firstDisplaced > 0, 'fixture did not actually take damage on the first strike');

    c.meters = { ...c.meters, [raid.shield]: 60 };
    const row = strikeCountryFn(c, raid, 4);
    assert.strictEqual(row.held, true, 'the second strike was not held despite a raised shield');
    assert.strictEqual(c.displaced, firstDisplaced, 'a held strike moved displaced');
    assert.deepStrictEqual(c.struck, firstStruck,
      'a held strike overwrote the record of the first, real strike');
    assert.strictEqual(c.struck.round, 3, 't.struck no longer names the round of the real strike');
    assert.ok(c.struck.displaced > 0, 't.struck lost its casualty count after a held second strike');
  });

  await check('a country with no shield at all loses exactly the cap', () => {
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 0 };
    const cap = Math.ceil(E.capacity(c) / 3);
    const row = strikeCountryFn(c, raid, 3);
    assert.strictEqual(c.displaced, cap);
    assert.strictEqual(row.displaced, cap);
    assert.strictEqual(row.held, false);
  });

  await check('the cap binds on the RUNNING TOTAL, not on one hit', () => {
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    /* 45, not 30. At this fixture's capacity (10, cap 4) a shield of 30 now
       clamps exposure to 1 and reaches the cap in one hit — the /30 retune
       (exposure = (60-shield)/30, up from /60) doubled exposure across the
       board, and this fixture's whole point is a hit that does NOT reach the
       cap on its own. Tuned upward, not the assertion weakened: 45 leaves
       exposure at 0.5 and the first hit at 2, still short of the cap, so the
       precondition below holds again and three strikes are still required to
       prove the cap binds on the RUNNING total rather than any one hit. */
    c.meters = { ...c.meters, [raid.shield]: 45 };
    const cap = Math.ceil(E.capacity(c) / 3);
    strikeCountryFn(c, raid, 3);
    const afterOne = c.displaced;
    assert.ok(afterOne > 0 && afterOne < cap, 'fixture does not reach the cap in one hit — retune the shield');
    strikeCountryFn(c, raid, 4);
    strikeCountryFn(c, raid, 5);
    assert.strictEqual(c.displaced, cap,
      'three strikes pushed a country past a third of its workforce — the cap is not binding on the total');
  });

  await check('coins are charged in proportion to exposure, never below zero', () => {
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 0 };
    c.coins = 100;
    strikeCountryFn(c, raid, 3);
    assert.strictEqual(c.coins, 90, '10% of 100 at full exposure');
    c.coins = 0;
    strikeCountryFn(c, raid, 4);
    assert.strictEqual(c.coins, 0, 'a broke country went into debt');
  });

  await check('a single displaced person is phrased in the singular, not "1 people ... homes"', () => {
    /* Four sites used to word this event differently, and none of them
       pluralised — the log note wrote `${lost} lost their homes`, so a
       lightly-defended country read "1 lost their homes" on its own story.
       lostHomesPhrase() (server.js, above strikeCountry) is now the one
       phrasing every site converges on. Shield 55, not the fixture's usual 0
       or 10 — tuned so exactly one person is displaced, the case the old
       phrasing actually got wrong. */
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 55 };
    const row = strikeCountryFn(c, raid, 3);
    assert.strictEqual(row.displaced, 1, 'fixture does not displace exactly one person — retune the shield');
    assert.strictEqual(c.log[0].note, `${raid.title} — 1 person lost their home`,
      'a single displaced person was not phrased in the singular');
  });

  await check('the struck record carries the copy, so the phone never needs the table', () => {
    const c = struckFixture();
    const raid = STRIKES.find(s => s.key === 'raid');
    c.meters = { ...c.meters, [raid.shield]: 10 };
    strikeCountryFn(c, raid, 4);
    assert.strictEqual(c.struck.kind, 'raid');
    assert.strictEqual(c.struck.title, raid.title);
    assert.strictEqual(c.struck.line, raid.line);
    assert.strictEqual(c.struck.round, 4);
    assert.ok(c.struck.displaced > 0);
    assert.ok(c.log.length > 0, 'nothing was written to the country\'s own story');
  });

  /* ---------------- Task 4: the host act ---------------- */
  /* A real hall, because a hall country only exists at the end of the real
     join -> save -> commit -> join-hall path. Fixture shape copied from
     programmes.test.js; two countries, because a strike has to be shown to
     hit the named one and leave the other alone. */
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

  await check('a strike is refused before the mass game starts', async () => {
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[A.pid] });
    assert.ok(r.error, 'a country was struck during prep, when its meters are not settled');
  });

  await post('/api/host/act', { ...R, act:'phase', phase:'game' });

  await check('an unknown kind is refused rather than falling back to something else', async () => {
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'nonsense', pids:[A.pid] });
    /* The exact text, not just truthiness — assert.ok(r.error) passes just as
       well for a 500 thrown out of strikeCountry(t, undefined, …) as it does
       for the intended clean refusal, and those are very different failure
       modes to leave indistinguishable. */
    assert.strictEqual(r.error, 'No such kind of strike.',
      'a typo came back looking like it worked, or crashed instead of refusing cleanly');
  });

  await check('a classroom has no game master to strike with', async () => {
    /* pids is non-empty and names a real country on purpose. With pids:[]
       (as this check used to post) `want` is [] and the request dies on
       "Nobody was named…" regardless of room.kind — the classroom guard is
       never actually reached, so deleting it would not turn this red. A
       classroom's phase can also never be 'game' (the 'phase' act refuses
       phase:'game' for a classroom), so even the phase guard on the next
       line would have caught it — this check has to name a real country AND
       assert the classroom-specific error text so it can only pass for the
       reason it claims to. */
    const r = await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey,
                                            act:'strike', kind:'raid', pids:[A.pid] });
    assert.strictEqual(r.error, 'A classroom has no game master to strike with. Strikes belong to the hall.',
      'a classroom room accepted a strike, or was refused for the wrong reason');
  });

  await check('the wrong host key cannot strike', async () => {
    const r = await post('/api/host/act', { room:hall.room, hostKey:'WRONG',
                                            act:'strike', kind:'raid', pids:[A.pid] });
    assert.ok(r.error, 'anyone who knows a room code could strike it');
  });

  await check('a named country is struck and the other is untouched', async () => {
    const beforeB = (await state(B.code)).team;
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[A.pid] });
    assert.ok(!r.error, 'the strike was refused: ' + r.error);
    const afterA = (await state(A.code)).team;
    const afterB = (await state(B.code)).team;
    assert.ok(afterA.displaced > 0, 'the named country lost nobody');
    assert.strictEqual(afterB.displaced, beforeB.displaced, 'an unnamed country was hit');
    assert.ok(afterA.struck, 'the struck record never reached the country');
  });

  await check('the strike record reaches the struck country and NO other', async () => {
    const mineA = (await state(A.code)).team;
    const mineB = (await state(B.code)).team;
    assert.ok(mineA.struck && mineA.struck.title, 'the struck country cannot render its own strike');
    assert.ok(!mineB.struck, 'a country that was not hit was sent the strike copy');
  });

  await check('striking at random hits exactly the number asked for, and no country twice', async () => {
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'flood', random:2 });
    assert.ok(!r.error, 'a random strike was refused: ' + r.error);
    assert.strictEqual(r.struck.length, 2);
    assert.strictEqual(new Set(r.struck.map(x => x.name)).size, 2, 'one country was struck twice');
  });

  await check('asking for more countries than exist strikes everyone and does not error', async () => {
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'haze', random:99 });
    assert.ok(!r.error, 'an oversized random strike errored: ' + r.error);
    assert.strictEqual(r.struck.length, 2, 'there are two countries in this room');
  });

  await check('a strike naming multiple countries leads with the headline on the feed, and room.lastStrike carries every hit', async () => {
    /* FEED_LINE_CAP is 9 (server.js, strikeFeedLines) — this fixture's two
       countries both fit under it, so both get named on their own line and
       nobody folds. That is the point of the cap being 9, not 1: the room
       needs to see BOTH countries named, not a coin flip between one name
       and an anonymous summary. The fold path itself (above the cap) is
       pinned directly against strikeFeedLines below, without needing sixty
       fixture countries to reach it. */
    const r = await post('/api/host/act', { ...R, act:'strike', kind:'raid', pids:[A.pid, B.pid] });
    assert.ok(!r.error, 'a strike naming every country in the room was refused: ' + r.error);
    /* r.struck IS room.lastStrike.hits — the very same array, assigned to
       room.lastStrike before the route returns it — so asserting its shape
       here is asserting what Task 12's projected overlay will read from the
       room itself, not a copy the route happens to also send back. */
    assert.strictEqual(r.struck.length, 2, 'room.lastStrike did not carry every hit in the roll');
    assert.ok(r.struck.some(x => x.name === A.name) && r.struck.some(x => x.name === B.name),
      'room.lastStrike is missing one of the two countries that were struck');

    const raid = STRIKES.find(s => s.key === 'raid');
    const after = await get('/api/room', { room: hall.room });
    /* say() unshifts, so the LAST call in the handler is the FIRST line
       here. The headline has to be feed[0], or a reader looking at the top
       of the wall sees the tail of the roll with no idea what caused it. */
    assert.ok(after.feed[0].text.includes(raid.title.toUpperCase()),
      'the headline is not the newest line on the feed — it is buried under its own detail');
  });

  /* strikeFeedLines pulled out with loadFn, exactly as strikeCountry is
     above and mandateBlock is in mandate.test.js — the same function the
     shipped server runs. It is deliberately self-contained (no closures over
     say/room/STRIKES — see its comment in server.js), so it needs no deps
     and can be driven at any N without a room or fixture countries. */
  const strikeFeedLinesFn = loadFn('strikeFeedLines', {}, path.join(ROOT, 'server.js'));
  const raidKind = STRIKES.find(s => s.key === 'raid');
  const makeHit = (name, held) => ({ name, displaced: held ? 0 : 7, coins: held ? 0 : 5, held });

  await check('below the cap, every country is named individually — nobody is folded', () => {
    const hits = [makeHit('Ainu', false), makeHit('Bakau', true), makeHit('Selat', false)];
    const lines = strikeFeedLinesFn(raidKind, hits);
    assert.strictEqual(lines.length, hits.length + 1,
      'a fold line appeared even though every hit fit under the cap');
    for (const h of hits)
      assert.ok(lines.some(l => l.text.includes(h.name)), h.name + ' was not named on its own line');
  });

  await check('above the cap, the rest fold into one summary naming totals', () => {
    const shown = [];
    for (let i = 0; i < 9; i++) shown.push(makeHit('C' + i, false));
    const folded = [makeHit('Held1', true), makeHit('Lost1', false)];
    const hits = shown.concat(folded);
    const lines = strikeFeedLinesFn(raidKind, hits);
    // 9 named lines + 1 summary line + 1 headline
    assert.strictEqual(lines.length, 11,
      'the line count under a fold does not match 9 named + summary + headline');
    for (const h of shown)
      assert.ok(lines.some(l => l.text.includes(h.name)), h.name + ' should be under the cap but was not named');
    for (const h of folded)
      assert.ok(!lines.some(l => l.text.includes(h.name)),
        h.name + ' is past the cap but was still named individually');
    const summary = lines[9];
    assert.ok(summary.text.includes('and 2 more'), 'the summary does not name how many were folded');
    assert.ok(summary.text.includes('1 held the line'), 'the summary does not name how many of the folded held');
    assert.ok(summary.text.includes('1 took losses'), 'the summary does not name how many of the folded lost');
  });

  await check('the headline is always last in the returned order', () => {
    const lines = strikeFeedLinesFn(raidKind, [makeHit('Ainu', false)]);
    /* say() unshifts, so newest lands on top — the last line returned here
       is the first line said, which is the one that ends up at feed[0]. */
    assert.ok(lines[lines.length - 1].text.includes(raidKind.title.toUpperCase()),
      'the headline was not the last line returned, and would not land on top of the feed');
  });

  await check('a hit that held and a hit that took losses produce distinguishable lines', () => {
    const lines = strikeFeedLinesFn(raidKind, [makeHit('Held1', true), makeHit('Lost1', false)]);
    const heldLine = lines.find(l => l.text.includes('Held1'));
    const lostLine = lines.find(l => l.text.includes('Lost1'));
    assert.ok(heldLine && lostLine, 'both hits should have their own line under the cap');
    assert.notStrictEqual(heldLine.text, lostLine.text, 'a hold and a loss read identically');
    assert.strictEqual(heldLine.icon, '🛡️');
    assert.strictEqual(lostLine.icon, '💔');
    assert.ok(heldLine.text.includes('held the line'), 'a hold did not say it held');
    assert.ok(lostLine.text.includes('lost their homes'), 'a loss did not say what was lost');
  });

  await check('strikeFeedLines phrases a single displaced person in the singular too', () => {
    /* Its own inlined copy of lostHomesPhrase's wording (see server.js —
       strikeFeedLines is deliberately self-contained, so it cannot call the
       shared helper) has to be kept in sync by hand. This is the check that
       would catch the two drifting. */
    const hit = { name:'Solo', displaced:1, coins:3, held:false };
    const lines = strikeFeedLinesFn(raidKind, [hit]);
    const line = lines.find(l => l.text.includes('Solo'));
    assert.strictEqual(line.text, 'Solo — 1 person lost their home, 3 coins gone.',
      'a single displaced person was not phrased in the singular');
  });

  /* ---------------- Task 5: recovery ---------------- */

  await check('two people rehouse themselves each round', async () => {
    /* The floor at 0 is not exercised here — before=3 only reaches 1 in one
       round, never crossing zero. The floor is established by the next
       check, which runs enough rounds to land on it. */
    const before = (await state(A.code)).team.displaced;
    assert.ok(before > 0, 'fixture is not struck — nothing to recover from');
    await post('/api/host/act', { ...R, act:'round' });
    const after = (await state(A.code)).team.displaced;
    assert.strictEqual(after, Math.max(0, before - 2));
  });

  await check('a country recovers all the way to zero and the strike record clears', async () => {
    for (let i = 0; i < 8; i++) await post('/api/host/act', { ...R, act:'round' });
    const t = (await state(A.code)).team;
    assert.strictEqual(t.displaced, 0, 'a country never climbed out');
    assert.ok(!t.struck, 'displaced reached 0 but the country is still flagged as struck');
  });

  await check('recovery happens BEFORE income, so a recovered round pays the recovered rate', async () => {
    /* The ordering matters and is invisible from the outside unless asked
       directly: decaying after roundIncome would charge a country for people
       who had already gone home. A source-reading assertion like this one has
       a blind spot an outcome-based check would not: `indexOf('displaced')`
       reads as -1 if the decay line is deleted from advanceRound entirely,
       and -1 is less than any real index, so a bare ordering assertion would
       pass just as happily for "decay is gone" as for "decay runs first".
       That failure mode is the one this check can least afford — its whole
       job is to defend an invariant nobody can see from outside — so
       presence and order are asserted separately below. */
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const fn = src.slice(src.indexOf('function advanceRound'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const dIdx = body.indexOf('displaced');
    assert.notStrictEqual(dIdx, -1,
      'the decay is gone from advanceRound entirely — a struck country will never recover');
    assert.ok(dIdx < body.indexOf('E.roundIncome'),
      'displaced is decayed after income is computed — a recovered country is charged for people already home');
  });

  /* ---------------- Task 6: the wire ---------------- */

  await check('the board says who needs help, by icon and by number', async () => {
    await post('/api/host/act', { ...R, act:'strike', kind:'unrest', pids:[B.pid] });
    const rows = (await state(A.code)).board;
    const rowB = rows.find(r => r.pid === B.pid);
    const rowA = rows.find(r => r.pid === A.pid);
    assert.ok(rowB.displaced > 0, 'a struck country does not appear struck on the board');
    assert.ok(rowB.strk, 'no icon to draw a badge with');
    assert.strictEqual(rowA.displaced, 0, 'an unstruck country reads as struck');
    assert.strictEqual(rowA.strk, '', 'an unstruck country carries a strike icon');
  });

  await check('the board carries NO strike copy — only the icon and the count', async () => {
    const rows = (await state(A.code)).board;
    /* This check's whole job is to prove strike copy does NOT reach a device
       that was not hit — the spec calls that Critical, and this is the only
       test on the wire for it. It depends on the check just above having
       actually struck B, and nothing here re-establishes that: reorder or
       isolate this check (run it alone, or move it above "the board says who
       needs help") and, with nobody struck, every assert.ok(!blob.includes())
       below passes vacuously — a blob with no strike copy in it proves
       nothing was leaked only if there was copy to leak in the first place. */
    assert.ok(rows.some(r => r.displaced > 0),
      'fixture: nobody is struck — this check proves nothing');
    const blob = JSON.stringify(rows);
    for (const s of STRIKES) {
      assert.ok(!blob.includes(s.title), `${s.key}'s title is on every device's leaderboard`);
      assert.ok(!blob.includes(s.line), `${s.key}'s story is on every device's leaderboard`);
    }
  });

  await check('/api/room carries the roll for the projector', async () => {
    const d = await get('/api/room', { room: hall.room });
    assert.ok(d.lastStrike, 'the console has nothing to draw the announcement from');
    assert.ok(Array.isArray(d.lastStrike.hits), 'the roll is missing');
    assert.ok(d.lastStrike.hits.every(h => h.name), 'the roll has no names in it');
    assert.ok(!JSON.stringify(d.lastStrike.hits).includes(B.code), 'a country code is on the roll');
  });

  console.log('');
  console.log(ran - fails + '/' + ran + ' passed');
  done(fails ? 1 : 0);
})();
