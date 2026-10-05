/* boardRow() used to send every country's leader code to every device in the
   room. Harmless when a typed code was merely how you addressed a trade —
   but once a leader code is the credential that separates the one device
   allowed to edit a country from the rest that may only watch, publishing it
   on the shared leaderboard hands that credential to every student in the
   room. This pins the fix: the board, offers and allies carry a public id
   (pid), never a code or viewCode. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const MIN = ['edu', 'def', 'trade', 'infra'];
const PORT = 3328;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-priv-'));

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
  const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
    catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

  const room = await openClassRoom(post);
  const a = await post('/api/join', { room: room.room, name: 'Alpha', homeland: 'delta' });
  const b = await post('/api/join', { room: room.room, name: 'Beta', homeland: 'high' });

  const roomView = JSON.stringify(await get('/api/room?room=' + room.room));
  const aState   = await get('/api/state?code=' + a.code);

  check('the shared room view carries no country codes', () => {
    assert.ok(!roomView.includes(a.code), 'a leader code is published on the room view');
    assert.ok(!roomView.includes(b.code), 'a leader code is published on the room view');
  });
  check('one country\'s state does not carry another\'s code', () => {
    const board = JSON.stringify(aState.board);
    assert.ok(!board.includes(b.code), 'the leaderboard hands out other countries\' leader codes');
    assert.ok(board.includes(aState.team.pid) || aState.board.every(r => r.pid),
      'board rows carry no pid to address a trade with');
  });

  /* A trade is addressed by the public id. Addressing one by leader code has to
     fail, or the code is still the thing you need and nothing has changed. */
  const bPid = aState.board.find(r => r.name === 'Beta').pid;
  const byPid = await post('/api/trade/offer', {
    code: a.code, to: bPid, give: { W:0, M:0, F:2 }, want: { W:0, M:1, F:0 }, coins:0, ally:true
  });
  check('a trade addressed by public id is accepted', () => {
    assert.ok(!byPid.error, 'a trade to a valid pid was refused: ' + byPid.error);
  });
  const byCode = await post('/api/trade/offer', {
    code: a.code, to: b.code, give: { W:0, M:0, F:1 }, want: { W:0, M:1, F:0 }, coins:0
  });
  check('a trade addressed by leader code is refused', () => {
    assert.ok(byCode.error, 'a leader code still works as a trade address');
  });

  await post('/api/trade/respond', { code: b.code, id: byPid.offer.id, accept: true });
  const after = await get('/api/state?code=' + a.code);
  check('allies are recorded as public ids', () => {
    assert.ok(after.team.allies.includes(bPid), 'allies do not hold the pid the board publishes');
    assert.ok(!after.team.allies.includes(b.code), 'allies leak the other country\'s leader code');
  });

  /* Belt and braces on the hole this task closes: neither country's leader
     code may appear ANYWHERE in the raw text of either shared endpoint —
     not in board rows, not in offers, not in allies, not in feed messages. */
  const roomRaw  = JSON.stringify(await get('/api/room?room=' + room.room));
  const aStateRaw = JSON.stringify(await get('/api/state?code=' + a.code));
  const bStateRaw = JSON.stringify(await get('/api/state?code=' + b.code));
  check('no leader code appears anywhere in the raw /api/room response', () => {
    assert.ok(!roomRaw.includes(a.code), 'a.code leaked into /api/room');
    assert.ok(!roomRaw.includes(b.code), 'b.code leaked into /api/room');
  });
  check('no OTHER country\'s leader code appears anywhere in /api/state', () => {
    assert.ok(!aStateRaw.includes(b.code), 'b.code leaked into a\'s /api/state');
    assert.ok(!bStateRaw.includes(a.code), 'a.code leaked into b\'s /api/state');
  });

  /* Everything above ran with viewCode:'' — a country joined the old way never
     gets one, so "no view code leaks" was vacuously true no matter what the
     server actually did with it. Provisioning is the first thing that mints a
     real one, so this is the first test that can actually exercise the other
     half of the privacy guarantee: a class code is exactly as secret as a
     leader code, and must never appear on a route any other device can read. */
  const room2 = await openClassRoom(post);
  const g2 = await post('/api/host/groups', { room: room2.room, hostKey: room2.hostKey, n: 2 });
  check('provisioning succeeds, for the view-code leak check below', () => {
    assert.ok(!g2.error, 'provisioning failed: ' + g2.error);
    assert.strictEqual(g2.roster.length, 2);
    g2.roster.forEach(r => assert.ok(r.viewCode, 'a provisioned group has no view code'));
  });
  const [alpha, beta] = g2.roster;
  await post('/api/team/save', { code: alpha.code, country: { name: 'AlphaGroup' } });
  await post('/api/team/save', { code: beta.code,  country: { name: 'BetaGroup' } });

  const offer2 = await post('/api/trade/offer', {
    code: alpha.code, to: beta.pid, give: { W:0, M:0, F:2 }, want: { W:0, M:1, F:0 }, coins:0, ally:true
  });
  check('a provisioned country can trade, addressed by pid', () => {
    assert.ok(!offer2.error, 'a provisioned trade was refused: ' + offer2.error);
  });
  await post('/api/trade/respond', { code: beta.code, id: offer2.offer.id, accept: true });

  const roomRaw2   = JSON.stringify(await get('/api/room?room=' + room2.room));
  const alphaRaw2  = JSON.stringify(await get('/api/state?code=' + alpha.code));
  const betaRaw2   = JSON.stringify(await get('/api/state?code=' + beta.code));

  /* codesOf() pulls all six credentials for a provisioned country: leader,
     view, and the four ministry codes minted alongside it by
     /api/host/groups. None of the six belongs on a shared route — /api/room
     has no role at all, and /api/state must not hand one country's ministry
     codes to another country's device either. */
  const codesOf = (t) => [t.code, t.viewCode, ...MIN.map(m => t.minCodes[m])];
  check('no leader code, view code, or ministry code — of either provisioned country — appears anywhere in /api/room', () => {
    for (const c of [...codesOf(alpha), ...codesOf(beta)])
      assert.ok(!roomRaw2.includes(c), `${c} leaked into /api/room`);
  });
  check('no OTHER provisioned country\'s leader code, view code, or ministry code appears anywhere in /api/state', () => {
    for (const c of codesOf(beta))
      assert.ok(!alphaRaw2.includes(c), `${c} (Beta's) leaked into Alpha's /api/state`);
    for (const c of codesOf(alpha))
      assert.ok(!betaRaw2.includes(c), `${c} (Alpha's) leaked into Beta's /api/state`);
  });

  // a file that ran zero checks proves nothing — do not let it report a pass
  if (!ran) console.error('FAIL  board-privacy.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  board privacy — pid travels on shared payloads, leader codes never do');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
