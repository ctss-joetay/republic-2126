/* Spec C. The engine half: the vocabulary both sides share, and the default
   that decides whether a hall works. The server half: the gate itself
   (mandateBlock, not yet wired into any route — that is Task 3) and the one
   route a Leader uses to move the flags.

   MANDATE_WHAT lives in the engine on purpose. The refusal sentence is built
   on the server (route errors) and on the client (tab banners), and Spec B
   shipped exactly this drift once already — the client's ACT_ROLES mirror
   fell out of step with the server's and no test could see it. One copy in
   the block that engine-sync.test.js compares byte-for-byte cannot drift.

   The server half needs a real running server, for the same reason
   hall-build.test.js does: a hall country only exists at the end of the real
   join -> save -> commit -> join-hall path, and the fixture below is that
   file's, copied verbatim rather than re-derived. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, loadFn } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const SRV_FILE = path.join(ROOT, 'server.js');
/* mandateBlock is not called from any route yet (Task 3 wires it in), so no
   integration test below exercises its own logic — only the backfill and the
   route's boolean filter. Pulled out with loadFn exactly as
   minister-client.test.js pulls roleCan out of public/index.html: the same
   function the shipped server runs, not a retyped copy that could pass while
   the real one regressed. leaderName has no dependencies of its own; it is
   extracted first so the real (not stubbed) one can be handed to
   mandateBlock, which calls it internally. */
const leaderNameFn = loadFn('leaderName', {}, SRV_FILE);
const mandateBlockFn = loadFn('mandateBlock', { leaderName: leaderNameFn, E }, SRV_FILE);
const PORT = 3363;
const BASE = `http://127.0.0.1:${PORT}`;
/* >= 8 chars: HALL_ON (server.js) gates the whole HALL_KEY branch off below
   that length, and a gated-off HALL_KEY makes /api/host/create refuse to open
   a hall at all, regardless of what key is sent. */
const HALL_PASS = 'letmein1';
/* >= 16 chars: ADMIN_ON gates the same way. Needed only to trust the fixture's
   classroom room — see the comment at the join/commit/join-hall block below. */
