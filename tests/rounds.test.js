/* What happens between rounds: the decision clock, and what it costs a country
   that never decides. The countdown is stored as an end instant so every device
   counts the same seconds; the indecision penalty is applied as the round turns,
   which is the only moment the server still knows who ducked the card. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const E = require('../game_engine.js');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3315, BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-timer-'));
const post = (p, b) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }).then(r=>r.json());
const get  = (p) => fetch(BASE + p).then(r=>r.json());
const server = spawn('node', ['server.js'], { cwd:ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT), DATA_DIR}, stdio:'ignore' });
const done = makeDone(server, DATA_DIR);

/* A hall room no longer accepts /api/join by room code (that is the hole this
   round of work closed) — a country arrives there by migration in a later
   task. Until that route exists, a host-authenticated import is the one
   legitimate way to seed a hall room with a country for this test. */
let joinSeq = 0;
async function joinHall(room, hostKey, name, homeland){
  const exp = await get(`/api/host/export?room=${room}&hostKey=${hostKey}`);
  const snap = exp.snapshot;
  const tc = 'HALL' + (joinSeq++);
  const team = Object.assign(E.blankCountry(), { code: tc, name, homeland });
  team.meters = E.foundingMeters(team);
  snap.teams[tc] = team;
  const imp = await post('/api/host/import', { snapshot: snap });
  if(imp.error) throw new Error('joinHall could not seed the room: ' + imp.error);
  return { code: tc };
}

(async () => {
  for (let i=0;i<60;i++){ try{ const r=await fetch(BASE+'/health'); if(r.ok) break; }catch{} await new Promise(r=>setTimeout(r,100)); }
  let fails = 0, ran = 0;
  const check = (label, fn) => { ran++; try { fn(); console.log('PASS  '+label); } catch(e){ console.error('FAIL  '+label+' — '+e.message); fails++; } };

  const room = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const K = { room: room.room, hostKey: room.hostKey };
  const t = await joinHall(room.room, room.hostKey, 'Ditherer', 'high');
  await post('/api/host/act', { ...K, act:'phase', phase:'game' });

  await post('/api/host/act', { ...K, act:'timer', secs:120 });
  let s = await get('/api/state?code=' + t.code);
  check('setting a length starts the clock and every client is told when it ends', () => {
    assert.strictEqual(s.timerSecs, 120);
    assert.ok(s.timerEndsAt > s.now, 'the end instant is not in the future');
    assert.ok(Math.abs((s.timerEndsAt - s.now)/1000 - 120) < 3, 'roughly two minutes should remain');
  });

  const before = (await get('/api/state?code=' + t.code)).timerEndsAt;
  await new Promise(r => setTimeout(r, 1100));
  await post('/api/host/act', { ...K, act:'scenario', key:'haze' });
  s = await get('/api/state?code=' + t.code);
  check('throwing a card restarts the clock on its own', () => {
    assert.ok(s.timerEndsAt > before, 'the card did not restart the countdown');
  });

  await post('/api/host/act', { ...K, act:'round' });
  s = await get('/api/state?code=' + t.code);
  check('the round ending stops the clock', () => {
    assert.strictEqual(s.timerEndsAt, null, 'the clock is still running after the round ended');
    assert.strictEqual(s.timerSecs, 120, 'the chosen length should be remembered for the next card');
  });

  await post('/api/host/act', { ...K, act:'timer', secs:1 });
  await new Promise(r => setTimeout(r, 1600));
  s = await get('/api/state?code=' + t.code);
  check('running out advances nothing by itself', () => {
    assert.ok(s.timerEndsAt <= s.now, 'the clock should have expired');
    assert.strictEqual(s.round, 2, 'the round advanced without the teacher pressing anything');
    assert.strictEqual(s.phase, 'game', 'the phase changed on its own');
  });

  await post('/api/host/act', { ...K, act:'timer', secs:0 });
  s = await get('/api/state?code=' + t.code);
  check('Off stops the clock and stops cards restarting it', () => {
    assert.strictEqual(s.timerEndsAt, null);
    assert.strictEqual(s.timerSecs, 0);
  });
  await post('/api/host/act', { ...K, act:'scenario', key:'boom' });
  s = await get('/api/state?code=' + t.code);
  check('with the clock off, a card does not start one', () => {
    assert.strictEqual(s.timerEndsAt, null, 'a card started a clock the teacher turned off');
  });

  /* ---- the indecision penalty ---- */
  const room2 = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const K2 = { room: room2.room, hostKey: room2.hostKey };
  const dec = await joinHall(room2.room, room2.hostKey, 'Decider', 'high');
  const dit = await joinHall(room2.room, room2.hostKey, 'Ditherer', 'high');
  await post('/api/host/act', { ...K2, act:'phase', phase:'game' });

  await post('/api/host/act', { ...K2, act:'round' });
  let sd = await get('/api/state?code=' + dit.code);
  check('a round with no card open penalises nobody', () => {
    assert.strictEqual(sd.team.meters.S, 50, 'Stability moved with no card on the table');
    assert.strictEqual(sd.team.meters.H, 50, 'Harmony moved with no card on the table');
  });

  /* A card now opens with a discussion window in which nobody may decide, so a
     test that decides the instant one is dealt would be refused. A 10-second
     card clock is shorter than the 15-second floor discussionEnd() leaves to
     decide in, so the window clamps into the past and deciding is open at once
     — which is the point being tested here, not the window itself. */
  await post('/api/host/act', { ...K2, act:'timer', secs:10 });
  await post('/api/host/act', { ...K2, act:'scenario', key:'haze' });
  const decided = await post('/api/scenario/choose', { code: dec.code, choice: 'b' });
  check('the Decider could actually decide', () => {
    assert.ok(!decided.error, 'the fixture never got its decision in: ' + decided.error);
  });
  const beforeCoins = (await get('/api/state?code=' + dit.code)).team.coins;
  await post('/api/host/act', { ...K2, act:'round' });
  sd = await get('/api/state?code=' + dit.code);
  const sc = await get('/api/state?code=' + dec.code);
  check('a country that never decided loses Stability and Harmony', () => {
    assert.ok(sd.team.meters.S < 50, `Stability did not fall (${sd.team.meters.S})`);
    assert.ok(sd.team.meters.H < 50, `Harmony did not fall (${sd.team.meters.H})`);
  });
  check('it costs no coins, and the card\'s own effects are still skipped', () => {
    assert.strictEqual(sd.team.coins, beforeCoins, 'indecision moved coins');
    assert.ok(sc.team.coins < sd.team.coins,
      'the country that actually chose should have paid for its choice');
  });
  check('the country that decided is not penalised for indecision', () => {
    assert.strictEqual(sc.team.meters.S, 50, 'a country that chose lost Stability anyway');
  });
  check('the feed names who could not agree', () => {
    const feed = sd.feed || [];
    assert.ok(feed.some(f => /Ditherer/.test(f.text) && /could not agree/.test(f.text)),
      'nothing in the feed said which country failed to decide');
  });

  if (!ran) console.error('FAIL  rounds.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  rounds — the clock counts, and failing to govern costs something');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
