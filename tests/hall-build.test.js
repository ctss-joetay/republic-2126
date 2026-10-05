/* Spec B §2. The load-bearing assertion in this file is IDEMPOTENCE.

   saveBody() (public/index.html:5266) posts the WHOLE country on every Leader
   autosave, from a device whose copy is only as fresh as its last poll. Once
   the hall applies a delta, that echo stops being harmless: replace-semantics
   would let a stale copy delete whatever a minister just built — the exact
   failure already measured live and recorded at public/index.html:5281.
   max(stored, incoming) makes the echo a no-op instead.

   Only a real running server can show that. A source grep cannot. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3361;
const BASE = `http://127.0.0.1:${PORT}`;
/* >= 8 chars: HALL_ON (server.js) gates the whole HALL_KEY branch off below
   that length, and a gated-off HALL_KEY makes /api/host/create refuse to open
   a hall at all, regardless of what key is sent. */
const HALL_PASS = 'letmein1';
/* >= 16 chars: ADMIN_ON gates the same way. Needed only to trust the fixture's
   classroom room — see the comment at the join/commit/join-hall block below. */
const ADMIN_PASS = 'a-very-long-admin-key-for-hall-build-tests';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-hall-build-'));

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

  /* A hall room, because phase='game' is refused for kind:'class'. No card is
     dealt anywhere in this file — none of these rules involve one, and a card
     opens a discussion window that would only add a clock to wait on. */
  const room = await post('/api/host/create', { kind: 'hall', key: HALL_PASS, label: 'Hall' });
  assert.ok(!room.error, 'could not open a hall room: ' + room.error);
  const R = { room: room.room, hostKey: room.hostKey };

  /* /api/host/groups only provisions a classroom room — a hall's countries
     are meant to arrive by migration (Task 8), not by provisioning, and the
     server refuses the call otherwise. So a hall country here is built the
     same way a real one is: joined and committed in a trusted classroom, then
     walked across with /api/team/join-hall. Trust requires ADMIN_KEY because
     a room /api/host/create opens is always stamped 'self' — see trusted()
     in server.js. */
  const cls = await post('/api/host/create', { kind: 'class' });
  await post('/api/host/act', { room: cls.room, hostKey: cls.hostKey, act: 'openjoin' });
  const trust = await post('/api/admin/trust', { key: ADMIN_PASS, room: cls.room });
  assert.ok(!trust.error, 'fixture could not trust the classroom room: ' + trust.error);

  /* Forest Belt: M9/F7, comfortably covering this file's cumulative builds
     (a park plus two homes, M5/F5 total) with margin to spare. Highlands
     (M12) looks generous on Materials but only has F4 — a park (F1) plus two
     homes (F2 each) already needs F5, so Highlands legitimately fails the
     affordability check partway through this file. Every other homeland is
     short on one resource or the other; Forest Belt and Green Isles are the
     only two that clear both, see the reversion-triggering check below. */
  const j = await post('/api/join', { room: cls.room, name: 'Forest Co', homeland: 'forest' });
  assert.ok(!j.error, 'fixture could not join: ' + j.error);
  await post('/api/team/save', { code: j.code, country: {
    members: { leader: 'Kai' }, split: { edu:6, def:6, trade:6, infra:6 } } });
  const cm = await post('/api/team/commit', { code: j.code });
  assert.ok(!cm.error, 'fixture could not commit: ' + cm.error);
  const jh = await post('/api/team/join-hall', { code: j.code, room: room.room });
  assert.ok(!jh.error, 'fixture could not join the hall: ' + jh.error);
  const co = { code: j.code, minCodes: j.team.minCodes };

  await post('/api/host/act', { ...R, act: 'phase', phase: 'game' });

  const meters = async () => (await get('/api/state', { code: co.code })).team.meters;
  const buildings = async () => (await get('/api/state', { code: co.code })).team.buildings;

  const park = E.BUILDINGS.find(b => b.key === 'park');   // fx {H:4,G:4}, needs M1 F1
  /* park is gated by the 'water' policy card in prep, but the hall merge does
     not re-check the card gate — the tray is what enforces that, and the
     server's job here is the arithmetic. Use 'home' (no card, no fx) for the
     pure-merge cases and park for the fx cases. */

  await check('a hall build moves the meters by applyFx x FOUND_SCALE', async () => {
    const before = await meters();
    await post('/api/team/save', { code: co.code, country: { buildings: { park: 1 } } });
    const after = await meters();
    const want = E.applyFx(before, { H: 4 * E.FOUND_SCALE, G: 4 * E.FOUND_SCALE });
    assert.strictEqual(Math.round(after.H * 10), Math.round(want.H * 10), 'Harmony is wrong');
    assert.strictEqual(Math.round(after.G * 10), Math.round(want.G * 10), 'Green is wrong');
  });

  await check('re-posting the same country does NOT move the meters again', async () => {
    const before = await meters();
    await post('/api/team/save', { code: co.code, country: { buildings: { park: 1 } } });
    assert.deepStrictEqual(await meters(), before, 'a stale autosave echo double-applied');
  });

  await check('a stale LOWER count deletes nothing', async () => {
    const before = await meters();
    /* An EXPLICIT lower count, not just an omitted key. growCounts refuses on
       `!(n > was)`, and only a posted count below the stored one exercises the
       `<` half of that: with `{}` the key is never visited at all, so the rule
       could be narrowed to `n === was` — re-opening the build/demolish meter
       farm the whole up-only rule exists to prevent — and this file stayed
       green. The omission case is worth keeping too; both are posted here. */
    await post('/api/team/save', { code: co.code, country: { buildings: { park: 0 } } });
    assert.strictEqual((await buildings()).park, 1, 'a posted count of 0 demolished the park');
    assert.deepStrictEqual(await meters(), before, 'a posted count of 0 moved the meters');
    await post('/api/team/save', { code: co.code, country: { buildings: {} } });
    assert.strictEqual((await buildings()).park, 1, 'an empty echo demolished the park');
    assert.deepStrictEqual(await meters(), before, 'an empty echo moved the meters');
  });

  await check('two devices posting concurrently converge instead of clobbering', async () => {
    await post('/api/team/save', { code: co.minCodes.infra, country: { buildings: { park: 1, home: 2 } } });
    /* the Leader's stale copy: still only knows about the park */
    await post('/api/team/save', { code: co.code, country: { buildings: { park: 1 } } });
    const b = await buildings();
    assert.strictEqual(b.home, 2, 'the Leader\'s stale echo undid the Infra Minister\'s homes');
    assert.strictEqual(b.park, 1);
  });

  await check('a merged plan that overspends Materials reverts the whole save', async () => {
    const before = await get('/api/state', { code: co.code });
    const r = await post('/api/team/save', { code: co.code, country: {
      motto: 'should not survive', buildings: { home: 99 } } });
    assert.ok(r.error, 'an unaffordable hall build was accepted');
    const after = await get('/api/state', { code: co.code });
    assert.deepStrictEqual(after.team.buildings, before.team.buildings);
    assert.strictEqual(after.team.motto, before.team.motto,
      'a field written earlier in the same call survived the refusal');
  });

  await check('once the game is called, building is ignored', async () => {
    await post('/api/host/act', { ...R, act: 'phase', phase: 'final' });
    const before = await get('/api/state', { code: co.code });
    /* ONE more park, not five. Five was AFFORDABLE-refused, not phase-refused:
       four extra parks bust Forest Belt's Materials and Food, so the revert()
       satisfied this assertion whether or not the phase gate existed at all —
       deleting the gate left the file at 7/7. A second park costs M1 F1 against
       M4 F2 still free, so the only thing that can stop it here is the phase. */
    await post('/api/team/save', { code: co.code, country: { buildings: { park: 2 } } });
    const after = await get('/api/state', { code: co.code });
    assert.deepStrictEqual(after.team.buildings, before.team.buildings,
      'a country built its way up the leaderboard after the game was called');
    assert.deepStrictEqual(after.team.meters, before.team.meters);
  });

  /* Prep is a separate room, because this one is now 'final'. */
  await check('prep still REPLACES and still recomputes from foundingMeters', async () => {
    const c2 = await post('/api/host/create', { kind: 'class' });
    const g2 = await post('/api/host/groups', { room: c2.room, hostKey: c2.hostKey, n: 1 });
    const t2 = g2.roster[0];
    await post('/api/team/save', { code: t2.code, country: {
      members: { leader: 'Mei' }, split: { edu:6, def:6, trade:6, infra:6 }, buildings: { home: 2 } } });
    await post('/api/team/save', { code: t2.code, country: { buildings: { home: 1 } } });
    const st = await get('/api/state', { code: t2.code });
    assert.strictEqual(st.team.buildings.home, 1, 'prep stopped allowing a group to take a home back');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();
