/* The warning a group sees BEFORE it commits — computed from the same bite
   entries as the arithmetic, so the two cannot disagree.

   The secrecy line is the point of most of this file. A phone may learn what a
   choice means for ITS OWN country, in words. It may not learn the effects
   table, and the projector — which the whole hall can read — must learn
   nothing at all. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HALL_PASS = 'K7m2Qx9p';
const ADMIN_PASS = 'a-very-long-admin-key-for-preview-tests';
const PORT = 3977;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-preview-'));
const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT:String(PORT), DATA_DIR:dir, HALL_KEY:HALL_PASS, ADMIN_KEY:ADMIN_PASS },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${PORT}`;
const post = (p, body) => fetch(base + p, {
  method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)
}).then(r => r.json());
const get = (p, q) => fetch(base + p + '?' + new URLSearchParams(q)).then(r => r.json());
const done = makeDone(server, dir);

let fails = 0, ran = 0;
const check = async (name, fn) => {
  ran++;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

async function hallOf(builds){
  const hall = await post('/api/host/create', { kind:'hall', key:HALL_PASS, label:'Hall' });
  const cls  = await post('/api/host/create', { kind:'class', key:ADMIN_PASS, label:'3E' });
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
  await post('/api/admin/trust', { key:ADMIN_PASS, room:cls.room });
  const codes = [];
  for(let i = 0; i < builds.length; i++){
    const j = await post('/api/join', { room:cls.room, name:'C'+i, homeland:'port' });
    await post('/api/team/save', { code:j.code, country:{
      members:{ leader:'L', edu:'', def:'', trade:'', infra:'' }, industries: builds[i] } });
    await post('/api/team/commit', { code:j.code });
    await post('/api/team/join-hall', { code:j.code, room:hall.room });
    codes.push(j.code);
  }
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'phase', phase:'game' });
  return { H:{ room:hall.room, hostKey:hall.hostKey }, codes };
}

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(base + '/api/room?room=ZZZZ'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
  }

  await check('a factory country is warned about shutting its factories', async () => {
    const { H, codes } = await hallOf([{ fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const card = (await get('/api/state', { code:codes[0] })).card;
    const a = card.choices.find(c => c.key === 'a');
    assert.ok(Array.isArray(a.notes), 'the choice carried no notes array');
    assert.ok(a.notes.length >= 1, 'a country with three factories was warned about nothing');
    assert.ok(/\b2\b/.test(a.notes.join(' ')), 'the warning never said how many: ' + JSON.stringify(a.notes));
  });

  await check('a farming country is warned about nothing on that choice', async () => {
    /* Same card, same choice, different country, different screen. */
    const { H, codes } = await hallOf([{ farm:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const card = (await get('/api/state', { code:codes[0] })).card;
    const a = card.choices.find(c => c.key === 'a');
    assert.deepStrictEqual(a.notes, [], 'a farming country was warned about its factories');
  });

  await check('never more than two warnings on one choice', async () => {
    const { H, codes } = await hallOf([{ fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const card = (await get('/api/state', { code:codes[0] })).card;
    for(const c of card.choices)
      assert.ok((c.notes || []).length <= 2, `choice ${c.key} carried ${c.notes.length} warnings`);
  });

  await check('the projector learns nothing', async () => {
    /* /api/room is read by the console and the wall, in front of everyone. */
    const { H, codes } = await hallOf([{ fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const room = await get('/api/room', { room:H.room });
    const body = JSON.stringify(room.card);
    assert.ok(!/notes/.test(body), 'the public card carried per-country warnings');
    assert.ok(!/factories —/.test(body), 'a warning sentence reached the public route');
  });

  await check('no route ever carries the effects table', async () => {
    const { H, codes } = await hallOf([{ fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    for(const body of [
      JSON.stringify((await get('/api/state', { code:codes[0] })).card),
      JSON.stringify((await get('/api/room', { room:H.room })).card)
    ]){
      assert.ok(!/"fx"/.test(body), 'meter effects reached a page');
      assert.ok(!/"coin"/.test(body), 'coin values reached a page');
      assert.ok(!/"bite"/.test(body), 'the bite table itself reached a page');
    }
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();