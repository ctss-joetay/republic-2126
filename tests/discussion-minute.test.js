/* The window, against a real server. The guards are the point, and calling
   chooseScenario directly would skip the routing that applies them.

   Note the trick used throughout: a card dealt with a SHORT clock gets a
   discussion window clamped into the past, so it is already open. That is how
   the "after the window" cases are tested without a test that sleeps for a
   minute — and it exercises the clamp on a real room at the same time. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HALL_PASS = 'K7m2Qx9p';
const ADMIN_PASS = 'a-very-long-admin-key-for-discussion-tests';
const PORT = 3974;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-discuss-'));
const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, HALL_KEY: HALL_PASS, ADMIN_KEY: ADMIN_PASS },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${PORT}`;
const post = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p, q) => fetch(base + p + '?' + new URLSearchParams(q)).then(r => r.json());
const done = makeDone(server, dir);

let fails = 0, ran = 0;
const check = async (name, fn) => {
  ran++;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* A hall with `n` committed countries in it, by the path students actually
   take: build in a trusted classroom, commit, migrate. */
async function hallWith(n){
  const hall = await post('/api/host/create', { kind:'hall', key:HALL_PASS, label:'Hall' });
  const cls  = await post('/api/host/create', { kind:'class', key:ADMIN_PASS, label:'3E' });
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
  await post('/api/admin/trust', { key:ADMIN_PASS, room:cls.room });
  const codes = [];
  for(let i = 0; i < n; i++){
    const j = await post('/api/join', { room:cls.room, name:'C' + i, homeland:'delta' });
    await post('/api/team/save', { code:j.code, country:{ members:{ leader:'L', edu:'', def:'', trade:'', infra:'' } } });
    await post('/api/team/commit', { code:j.code });
    await post('/api/team/join-hall', { code:j.code, room:hall.room });
    codes.push(j.code);
  }
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'phase', phase:'game' });
  return { H:{ room:hall.room, hostKey:hall.hostKey }, codes };
}

