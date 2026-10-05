/* server.js whitelists which country fields a client may write. A field that
   is missing from that list is dropped silently — the failure would only show
   up when a group resumed a lesson later and found their city gone. */
const assert = require('assert');
const { spawn } = require('child_process');
const { loadFn, makeDone, openClassRoom } = require('./helpers');
const E = require('../game_engine.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3313;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-bld-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
});
const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }

  let fails = 0, ran = 0;

  /* The server accepting a field is only half of it — the client has to send
     it. save() posts a hand-written field list, so a new field that nobody
     adds there is dropped before it ever reaches the whitelist. */
  let capturedPayload;
  const mockC = E.blankCountry();
  mockC.buildings = { home: 2 };
  /* save() is now a thin post wrapped around saveBody() (Task 9) — it calls
     roleCan('save') instead of RO(), and calls saveBody() as a free variable,
     so both have to be handed over or the call dies with a ReferenceError
     that looks nothing like a dropped-field bug. Built the same way
     tests/minister-client.test.js builds them: real extracted functions, a
     leader role so every field (including buildings) is posted unconditionally. */
  const mockS = { solo: false, code: 'ABCDE', role: 'leader' };
  const roleCan = loadFn('roleCan', {
    S: mockS, ACT_ROLES: { save: ['leader', 'edu', 'def', 'trade', 'infra'] }
  });
  const myMinistry = loadFn('myMinistry', { S: mockS, MINISTRIES: ['edu', 'def', 'trade', 'infra'] });
  const saveBody = loadFn('saveBody', { S: mockS, C: mockC, myMinistry, EDITING_PICKS: null });
  const clientSave = loadFn('save', {
    api: (method, path, body) => { capturedPayload = body; return Promise.resolve({}); },
    S: mockS, roleCan, saveBody
  });
  await clientSave();
  ran++;
  try {
    assert.deepStrictEqual(capturedPayload.country.buildings, { home: 2 },
      'client save() did not send the buildings field');
    console.log('PASS  client save() sends the buildings field');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  const room = await openClassRoom(post);
  const join = await post('/api/join', { room: room.room, name: 'Buildland', homeland: 'high' });
  const code = join.code;

  await post('/api/team/save', { code, country: { buildings: { home: 2 } } });
  let s = await get('/api/state?code=' + code);
  ran++;
  try {
    assert.deepStrictEqual(s.team.buildings, { home: 2 }, 'buildings were dropped by the server whitelist');
    console.log('PASS  buildings survive save/load');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  // a plan the country cannot afford must be refused, leaving the old one intact
  const tooMany = await post('/api/team/save', { code, country: { buildings: { home: 99 } } });
  s = await get('/api/state?code=' + code);
  ran++;
  try {
    assert.ok(tooMany.error, 'an unaffordable building plan was accepted');
    assert.deepStrictEqual(s.team.buildings, { home: 2 }, 'a refused plan still changed the stored country');
    console.log('PASS  an unaffordable building plan is refused and the old one kept');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  // an unknown key must not be stored
  await post('/api/team/save', { code, country: { buildings: { home: 1, notAThing: 3 } } });
  s = await get('/api/state?code=' + code);
  ran++;
  try {
    assert.ok(!('notAThing' in (s.team.buildings || {})), 'an unknown building key was stored');
    console.log('PASS  unknown building keys are refused');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  /* Trading during nation-building is what saves a homeland that cannot house
     its people from its own materials. It rests on two things that are easy to
     "tidy up" into breakage: the trade endpoints not being gated on the room
     phase, and the client merging stock back during prep. The second is pinned
     in the client source because applyServer deliberately does NOT copy the
     server's country over C during prep — stock is the one exception, and a
     regression there would look exactly like a trade silently doing nothing. */
  const room2 = await openClassRoom(post);
  const a = await post('/api/join', { room: room2.room, name: 'Deltaland', homeland: 'delta' });
  const b = await post('/api/join', { room: room2.room, name: 'Highland', homeland: 'high' });
  const st = await get('/api/state?code=' + a.code);
  ran++;
  try {
    assert.strictEqual(st.phase, 'prep', 'a fresh room should still be in nation-building');
    const offer = await post('/api/trade/offer', {
      code: a.code, to: b.team.pid, give: { W: 0, M: 0, F: 2 }, want: { W: 0, M: 2, F: 0 }, coins: 0
    });
    assert.ok(!offer.error, `an offer during prep was refused: ${offer.error}`);
    const done2 = await post('/api/trade/respond', { code: b.code, id: offer.offer.id, accept: true });
    assert.ok(!done2.error, `accepting during prep was refused: ${done2.error}`);
    const after = await get('/api/state?code=' + a.code);
    assert.strictEqual(after.team.stock.M, 2, 'traded materials did not reach the country');
    assert.strictEqual(after.free.M, 5, 'traded materials did not reach the spendable pool');
    console.log('PASS  countries can trade during nation-building, before the mass game');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  ran++;
  try {
    const app = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const fn = /function applyServer\([\s\S]*?\n\}/.exec(app);
    assert.ok(fn, 'could not find applyServer() in public/index.html');
    assert.ok(/stock/.test(fn[0]),
      'applyServer no longer merges stock during prep — a trade would be accepted and never arrive');
    console.log('PASS  the client still merges traded stock during nation-building');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  if (!ran) console.error('FAIL  buildings-persistence.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  buildings persistence — save, load, refusal and prep-time trade all hold');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
