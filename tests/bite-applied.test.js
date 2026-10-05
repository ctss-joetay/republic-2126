/* The tilt, applied for real. Two countries answer the SAME choice on the same
   card and must land in different places — that is the whole feature — while
   two identical countries must land identically, because this is a mechanism
   and not a dice roll.

   Against a spawned server: the ordering with ally scaling and the classroom
   coin rule both live in chooseScenario, and calling the engine directly would
   test neither. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HALL_PASS = 'K7m2Qx9p';
const ADMIN_PASS = 'a-very-long-admin-key-for-bite-tests';
const PORT = 3976;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-bite-'));
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

/* Countries are built in a trusted classroom and migrated, which is the path
   students actually take. `builds` is one industries object per country. */
async function hallOf(builds){
  const hall = await post('/api/host/create', { kind:'hall', key:HALL_PASS, label:'Hall' });
  const cls  = await post('/api/host/create', { kind:'class', key:ADMIN_PASS, label:'3E' });
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
  await post('/api/admin/trust', { key:ADMIN_PASS, room:cls.room });
  const codes = [];
  for(let i = 0; i < builds.length; i++){
    /* Port City on purpose: /api/team/save REVERTS an industries object the
       country cannot afford, silently, and a River Delta cannot pay for two
       factories (W8/M3 against W3/M2 each). A reverted build makes both
       countries identical and the test then fails for a reason that has
       nothing to do with bites. */
    const j = await post('/api/join', { room:cls.room, name:'C'+i, homeland:'port' });
    await post('/api/team/save', { code:j.code, country:{
      members:{ leader:'L', edu:'', def:'', trade:'', infra:'' }, industries: builds[i] } });
    const built = (await get('/api/state', { code:j.code })).team.industries || {};
    for(const k of Object.keys(builds[i]))
      if((built[k]||0) !== builds[i][k])
        throw new Error(`fixture: C${i} asked for ${builds[i][k]} ${k} and got ${built[k]||0} — the save was reverted as unaffordable`);
    const cm = await post('/api/team/commit', { code:j.code });
    if(cm.error) throw new Error('fixture could not commit C'+i+': ' + cm.error);
    await post('/api/team/join-hall', { code:j.code, room:hall.room });
    codes.push(j.code);
  }
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'phase', phase:'game' });
  /* 10 seconds is under the 15-second floor discussionEnd() leaves to decide
     in, so the discussion window clamps into the past and these cards can be
     answered at once. See tests/discussion-minute.test.js. */
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'timer', secs:10 });
  return { H:{ room:hall.room, hostKey:hall.hostKey }, codes };
}

const state = (code) => get('/api/state', { code });

(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(base + '/api/room?room=ZZZZ'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
  }

  await check('the same choice costs an industrial country more', async () => {
    /* haze / 'a' — shut the dirty factories — is bitten by factories. */
    const { H, codes } = await hallOf([{ fact:0 }, { fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const before0 = (await state(codes[0])).team.coins;
    const before1 = (await state(codes[1])).team.coins;
    const r0 = await post('/api/scenario/choose', { code:codes[0], choice:'a' });
    const r1 = await post('/api/scenario/choose', { code:codes[1], choice:'a' });
    assert.ok(!r0.error && !r1.error, 'a decision was refused: ' + (r0.error || r1.error));
    const paid0 = before0 - (await state(codes[0])).team.coins;
    const paid1 = before1 - (await state(codes[1])).team.coins;
    assert.ok(paid1 > paid0,
      `the factory country paid ${paid1} and the farming country paid ${paid0} — the bite did not land`);
  });

  await check('two identical countries land identically', async () => {
    /* A mechanism, not a dice roll. */
    const { H, codes } = await hallOf([{ fact:2 }, { fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    await post('/api/scenario/choose', { code:codes[0], choice:'a' });
    await post('/api/scenario/choose', { code:codes[1], choice:'a' });
    const a = (await state(codes[0])).team, b = (await state(codes[1])).team;
    assert.strictEqual(a.coins, b.coins, 'identical countries ended on different coins');
    assert.deepStrictEqual(a.meters, b.meters, 'identical countries ended on different meters');
  });

  await check('a country with no factories is unaffected by a factory bite', async () => {
    /* The base card still applies in full — only the tilt is absent. */
    const { H, codes } = await hallOf([{ farm:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    const before = (await state(codes[0])).team;
    await post('/api/scenario/choose', { code:codes[0], choice:'a' });
    const after = (await state(codes[0])).team;
    assert.ok(after.coins < before.coins, 'the base card cost nothing at all');
  });

  await check('what actually applied comes back with the decision', async () => {
    const { H, codes } = await hallOf([{ fact:2 }]);
    await post('/api/host/act', { ...H, act:'scenario', key:'haze' });
    await post('/api/scenario/choose', { code:codes[0], choice:'a' });
    const t = (await state(codes[0])).team;
    assert.ok(Array.isArray(t.chosen.notes), 'the decision carried no notes array');
    assert.ok(t.chosen.notes.length >= 1, 'a factory country got no explanation of its bite');
    assert.ok(/\d/.test(t.chosen.notes[0]) || t.chosen.notes[0].length > 10,
      'the note looks empty: ' + JSON.stringify(t.chosen.notes[0]));
  });

  await check('a classroom drill still moves no coins, bite or not', async () => {
    const cls = await post('/api/host/create', { kind:'class', key:ADMIN_PASS, label:'3G' });
    await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'openjoin' });
    const j = await post('/api/join', { room:cls.room, name:'Drillton', homeland:'delta' });
    await post('/api/team/save', { code:j.code, country:{
      members:{ leader:'L', edu:'', def:'', trade:'', infra:'' }, industries:{ fact:1 } } });
    await post('/api/team/commit', { code:j.code });
    const before = (await state(j.code)).team.coins;
    await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'timer', secs:10 });
    await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'scenario' });
    await post('/api/scenario/choose', { code:j.code, choice:'a' });
    assert.strictEqual((await state(j.code)).team.coins, before,
      'a rehearsal moved coins — the bite leaked past the classroom coin rule');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();