const firstCard = async (H) => (await get('/api/host/scenarios', H)).cards[0].key;

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(base + '/api/room?room=ZZZZ'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
  }

  await check('a decision inside the window is refused', async () => {
    const { H, codes } = await hallWith(2);
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/scenario/choose', { code: codes[0], choice: 'a' });
    assert.ok(r.error, 'a country decided during the discussion window');
    assert.ok(/talk it through/i.test(r.error), 'the refusal does not explain itself: ' + r.error);
  });

  await check('the refused country is genuinely still undecided', async () => {
    /* A refusal that half-applied would be worse than no guard at all. */
    const { H, codes } = await hallWith(2);
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    await post('/api/scenario/choose', { code: codes[0], choice: 'a' });
    const st = await get('/api/state', { code: codes[0] });
    assert.ok(!st.team.chosen, 'the country was recorded as having decided anyway');
  });

  await check('a decision after the window is accepted', async () => {
    /* A 10-second card clock. The floor is 15s, so the clamp lands the stamp
       5 seconds in the PAST and deciding is open the instant the card is
       dealt. Anything above 15s would leave a real window and race. */
    const { H, codes } = await hallWith(2);
    await post('/api/host/act', { ...H, act:'timer', secs: 10 });
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/scenario/choose', { code: codes[0], choice: 'a' });
    assert.ok(!r.error, 'a decision was refused after the window: ' + r.error);
    assert.ok(r.ok);
  });

  await check('no card open means no window in the way', async () => {
    /* Nothing to discuss and nothing to decide — the refusal must come from
       the card being closed, not from a stale stamp. */
    const { H, codes } = await hallWith(2);
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    await post('/api/host/act', { ...H, act:'clear' });
    const r = await post('/api/scenario/choose', { code: codes[0], choice: 'a' });
    assert.ok(/no scenario/i.test(r.error || ''), 'expected the closed-card refusal, got: ' + JSON.stringify(r));
  });

  await check('the classroom drill gets a window too', async () => {
    const cls = await post('/api/host/create', { kind:'class', key:ADMIN_PASS, label:'3F' });
    await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
    const j = await post('/api/join', { room:cls.room, name:'Drillton', homeland:'delta' });
    await post('/api/team/save', { code:j.code, country:{ members:{ leader:'L', edu:'', def:'', trade:'', infra:'' } } });
    await post('/api/team/commit', { code:j.code });
    await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'scenario' });
    const r = await post('/api/scenario/choose', { code:j.code, choice:'a' });
    assert.ok(r.error, 'the drill had no discussion window — it is meant to rehearse the hall');
  });

  /* --- trading and alliances, for the same minute ----------------------- */

  await check('a trade offer inside the window is refused', async () => {
    const { H, codes } = await hallWith(2);
    const you = await get('/api/state', { code: codes[1] });
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/trade/offer', {
      code: codes[0], to: you.team.pid, give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:false });
    assert.ok(r.error, 'an offer was sent during the discussion window');
    assert.ok(/discussing/i.test(r.error), 'the refusal does not explain itself: ' + r.error);
  });

  await check('an alliance offer inside the window is refused too', async () => {
    /* The whole point: ally choices scale with allies, so this is the exact
       scramble the minute exists to postpone. */
    const { H, codes } = await hallWith(2);
    const you = await get('/api/state', { code: codes[1] });
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/trade/offer', {
      code: codes[0], to: you.team.pid, give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:true });
    assert.ok(r.error, 'an alliance was struck during the discussion window');
  });

  await check('answering a pending offer inside the window is refused', async () => {
    /* An offer sent BEFORE the card must not become a way through the minute. */
    const { H, codes } = await hallWith(2);
    const you = await get('/api/state', { code: codes[1] });
    const sent = await post('/api/trade/offer', {
      code: codes[0], to: you.team.pid, give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:true });
    assert.ok(!sent.error, 'fixture problem: the offer was refused before any card: ' + sent.error);
    /* The route answers { ok, offer } — reading sent.id gives undefined, and
       respond then fails with "Offer not found", which would pass this test
       for entirely the wrong reason. */
    assert.ok(sent.offer && sent.offer.id, 'fixture problem: no offer id came back');
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/trade/respond', { code: codes[1], id: sent.offer.id, accept: true });
    assert.ok(r.error, 'a pending alliance was accepted during the discussion window');
  });

  await check('trading opens again once the window has passed', async () => {
    const { H, codes } = await hallWith(2);
    const you = await get('/api/state', { code: codes[1] });
    await post('/api/host/act', { ...H, act:'timer', secs: 10 });
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/trade/offer', {
      code: codes[0], to: you.team.pid, give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:false });
    assert.ok(!r.error, 'trading was still shut after the window: ' + r.error);
  });

  await check('trading with no card open is untouched', async () => {
    const { H, codes } = await hallWith(2);
    const you = await get('/api/state', { code: codes[1] });
    const r = await post('/api/trade/offer', {
      code: codes[0], to: you.team.pid, give:{W:0,M:0,F:0}, want:{W:0,M:0,F:0}, coins:0, ally:false });
    assert.ok(!r.error, 'the window leaked into a room with no card open: ' + r.error);
  });

  /* --- the penalty that must not fire --------------------------------- */

  await check('a round advanced during the window penalises nobody', async () => {
    /* Deal a card and immediately press Next round. Without this, every
       country in the hall is punished for failing to do something the server
       refused to let them do. */
    const { H, codes } = await hallWith(2);
    const before = (await get('/api/state', { code: codes[0] })).team.meters;
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    await post('/api/host/act', { ...H, act:'round' });
    const after = (await get('/api/state', { code: codes[0] })).team.meters;
    assert.strictEqual(after.S, before.S, 'Stability was docked for indecision inside the window');
    assert.strictEqual(after.H, before.H, 'Harmony was docked for indecision inside the window');
  });

  await check('a round advanced after the window still penalises indecision', async () => {
    /* The rule this must not quietly delete: a country that had its chance
       and ducked the card still pays. Short clock so the window is already
       behind us when the round advances. */
    const { H, codes } = await hallWith(2);
    const before = (await get('/api/state', { code: codes[0] })).team.meters;
    await post('/api/host/act', { ...H, act:'timer', secs: 10 });
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    await post('/api/host/act', { ...H, act:'round' });
    const after = (await get('/api/state', { code: codes[0] })).team.meters;
    assert.ok(after.S < before.S || after.H < before.H,
      'a country that ducked an open card was not penalised — the exemption is too wide');
  });

  await check('the window does not stop the round from advancing', async () => {
    const { H } = await hallWith(2);
    await post('/api/host/act', { ...H, act:'scenario', key: await firstCard(H) });
    const r = await post('/api/host/act', { ...H, act:'round' });
    assert.ok(!r.error, 'the round was blocked: ' + r.error);
    const room = await get('/api/room', { room: H.room });
    assert.strictEqual(room.round, 2, 'the round did not advance');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();
