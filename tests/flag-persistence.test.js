/* server.js copies only a whitelist of country fields on save. A new field
   that is not on that list is dropped silently — the flag would look right
   all lesson and reset when the group resumed the following week. */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadFn, makeDone, openClassRoom } = require('./helpers');
const ENGINE = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3311;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
});

const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }

  // Test 1: Verify client-side save() sends stripe and empos
  let capturedPayload;
  const mockApi = (method, path, body) => {
    capturedPayload = body;
    return Promise.resolve({});
  };
  const mockS = { solo: false, code: 'ABCDE', role: 'leader' };
  const mockC = ENGINE.blankCountry();
  mockC.stripe = 'vert';
  mockC.empos = 'tright';

  /* save() is now a thin post wrapped around saveBody() (Task 9) — it calls
     roleCan('save') instead of RO(), and calls saveBody() as a free variable,
     so both have to be handed over or the call dies with a ReferenceError
     that looks nothing like a dropped-field bug. Built the same way
     tests/minister-client.test.js builds them: real extracted functions, a
     leader role so every field (including stripe/empos) is posted
     unconditionally. */
  const roleCan = loadFn('roleCan', {
    S: mockS, ACT_ROLES: { save: ['leader', 'edu', 'def', 'trade', 'infra'] }
  });
  const myMinistry = loadFn('myMinistry', { S: mockS, MINISTRIES: ['edu', 'def', 'trade', 'infra'] });
  const saveBody = loadFn('saveBody', { S: mockS, C: mockC, myMinistry, EDITING_PICKS: null });
  const save = loadFn('save', { api: mockApi, S: mockS, roleCan, saveBody });
  await save();

  try {
    assert.strictEqual(capturedPayload.country.stripe, 'vert', 'client save() did not send stripe field');
    assert.strictEqual(capturedPayload.country.empos, 'tright', 'client save() did not send empos field');
    console.log('PASS  client save() sends stripe and empos fields');
  } catch (e) {
    console.error('FAIL ', e.message);
    done(1);
  }

  const room = await openClassRoom(post);
  const join = await post('/api/join', { room: room.room, name: 'Flagland', homeland: 'delta' });
  const code = join.code;

  await post('/api/team/save', { code, country: {
    name: 'Flagland', motto: 'Onward', col1: '#123456', col2: '#abcdef',
    emblem: '🐉', homeland: 'delta', stripe: 'vert', empos: 'tright'
  }});

  const state = await get('/api/state?code=' + code);
  try {
    assert.strictEqual(state.team.stripe, 'vert',   'stripe was dropped by the server whitelist');
    assert.strictEqual(state.team.empos,  'tright', 'empos was dropped by the server whitelist');
    console.log('PASS  flag persistence — stripe and empos survive save/load');
  } catch (e) {
    console.error('FAIL ', e.message);
    done(1);
  }

  // Test 3: a poisoned empos/stripe (e.g. naming an Object.prototype member)
  // must be refused, not persisted — this is the server half of the fix for
  // the FLAG_POS[c.empos] crash; flagSVG's own defence is in
  // tests/flag-geometry.test.js
  await post('/api/team/save', { code, country: {
    name: 'Flagland', motto: 'Onward', col1: '#123456', col2: '#abcdef',
    emblem: '🐉', homeland: 'delta', stripe: 'constructor', empos: '__proto__'
  }});
  const stateAfterPoison = await get('/api/state?code=' + code);
  try {
    assert.strictEqual(stateAfterPoison.team.stripe, 'vert',
      'server persisted an invalid stripe enum value ("constructor")');
    assert.strictEqual(stateAfterPoison.team.empos, 'tright',
      'server persisted an invalid empos enum value ("__proto__")');
    console.log('PASS  flag persistence — invalid stripe/empos enum values are refused, not persisted');
    done(0);
  } catch (e) {
    console.error('FAIL ', e.message);
    done(1);
  }
})().catch(e => { console.error('FAIL ', e); done(1); });
