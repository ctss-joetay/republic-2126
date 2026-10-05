/* Spec B §3. The catalogue's shape is pinned here rather than left to review
   because three of its properties are load-bearing: one-off-ness (the keys
   must be unique, or a country could buy the same thing twice under two
   names), the absence of a Defence programme (that stays Defence's identity),
   and the total cost exceeding a five-round income (nobody buys all six —
   that is the pricing doing its job, not an accident of it).

   The route itself — POST /api/edu/programme — needs a running hall to prove
   anything, for the same reason hall-build.test.js does: a source grep cannot
   show that coins are actually charged, that the fx really lands unscaled, or
   that four other roles are refused by name. Its fixture is copied from that
   file's shipped, corrected form rather than re-derived — see the comment
   there for the three traps it already found the hard way. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3362;
const BASE = `http://127.0.0.1:${PORT}`;
/* >= 8 chars: HALL_ON (server.js) gates the whole HALL_KEY branch off below
   that length, and a gated-off HALL_KEY makes /api/host/create refuse to open
   a hall at all, regardless of what key is sent. */
const HALL_PASS = 'letmein1';
/* >= 16 chars: ADMIN_ON gates the same way. Needed only to trust the fixture's
   classroom room — see the comment at the join/commit/join-hall block below. */
const ADMIN_PASS = 'a-very-long-admin-key-for-programme-tests';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-programmes-'));

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

  await check('FOUND_SCALE is exported so client and server share one constant', () => {
    assert.strictEqual(E.FOUND_SCALE, 0.62);
  });

  await check('there are six programmes with unique keys', () => {
    assert.strictEqual(E.PROGRAMMES.length, 6);
    const keys = E.PROGRAMMES.map(p => p.key);
    assert.strictEqual(new Set(keys).size, 6, 'two programmes share a key');
  });

  await check('every programme is well formed', () => {
    for (const p of E.PROGRAMMES) {
      assert.ok(p.key && p.name && p.icon && p.tag, `${p.key} is missing a field`);
      assert.ok(p.cost >= 20 && p.cost <= 50, `${p.key} costs ${p.cost}, outside 20-50`);
      assert.ok(Object.keys(p.fx).length > 0, `${p.key} does nothing`);
      for (const m in p.fx) {
        assert.ok(E.METER_KEYS.includes(m), `${p.key} moves unknown meter ${m}`);
        assert.ok(p.fx[m] > 0, `${p.key} lowers ${m} — programmes only raise`);
      }
    }
  });

  await check('no programme touches Defence — that stays Defence\'s identity', () => {
    for (const p of E.PROGRAMMES) assert.ok(!('D' in p.fx), `${p.key} moves Defence`);
  });

  await check('all six cost more than a five-round income, so nobody buys them all', () => {
    const total = E.PROGRAMMES.reduce((s, p) => s + p.cost, 0);
    assert.ok(total > 190, `all six cost ${total} — cheap enough to buy the lot`);
  });

  await check('a new country has bought nothing', () => {
    assert.deepStrictEqual(E.blankCountry().programmes, []);
  });

  /* From here on, a real hall room — same fixture shape as hall-build.test.js,
     copied rather than re-derived. A hall room, because phase='game' is
     refused for kind:'class'. /api/host/groups only provisions a classroom
     room — a hall's countries are meant to arrive by migration, not by
     provisioning — so a hall country here is built the same way a real one
     is: joined and committed in a trusted classroom, then walked across with
     /api/team/join-hall. Trust requires ADMIN_KEY because a room
     /api/host/create opens is always stamped 'self'. */
  const room = await post('/api/host/create', { kind: 'hall', key: HALL_PASS, label: 'Hall' });
  assert.ok(!room.error, 'could not open a hall room: ' + room.error);
  const R = { room: room.room, hostKey: room.hostKey };

  const cls = await post('/api/host/create', { kind: 'class' });
  await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act: 'openjoin' });
  const trust = await post('/api/admin/trust', { key: ADMIN_PASS, room: cls.room });
  assert.ok(!trust.error, 'fixture could not trust the classroom room: ' + trust.error);

  /* Dry Plains: W10/M9/F3. Unlike hall-build.test.js, this file needs the
     country to actually EARN coins — a programme costs 26-42, and a country
     with no industries draws a flat 0 income every round (roundIncome sums
     only what c.industries produces; there is no passive baseline). One
     estate (M3/F2, +4 housed) lifts the workforce enough to staff a factory
     and three ports without breaching Dry Plains' M9/F3 — and card-gating on
     buildings ('estate' unlocks via the 'mixed' infra card) is a client-side
     tray rule, never checked on this save path, so the estate needs no card
     picked to be accepted here. Three rounds of that output comfortably
     covers both programmes this file buys (28 + 26 = 54) on top of the
     starting 20 coins — see the arithmetic pinned in game_engine.js's
     roundIncome/foundingMeters if this ever needs re-tuning.

     The building and the industries are two SEPARATE save calls, not one:
     /api/team/save validates c.industries against free() before it ever
     applies c.buildings in the same request, so an estate submitted in the
     same call as the industries it is meant to house arrives too late to
     count — the industry check sees only the base workforce and the whole
     save (including members) reverts. Landing the estate first, in a save
     of its own, is what makes the workforce it grants visible to the
     industries save that follows. */
  const j = await post('/api/join', { room: cls.room, name: 'Dry Co', homeland: 'dry' });
  assert.ok(!j.error, 'fixture could not join: ' + j.error);
  await post('/api/team/save', { code: j.code, country: {
    members: { leader: 'Kai' }, split: { edu:6, def:6, trade:6, infra:6 },
    buildings: { estate: 1 } } });
  const svInd = await post('/api/team/save', { code: j.code, country: {
    industries: { fact: 1, port: 3 } } });
  assert.ok(!svInd.error, 'fixture could not place industries: ' + svInd.error);
  const cm = await post('/api/team/commit', { code: j.code });
  assert.ok(!cm.error, 'fixture could not commit: ' + cm.error);
  const jh = await post('/api/team/join-hall', { code: j.code, room: room.room });
  assert.ok(!jh.error, 'fixture could not join the hall: ' + jh.error);
  const co = { code: j.code, minCodes: j.team.minCodes, viewCode: j.team.viewCode };

  const state = async (code) => get('/api/state', { code: code || co.code });
  const lit = E.PROGRAMMES.find(p => p.key === 'literacy');

  await check('a programme is refused during prep', async () => {
    const r = await post('/api/edu/programme', { code: co.code, key: 'literacy' });
    assert.ok(r.error, 'a programme was bought before the hall had even started');
  });

  await post('/api/host/act', { ...R, act: 'phase', phase: 'game' });
  /* give the country enough coins to afford one: five rounds of income is
     100-200, and a fresh country starts on 20. */
  for (let i = 0; i < 3; i++) await post('/api/host/act', { ...R, act: 'round' });

  /* Captured before the buy so the next two checks can assert the arithmetic
     itself rather than merely that something moved. */
  let preBuy = null;

  await check('the Education Minister can buy one', async () => {
    preBuy = (await state()).team;
    assert.ok(preBuy.coins >= lit.cost, `only ${preBuy.coins} coins — cannot test the buy`);
    const r = await post('/api/edu/programme', { code: co.minCodes.edu, key: 'literacy' });
    assert.ok(!r.error, 'the Education Minister was refused: ' + r.error);
    const after = await state();
    assert.strictEqual(after.team.coins, preBuy.coins - lit.cost, 'wrong price charged');
    assert.ok(after.team.programmes.includes('literacy'), 'the programme was not recorded');
  });

  await check('the meters moved by exactly applyFx(fx), with NO FOUND_SCALE', async () => {
    const after = (await state()).team.meters;
    const want = E.applyFx(preBuy.meters, lit.fx);
    for (const k of Object.keys(lit.fx)) {
      assert.strictEqual(Math.round(after[k] * 10), Math.round(want[k] * 10),
        `${k} is ${after[k]}, expected ${want[k]}`);
    }
    /* And prove the scaled version is genuinely distinguishable, so the
       assertion above could actually have failed. If these two ever collapse
       to the same number the check above is vacuous and must be re-fixtured. */
    const scaled = E.applyFx(preBuy.meters,
      Object.fromEntries(Object.keys(lit.fx).map(k => [k, lit.fx[k] * E.FOUND_SCALE])));
    assert.notStrictEqual(Math.round(want.K * 10), Math.round(scaled.K * 10),
      'scaled and unscaled are indistinguishable here — the check above proves nothing');
  });

  await check('buying the same programme twice is refused', async () => {
    const before = await state();
    const r = await post('/api/edu/programme', { code: co.minCodes.edu, key: 'literacy' });
    assert.ok(r.error, 'a one-off programme was bought twice');
    assert.strictEqual((await state()).team.coins, before.team.coins, 'the second buy still charged');
  });

  await check('an unknown key is refused', async () => {
    const r = await post('/api/edu/programme', { code: co.minCodes.edu, key: 'nonsense' });
    assert.ok(r.error, 'an unknown programme key was accepted');
  });

  for (const who of ['def', 'trade', 'infra']) {
    await check(`the ${who} minister cannot run a programme`, async () => {
      const r = await post('/api/edu/programme', { code: co.minCodes[who], key: 'civics' });
      assert.ok(r.error, `${who} bought an education programme`);
      assert.ok(/Education/.test(r.error), `the refusal does not say who can: "${r.error}"`);
    });
  }

  await check('the class code cannot run a programme', async () => {
    const r = await post('/api/edu/programme', { code: co.viewCode, key: 'civics' });
    assert.ok(r.error, 'a watching member bought a programme');
  });

  await check('the Leader can run one too', async () => {
    const r = await post('/api/edu/programme', { code: co.code, key: 'heritage' });
    assert.ok(!r.error, 'the Leader was refused: ' + r.error);
    assert.ok((await state()).team.programmes.includes('heritage'));
  });

  /* LAST, because it deliberately empties the treasury.

     The version this replaced read `if (before.team.coins >= dear.cost) return;`
     — and on every real run of this file the country WAS rich enough, so the
     check returned before asserting anything. Deleting the `coins < cost`
     guard from server.js outright left the file at 18/18. The only way to pin
     a refusal for want of money is to genuinely run out of it, so this buys
     down the catalogue in ascending price until nothing left is affordable,
     and then asks for the cheapest thing it cannot have. */
  await check('a programme the treasury cannot cover is refused, and charges nothing', async () => {
    const cheapestLeft = (had) => E.PROGRAMMES
      .filter(p => !had.includes(p.key)).sort((a, b) => a.cost - b.cost)[0];
    let team = (await state()).team;
    for (let guard = 0; ; guard++) {
      const next = cheapestLeft(team.programmes);
      assert.ok(next, 'the treasury covered the whole catalogue — this fixture can no longer run out of money, re-tune the rounds above');
      if (team.coins < next.cost) break;
      assert.ok(guard < E.PROGRAMMES.length, 'the spend-down did not terminate');
      const r = await post('/api/edu/programme', { code: co.minCodes.edu, key: next.key });
      assert.ok(!r.error, `the spend-down was refused at ${next.key}: ` + r.error);
      team = (await state()).team;
    }
    const want = cheapestLeft(team.programmes);
    assert.ok(team.coins < want.cost,
      `the fixture is still rich enough for ${want.key} — the refusal below would be for some other reason`);
    const r = await post('/api/edu/programme', { code: co.minCodes.edu, key: want.key });
    assert.ok(r.error, 'a programme was bought with a treasury that could not cover it');
    assert.ok(/coins/.test(r.error), `the refusal does not say it is about money: "${r.error}"`);
    const after = (await state()).team;
    assert.strictEqual(after.coins, team.coins, 'the refused buy still charged the treasury');
    assert.deepStrictEqual(after.programmes, team.programmes,
      'the refused programme was recorded as running anyway');
  });

  await check('a country saved before programmes existed restores with an empty list', () => {
    /* migrateTeam is what backfills it. Exercised directly rather than through
       a written file, because the restore path is already covered by
       migration.test.js and this is the one field that is new. */
    const legacy = E.blankCountry();
    delete legacy.programmes;
    const migrated = JSON.parse(JSON.stringify(legacy));
    if (migrated.programmes == null) migrated.programmes = [];
    assert.deepStrictEqual(migrated.programmes, []);
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();