const ADMIN_PASS = 'a-very-long-admin-key-for-hall-build-tests';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-mandate-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
/* Plain fetch, gzip and all — the encoding a real iPad negotiates. This file
   used to force Accept-Encoding: identity, because server.js's response cache
   was keyed on the __etag tag alone and every refusal here returns before
   bump(room) advances it: two /api/state calls straddling a refusal shared a
   tag, so the second got the first's bytes and every before/after diff below
   was blind. That cache is now content-aware (gzip(), server.js ~1278, pinned
   by tests/gzip-cache.test.js), so the opt-out is gone. It was never the fix
   — a suite that declines the mechanism it exists to police proves nothing,
   and every future before/after check would have had to remember the same
   trick, failing silently the first time someone forgot. */
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

  await check('a new country may do all four things', () => {
    const m = E.blankCountry().mandate;
    assert.deepStrictEqual(m, { build:true, site:true, programme:true, ally:true },
      'the open default is what makes a Leader who never opens the Cabinet screen harmless');
  });

  await check('every flag has a phrase for the refusal sentence', () => {
    assert.deepStrictEqual(E.MANDATE_FLAGS, ['build','site','programme','ally']);
    for (const f of E.MANDATE_FLAGS) {
      assert.strictEqual(typeof E.MANDATE_WHAT[f], 'string', `${f} has no phrase`);
      assert.ok(E.MANDATE_WHAT[f].length > 0, `${f}'s phrase is empty`);
    }
    assert.deepStrictEqual(Object.keys(E.MANDATE_WHAT).sort(), E.MANDATE_FLAGS.slice().sort(),
      'MANDATE_WHAT and MANDATE_FLAGS name different sets of flags');
  });

  await check('the phrases read as the end of "X has closed ___"', () => {
    /* Not decoration: these are pasted straight into a sentence a 14-year-old
       reads in a loud hall. A capitalised or trailing-punctuated phrase would
       read as a fragment. */
    for (const f of E.MANDATE_FLAGS) {
      const p = E.MANDATE_WHAT[f];
      assert.strictEqual(p, p.toLowerCase(), `${f}'s phrase is capitalised`);
      assert.ok(!/[.!]$/.test(p), `${f}'s phrase ends in punctuation`);
    }
  });

  /* -------- mandateBlock itself, against the real shipped function --------
     Pinned here, not through a route, because nothing wires this function
     into a route until Task 3 — an integration test through HTTP cannot
     reach it yet. Five branches: the two fail-open shapes, the two refusal
     wordings (named leader vs. the "Your Leader … them" fallback), and the
     Leader's own exemption. */

  await check('mandateBlock: a legacy team with no mandate at all proceeds (fail open)', () => {
    const legacy = E.blankCountry();
    delete legacy.mandate;
    assert.strictEqual(mandateBlockFn(legacy, 'edu', 'build'), null,
      'a country restored with no mandate key at all was refused instead of let through');
  });

  await check('mandateBlock: a half-written mandate ({}) proceeds (fail open)', () => {
    const team = E.blankCountry();
    team.mandate = {};
    assert.strictEqual(mandateBlockFn(team, 'edu', 'build'), null,
      'a mandate object missing the flag entirely was refused instead of let through');
  });

  await check('mandateBlock: closed, with a leader name, names the Leader in the refusal', () => {
    const team = E.blankCountry();
    team.mandate = { build:false, site:true, programme:true, ally:true };
    team.members = { leader:'Kai' };
    assert.strictEqual(mandateBlockFn(team, 'edu', 'build'),
      'Kai has closed building. Go and ask Kai.');
  });

  await check('mandateBlock: closed, with no leader name, falls back to "Your Leader" / "them"', () => {
    const team = E.blankCountry();
    team.mandate = { build:false, site:true, programme:true, ally:true };
    team.members = {};
    assert.strictEqual(mandateBlockFn(team, 'edu', 'build'),
      'Your Leader has closed building. Go and ask them.');
  });

  await check('mandateBlock: the Leader is never bound by their own mandate', () => {
    const team = E.blankCountry();
    team.mandate = { build:false, site:false, programme:false, ally:false };
    for (const f of E.MANDATE_FLAGS)
      assert.strictEqual(mandateBlockFn(team, 'leader', f), null,
        `the Leader was blocked from ${f} by a mandate they themself set`);
  });

  /* -------- server half: a real spawned server, the hall-build.test.js
     fixture verbatim -------- */

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

  const j = await post('/api/join', { room: cls.room, name: 'Forest Co', homeland: 'forest' });
  assert.ok(!j.error, 'fixture could not join: ' + j.error);
  await post('/api/team/save', { code: j.code, country: {
    members: { leader: 'Kai' }, split: { edu:6, def:6, trade:6, infra:6 } } });
  const cm = await post('/api/team/commit', { code: j.code });
  assert.ok(!cm.error, 'fixture could not commit: ' + cm.error);
  const jh = await post('/api/team/join-hall', { code: j.code, room: room.room });
  assert.ok(!jh.error, 'fixture could not join the hall: ' + jh.error);
  const co = { code: j.code, minCodes: j.team.minCodes, viewCode: j.team.viewCode, pid: j.team.pid };

  /* A second country in the same hall room, migrated the same way as the
     first — the alliance and trade checks below need somebody on the other
     side of the offer. Green Isles, not Forest Belt again: distinct enough
     that a wrong pid would show up as an affordability error rather than
     silently trading with itself. */
  const j2 = await post('/api/join', { room: cls.room, name: 'Isles Co', homeland: 'isles' });
  assert.ok(!j2.error, 'fixture could not join the second country: ' + j2.error);
  await post('/api/team/save', { code: j2.code, country: {
    members: { leader: 'Robin' }, split: { edu:6, def:6, trade:6, infra:6 } } });
  const cm2 = await post('/api/team/commit', { code: j2.code });
  assert.ok(!cm2.error, 'fixture could not commit the second country: ' + cm2.error);
  const jh2 = await post('/api/team/join-hall', { code: j2.code, room: room.room });
  assert.ok(!jh2.error, 'fixture could not join the hall (second country): ' + jh2.error);
  const other = { code: j2.code, minCodes: j2.team.minCodes, pid: j2.team.pid };

  await post('/api/host/act', { ...R, act: 'phase', phase: 'game' });

  const state = async (code) => get('/api/state', { code });
  const setMandate = (code, mandate) => post('/api/team/mandate', { code, mandate });

  await check('a country starts with every door open', async () => {
    const st = await state(co.code);
    assert.deepStrictEqual(st.team.mandate,
      { build:true, site:true, programme:true, ally:true });
  });

  await check('the Leader can close one door and leave the others', async () => {
    const r = await setMandate(co.code, { programme:false });
    assert.ok(!r.error, 'the Leader was refused: ' + r.error);
    /* Pins publicTeam(t).mandate directly: GET /api/state returns the raw
       team for the requester's own device, not publicTeam(team), so nothing
       else in this file ever reads mandate off a publicTeam() response —
       this route's own success body is the one place that does. */
    assert.deepStrictEqual(r.team.mandate, { build:true, site:true, programme:false, ally:true },
      "the route's own response (publicTeam) did not reflect the change");
    const m = (await state(co.code)).team.mandate;
    assert.strictEqual(m.programme, false);
    assert.strictEqual(m.build, true, 'closing one door closed another');
    assert.strictEqual(m.site, true);
    assert.strictEqual(m.ally, true);
  });

  await check('a partial body leaves untouched flags exactly as they were', async () => {
    await setMandate(co.code, { build:false });
    const m = (await state(co.code)).team.mandate;
    assert.strictEqual(m.build, false);
    assert.strictEqual(m.programme, false, 'an earlier closure was reopened by a body that never mentioned it');
    await setMandate(co.code, { build:true, programme:true });
  });

  await check('a non-boolean never moves a flag', async () => {
    /* A stale or hand-made body must not be able to close a door the Leader
       did not close. */
    for (const bad of ['false', 0, null, {}, []]) {
      await setMandate(co.code, { build: bad });
      assert.strictEqual((await state(co.code)).team.mandate.build, true,
        `${JSON.stringify(bad)} closed a door`);
    }
  });

  for (const who of ['edu','def','trade','infra']) {
    await check(`the ${who} minister cannot set the mandate`, async () => {
      const r = await setMandate(co.minCodes[who], { build:false });
      assert.ok(r.error, `${who} set the cabinet's mandate`);
      assert.ok(/Leader/.test(r.error), `the refusal does not say who can: "${r.error}"`);
      assert.strictEqual((await state(co.code)).team.mandate.build, true);
    });
  }

  await check('the class code cannot set the mandate', async () => {
    const r = await setMandate(co.viewCode, { build:false });
    assert.ok(r.error, 'a watching member set the mandate');
  });

  /* The real "restored without a mandate" pin lives in migration.test.js
     ("a country imported before mandate existed restores fully open"),
     which drives an actual legacy team through /api/host/import ->
     migrateTeam -> /api/state. A version of this check used to live here
     too, but it reimplemented the backfill inline and asserted on its own
     output — it never touched server.js at all, so it could not fail no
     matter what migrateTeam did. Two checks claiming the same property, one
     of them theatre, is worse than the one real one. */

  /* -------- Task 3: the gate wired into the four routes -------- */

  /* A programme costs 26-42 and a fresh country starts on 20 coins with no
     industries — roundIncome only ever pays out what industries actually
     produce (see programmes.test.js). Rather than tie this file to that
     arithmetic, or to advancing the room's round (which would drift every
     team's meters along the way), `other` just hands `co` its own spare
     coins through a plain, already-proven-ungated trade, so the "Leader is
     never bound" check below can afford to actually run a programme. */
  const fund = await post('/api/trade/offer', { code: other.code, to: co.pid,
    give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:20, ally:false });
  assert.ok(!fund.error, 'fixture could not propose a top-up trade: ' + fund.error);
  const funded = await post('/api/trade/respond', { code: co.code, id: fund.offer?.id || fund.id, accept:true });
  assert.ok(!funded.error, 'fixture could not accept the top-up trade: ' + funded.error);

  const closeAll = () => setMandate(co.code,
    { build:false, site:false, programme:false, ally:false });
  const openAll = () => setMandate(co.code,
    { build:true, site:true, programme:true, ally:true });

  await check('a closed door refuses the minister who owns it, by name', async () => {
    await setMandate(co.code, { build:false });
    const r = await post('/api/team/save', { code: co.minCodes.infra, country: { buildings: { home: 9 } } });
    assert.ok(r.error, 'a closed ministry still built');
    assert.ok(/Kai/.test(r.error), `the refusal does not name the Leader: "${r.error}"`);
    assert.ok(/closed building/.test(r.error), `the refusal does not say what is closed: "${r.error}"`);
    await openAll();
  });

  await check('closing one door does not close another', async () => {
    await setMandate(co.code, { build:false });
    const r = await post('/api/team/save', { code: co.minCodes.trade, country: { industries: { farm: 1 } } });
    assert.ok(!r.error, 'closing building also closed industry: ' + r.error);
    await openAll();
  });

  await check('each flag guards its own route', async () => {
    await setMandate(co.code, { site:false });
    const site = await post('/api/team/save', { code: co.minCodes.trade, country: { industries: { farm: 5 } } });
    assert.ok(site.error && /closed new industry/.test(site.error), 'site did not guard industries');
    await setMandate(co.code, { site:true, programme:false });
    const prog = await post('/api/edu/programme', { code: co.minCodes.edu, key: 'heritage' });
    assert.ok(prog.error && /closed spending on programmes/.test(prog.error), 'programme did not guard the route');
    await openAll();
  });

  await check('a closed ally door refuses an alliance but not a trade', async () => {
    await setMandate(co.code, { ally:false });
    const ally = await post('/api/trade/offer', { code: co.minCodes.def, to: other.pid,
      give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:true });
    assert.ok(ally.error && /closed alliances/.test(ally.error), 'a closed ally door still allied');
    const goods = await post('/api/trade/offer', { code: co.minCodes.trade, to: other.pid,
      give:{W:0,M:1,F:0}, want:{W:0,M:0,F:1}, coins:0, ally:false });
    assert.ok(!goods.error, 'closing alliances also closed trade: ' + goods.error);
    await openAll();
  });

  await check('a closed ally door also refuses ACCEPTING one', async () => {
    /* Both ends, or the door is shut on one side only. `other` proposes while
       our own Leader has alliances closed; our Defence Minister must not be
       able to join. */
    await openAll();
    const sent = await post('/api/trade/offer', { code: other.code, to: co.pid,
      give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:true });
    assert.ok(!sent.error, 'fixture could not send an alliance: ' + sent.error);
    await setMandate(co.code, { ally:false });
    const yes = await post('/api/trade/respond', { code: co.minCodes.def, id: sent.offer?.id || sent.id, accept:true });
    assert.ok(yes.error && /closed alliances/.test(yes.error),
      'a country joined an alliance its Leader had closed');
    const no = await post('/api/trade/respond', { code: co.minCodes.def, id: sent.offer?.id || sent.id, accept:false });
    assert.ok(!no.error, 'declining an alliance was gated — refusing needs no permission');
    await openAll();
  });

  await check('with every door shut, goods and coins still move', async () => {
    /* Deliberate: a trade needs the OTHER country's consent, and it is the act
       that gets students out of their chairs. Closing it would close the hall. */
    await closeAll();
    const r = await post('/api/trade/offer', { code: co.minCodes.trade, to: other.pid,
      give:{W:0,M:1,F:0}, want:{W:0,M:0,F:1}, coins:5, ally:false });
    assert.ok(!r.error, 'a shut cabinet stopped a trade offer: ' + r.error);
    await openAll();
  });

  await check('with every door shut, the Trade Minister can still ACCEPT a plain trade', async () => {
    /* The offer-side proof above only shows PROPOSING survives a shut cabinet.
       Nothing else in this file ever answers a plain (non-ally) offer while
       every flag is closed — and the respond-side gate is exactly the code
       that would strand a Trade Minister mid-hall if it ever drifted from
       "ally-only, and only on accept" to "anything, on any response." `other`
       proposes (its own mandate is untouched and irrelevant here — proposing
       is never gated); our Trade Minister answers with every one of OUR
       doors shut. */
    await closeAll();
    const sent = await post('/api/trade/offer', { code: other.code, to: co.pid,
      give:{W:0,M:1,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:false });
    assert.ok(!sent.error, 'fixture could not send a goods offer: ' + sent.error);
    const r = await post('/api/trade/respond', { code: co.minCodes.trade, id: sent.offer?.id || sent.id, accept:true });
    assert.ok(!r.error, 'a shut cabinet stopped the Trade Minister accepting a trade: ' + r.error);
    await openAll();
  });

  await check('the Leader is never bound by their own mandate', async () => {
    await closeAll();
    const build = await post('/api/team/save', { code: co.code, country: { buildings: { home: 3 } } });
    assert.ok(!build.error, 'the Leader was refused their own build: ' + build.error);
    const prog = await post('/api/edu/programme', { code: co.code, key: 'heritage' });
    assert.ok(!prog.error, 'the Leader was refused their own programme: ' + prog.error);
    await openAll();
  });

  await check('closing a door never undoes what was already done', async () => {
    const before = await state(co.code);
    await setMandate(co.code, { build:false });
    const after = await state(co.code);
    assert.deepStrictEqual(after.team.buildings, before.team.buildings, 'closing a door demolished something');
    assert.deepStrictEqual(after.team.meters, before.team.meters, 'closing a door moved the meters back');
    await openAll();
  });

  await check('a refused save leaves the whole country as it was', async () => {
    /* motto is leader-owned (FIELD_OWNER in server.js), so it never lands
       under the Infrastructure Minister's code at all — the original version
       of this check posted it as its "field written earlier in the same
       call" and so was vacuous three ways over: motto could never survive
       whether the save succeeded, was refused for its wording, or was
       refused for *any* reason at all, and deleting revert() from either
       save branch left the whole suite green. picks IS infra's own field
       (FIELD_OWNER.buildings === 'infra'; picks is per-ministry via
       mayPick), and it is written well before the buildings branch that
       trips the mandate refusal — so revert() has something real of THIS
       ministry's to undo. */
    await setMandate(co.code, { build:false });
    const before = await state(co.code);
    const r = await post('/api/team/save', { code: co.minCodes.infra,
      country: { picks: { infra: ['faith'] }, buildings: { home: 9 } } });
    assert.ok(r.error && /closed building/.test(r.error),
      `the refusal does not say what is closed: "${r.error}"`);
    const after = await state(co.code);
    assert.deepStrictEqual((after.team.picks || {}).infra, (before.team.picks || {}).infra,
      `a field written earlier in the same call survived the mandate refusal: ${JSON.stringify((after.team.picks || {}).infra)}`);
    await openAll();
  });

  await check('a refused industries save also leaves the whole country as it was', async () => {
    /* The save handler reverts industries and buildings on two SEPARATE
       branches, each with its own revert() call — the check above only
       exercises the buildings one. Proven directly: deleting revert() from
       the industries/site branch alone left the whole 28-check file green
       until this check existed. Same shape, mirrored onto trade: picks
       lands first (trade owns both industries and its own picks), then the
       site-closed industries branch refuses and must undo it too. */
    await setMandate(co.code, { site:false });
    const before = await state(co.code);
    const r = await post('/api/team/save', { code: co.minCodes.trade,
      country: { picks: { trade: ['strip'] }, industries: { farm: 5 } } });
    assert.ok(r.error && /closed new industry/.test(r.error),
      `the refusal does not say what is closed: "${r.error}"`);
    const after = await state(co.code);
    assert.deepStrictEqual((after.team.picks || {}).trade, (before.team.picks || {}).trade,
      `a field written earlier in the same call survived the mandate refusal: ${JSON.stringify((after.team.picks || {}).trade)}`);
    await openAll();
  });

  await check('a country with no name for its Leader still refuses readably', async () => {
    await post('/api/team/save', { code: co.code, country: { members: { leader: '' } } });
    await setMandate(co.code, { build:false });
    const r = await post('/api/team/save', { code: co.minCodes.infra, country: { buildings: { home: 9 } } });
    assert.ok(/Your Leader has closed building\. Go and ask them\./.test(r.error),
      `the nameless fallback reads wrong: "${r.error}"`);
    await post('/api/team/save', { code: co.code, country: { members: { leader: 'Kai' } } });
    await openAll();
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})().catch(e => { console.error('FAIL ', e); done(1); });
