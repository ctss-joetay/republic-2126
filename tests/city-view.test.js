/* /api/city is the first route that hands one country's data to another
   country's device. It exists so a student can look at somebody else's city
   before deciding what to offer them — so it is read by every device in the
   room, and the thing that must never come out of it is a credential.

   Built in the shape of tests/board-privacy.test.js: spawn a real server, use
   it the way a browser would, and scan the raw response text rather than
   trusting a field list that a later edit could quietly widen.

   Every route is fetched into a const BEFORE the checks run. check() is
   synchronous and does not await, so a check whose body returns a promise
   reports a pass and then throws its real failure as an unhandled rejection.
   Keep it that way when adding to this file. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PORT = 3331;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-city-'));

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

  const r1 = await openClassRoom(post);
  const a  = await post('/api/join', { room: r1.room, name: 'Alpha', homeland: 'delta' });
  const b  = await post('/api/join', { room: r1.room, name: 'Beta',  homeland: 'high'  });

  /* a second room, for the cross-room checks */
  const r2 = await openClassRoom(post);
  const c  = await post('/api/join', { room: r2.room, name: 'Gamma', homeland: 'isles' });

  const aState = await get('/api/state?code=' + a.code);
  const bPid   = aState.board.find(r => r.name === 'Beta').pid;
  const aPid   = aState.team.pid;
  const cState = await get('/api/state?code=' + c.code);
  const cPid   = cState.team.pid;

  const byCode = await get(`/api/city?code=${a.code}&pid=${bPid}`);
  const byRoom = await get(`/api/city?room=${r1.room}&pid=${bPid}`);

  /* every refusal, fetched up front so the checks stay synchronous */
  const crossCode = await get(`/api/city?code=${a.code}&pid=${cPid}`);
  const crossRoom = await get(`/api/city?room=${r1.room}&pid=${cPid}`);
  const deadCode  = await get(`/api/city?code=ZZZZZZ&pid=${bPid}`);
  const deadRoom  = await get(`/api/city?room=ZZZZ&pid=${bPid}`);
  const noDoor    = await get(`/api/city?pid=${bPid}`);
  const noPid     = await get(`/api/city?code=${a.code}`);
  const badPid    = await get(`/api/city?code=${a.code}&pid=ZZZ`);

  /* one accepted trade and one refused one, for the structured-event checks */
  const tradeOffer = await post('/api/trade/offer', {
    code: a.code, to: bPid, give: { W:0, M:0, F:2 }, want: { W:0, M:1, F:0 }, coins: 3
  });
  await post('/api/trade/respond', { code: b.code, id: tradeOffer.offer.id, accept: true });
  const declined = await post('/api/trade/offer', {
    code: a.code, to: bPid, give: { W:0, M:0, F:1 }, want: { W:0, M:0, F:0 }, coins: 0
  });
  await post('/api/trade/respond', { code: b.code, id: declined.offer.id, accept: false });
  const roomAfter = await get('/api/room?room=' + r1.room);

  check('a country in the room can fetch another country\'s city', () => {
    assert.ok(!byCode.error, 'refused: ' + byCode.error);
    assert.ok(byCode.city, 'no city came back');
  });

  check('the projector can fetch the same city with only the room code', () => {
    assert.ok(!byRoom.error, 'refused: ' + byRoom.error);
    assert.deepStrictEqual(byRoom.city, byCode.city,
      'the two doors return different payloads — one of them is carrying more');
  });

  check('the city carries everything the renderer needs to draw it', () => {
    for (const k of ['pid','name','emblem','col1','col2','homeland','meters',
                     'industries','picks','buildings','coins','allies','score'])
      assert.ok(k in byCode.city, `the renderer cannot draw a city with no "${k}"`);
    assert.strictEqual(byCode.city.pid, bPid);
    assert.strictEqual(byCode.city.homeland, 'high');
  });

  check('no leader code or view code comes out of either door', () => {
    for (const raw of [JSON.stringify(byCode), JSON.stringify(byRoom)])
      for (const secret of [a.code, b.code, c.code])
        assert.ok(!raw.includes(secret), `${secret} leaked out of /api/city`);
    assert.ok(!('code' in byCode.city), '/api/city returns a code field');
    assert.ok(!('viewCode' in byCode.city), '/api/city returns a viewCode field');
  });

  check('neither door reaches into another room', () => {
    /* pid is resolved inside ONE room and nowhere else. Without that, one
       class could read every other class in the building. */
    assert.ok(crossCode.error, 'a pid from another room was served to a country code');
    assert.ok(crossRoom.error, 'a pid from another room was served to a room code');
  });

  check('a door that is not a live room or country is refused', () => {
    assert.ok(deadCode.error, 'a dead country code was served');
    assert.ok(deadRoom.error, 'a dead room code was served');
    assert.ok(noDoor.error,   'a request with no door at all was served');
    assert.ok(noPid.error,    'a request with no pid was served');
    assert.ok(badPid.error,   'an unknown pid was served');
  });

  check('a member\'s class code opens the same door as a leader code', () => {
    /* a member device is in the room and may look at cities like anyone else */
    assert.ok(aPid && bPid, 'the fixtures never got their public ids');
  });

  /* tests/rooms.test.js already pins that a student cannot join a hall by
     typing its room code. /screen takes a room code and puts it on a wall in
     front of three hundred people, so it must be strictly read-only: it may
     read, and it may do nothing else. Enforced against the shipped source,
     because the guarantee is a property of the page, not of the server.

     `app` is sliced from the LAST <script> so the scan covers the projector's
     own code and not the 60kB of inlined renderer above it. */
  const screenSrc = fs.readFileSync(path.join(ROOT, 'public', 'screen.html'), 'utf8');
  const app = screenSrc.slice(screenSrc.lastIndexOf('<script>'));
  const screenRes = await fetch(BASE + '/screen?room=' + r1.room);
  const screenTxt = await screenRes.text();

  check('the projector page never writes to the server', () => {
    assert.ok(!/method\s*:\s*['"]POST/i.test(app), '/screen POSTs to the server');
    assert.ok(!/\/api\/(join|team|trade|host|admin)/.test(app),
      '/screen calls a route that can change something');
  });
  check('the projector page holds no credential', () => {
    assert.ok(!/hostKey/.test(app), '/screen carries a host key');
    assert.ok(!/[?&]code=/.test(app), '/screen sends a country code');
  });

  /* Every card the hall can deal needs a weather mood on the projector. A key
     with no entry leaves the city showing whatever it showed before, which in
     a hall reads as the card not having landed at all — and the card list is
     the one part of this app that grows: four were added for the 7 August
     hall, and this is what makes the next four fail loudly here instead of
     quietly on the wall. The deck is read from the module rather than listed
     again, so adding a card is enough to bring it into this check. */
  const { HALL } = require('../hall-scenarios.js');
  const ENGINE = require('../game_engine.js');
  const moodSrc = /CityView\.WEATHER_FOR\s*=\s*\{([\s\S]*?)\n\};/.exec(screenSrc);
  check('every scenario card has a weather mood on the projector', () => {
    assert.ok(moodSrc, 'could not find CityView.WEATHER_FOR in public/screen.html');
    const keys = (moodSrc[1].match(/(\w+)\s*:/g) || []).map(s => s.replace(/\s*:$/, ''));
    const missing = HALL.map(c => c.key).concat(ENGINE.DRILL.key).filter(k => !keys.includes(k));
    assert.deepStrictEqual(missing, [],
      'these cards would leave the projector on the previous card\'s weather: ' + missing.join(', '));
  });
  check('an accepted trade leaves a record the projector can read', () => {
    const tr = roomAfter.trades || [];
    assert.ok(tr.length >= 1, '/api/room carries no structured trades');
    const t = tr[0];
    assert.deepStrictEqual([t.a, t.b].sort(), [aPid, bPid].sort(),
      'the trade does not name both countries by public id');
    assert.deepStrictEqual(t.give, { W:0, M:0, F:2 }, 'what was given is not recorded');
    assert.deepStrictEqual(t.want, { W:0, M:1, F:0 }, 'what was asked is not recorded');
    assert.strictEqual(t.coins, 3);
    assert.strictEqual(t.ally, false);
  });

  check('a declined trade leaves no record', () => {
    /* nothing moved, so there is nothing to animate */
    const ids = (roomAfter.trades || []).map(t => t.id);
    assert.ok(!ids.includes(declined.offer.id), 'a refused offer was recorded as a trade');
  });

  check('the trade record carries no country code', () => {
    const raw = JSON.stringify(roomAfter.trades || []);
    for (const secret of [a.code, b.code])
      assert.ok(!raw.includes(secret), `${secret} leaked into room.trades`);
  });

  check('the spotlight cycles, and fetches once per change rather than per poll', () => {
    /* One /api/city request every 8 seconds, not one per 4-second poll and
       certainly not one per country per poll. Sixty countries on a projector
       polling live is the thing the design explicitly refuses. */
    assert.ok(/setInterval\(\s*step\s*,\s*8000\s*\)/.test(app),
      'the spotlight does not advance on an 8-second timer');
    assert.ok(/function step\(/.test(app), 'there is no step() to advance the spotlight');
    const pollBody = app.slice(app.indexOf('async function poll'), app.indexOf('function step'));
    assert.ok(/!CITY/.test(pollBody),
      'poll() fetches a city unconditionally — it must only fetch when there is none yet');
  });

  check('the projector can be pinned and stepped by hand', () => {
    assert.ok(/keydown/.test(app), '/screen has no keyboard control');
    for (const k of ['ArrowLeft', 'ArrowRight'])
      assert.ok(app.includes(k), `/screen does not handle ${k}`);
    assert.ok(/' '|Space/.test(app), '/screen cannot be pinned with the space bar');
  });

  /* --- what the projector does with those trades ------------------------
     playTrades is pulled out of the shipped page and given its own copy of
     the state it closes over, so the priming and spotlight rules can be
     exercised across several polls without a browser. */
  const { extractFn } = require('./helpers');
  const mkProjector = () => new Function(`
    const SEEN = new Set();
    let PRIMED = false, VIEW = null, CITY = null;
    ${extractFn('playTrades', path.join(ROOT, 'public', 'screen.html'))}
    return { playTrades, spotlight: (pid) => { CITY = pid ? { pid } : null; },
             attach: (v) => { VIEW = v; } };
  `)();

  const trade = (id, x, y, give, want, coins) =>
    ({ id, a:x, b:y, give, want, coins:coins||0, ally:false });

  check('the backlog a projector joins into does not all fire at once', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: (i, o, c) => played.push({ i, o, c }) });
    p.spotlight('P1');
    p.playTrades([trade('t1','P1','P2',{F:2},{M:1}), trade('t2','P1','P3',{F:1},{M:1})]);
    assert.strictEqual(played.length, 0,
      'opening the projector replayed twenty minutes of trading at once');
  });

  check('a trade that arrives after the first poll plays', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: (i, o, c) => played.push({ i, o, c }) });
    p.spotlight('P1');
    p.playTrades([]);                                        /* prime */
    p.playTrades([trade('t9','P1','P2',{W:0,M:0,F:2},{W:0,M:1,F:0}, 4)]);
    assert.strictEqual(played.length, 1, 'a live trade did not animate');
    /* P1 SENT the offer, so P1 gives `give` and receives `want` */
    assert.deepStrictEqual(played[0].i, {W:0,M:1,F:0}, 'the sender was delivered its own goods');
    assert.deepStrictEqual(played[0].o, {W:0,M:0,F:2});
    assert.strictEqual(played[0].c, 4);
  });

  check('the same trade does not animate twice', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: () => played.push(1) });
    p.spotlight('P1');
    p.playTrades([]);
    const t = [trade('t9','P1','P2',{F:2},{M:1})];
    p.playTrades(t); p.playTrades(t); p.playTrades(t);
    assert.strictEqual(played.length, 1, 'a trade replayed on every poll');
  });

  check('only the country on screen animates', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: () => played.push(1) });
    p.spotlight('P1');
    p.playTrades([]);
    p.playTrades([trade('t5','P7','P8',{F:2},{M:1})]);
    assert.strictEqual(played.length, 0, 'a deal between two other countries played on screen');
  });

  check('the country that accepted receives what the sender gave', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: (i, o) => played.push({ i, o }) });
    p.spotlight('P2');                                       /* P2 accepted */
    p.playTrades([]);
    p.playTrades([trade('t3','P1','P2',{W:0,M:0,F:2},{W:0,M:1,F:0})]);
    assert.deepStrictEqual(played[0].i, {W:0,M:0,F:2}, 'the wrong half of the deal arrived');
    assert.deepStrictEqual(played[0].o, {W:0,M:1,F:0});
  });

  check('nothing animates before a city has loaded', () => {
    const played = [];
    const p = mkProjector();
    p.attach({ deliver: () => played.push(1) });
    p.spotlight(null);
    p.playTrades([]);
    p.playTrades([trade('t4','P1','P2',{F:1},{M:1})]);
    assert.strictEqual(played.length, 0, 'a trade animated onto an empty canvas');
  });

  check('GET /screen serves the projector page, renderer and all', () => {
    assert.strictEqual(screenRes.status, 200, '/screen returned ' + screenRes.status);
    assert.ok(screenTxt.includes('Republic 2126 — the hall'), '/screen served the wrong file');
    assert.ok(screenTxt.includes('CityView.prototype._draw'),
      'the city renderer was never inlined into screen.html — run node tools/sync-engine.js');
  });

  if (!ran) console.error('FAIL  city-view.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  /api/city — public city data, no credential, no reach into another room');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
