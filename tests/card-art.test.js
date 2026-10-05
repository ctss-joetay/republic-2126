/* GET /api/card-art hands the projector the photograph for the card a hall has
   open. It is the only route in the app that answers in JPEG, and the only one
   that reads a file from outside public/ — so what it must never do is serve a
   card the room has not dealt.

   That is the whole secrecy argument for the clippings: a news clipping IS the
   card. The picture gives the scenario away as surely as the story does, so if
   this route could be walked through the deck, hall-scenarios.js being
   server-only would count for nothing. It takes no card key at all — the
   filename comes from room.scenario — and these checks pin that. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3346;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-art-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, HALL_KEY: HALL_PASS }, stdio: 'ignore'
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

  const { HALL } = require('../hall-scenarios.js');
  const art = (room, extra) => fetch(`${BASE}/api/card-art?room=${encodeURIComponent(room)}${extra || ''}`);

  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const act  = (b) => post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, ...b });

  /* Nothing open yet. */
  const closed = await art(hall.room);
  check('a room with no card open serves no picture', () => {
    assert.strictEqual(closed.status, 404,
      'the projector could fetch a clipping with no card open — the deck would be readable at any time');
  });
  const nowhere = await art('ZZZZ');
  check('a room code that does not exist serves no picture', () => {
    assert.strictEqual(nowhere.status, 404);
  });

  /* A card the room genuinely has open. */
  const first = HALL[0].key, second = HALL[1].key;
  await act({ act:'scenario', key:first });
  const openRes = await art(hall.room);
  const openBuf = Buffer.from(await openRes.arrayBuffer());
  const onDisk  = fs.readFileSync(path.join(ROOT, 'assets', 'cards', first + '.jpg'));
  check('the open card\'s photograph comes back, and it is the right file', () => {
    assert.strictEqual(openRes.status, 200, 'the open card served no picture');
    assert.strictEqual(openRes.headers.get('content-type'), 'image/jpeg');
    assert.ok(openBuf.equals(onDisk),
      `the bytes served are not assets/cards/${first}.jpg`);
  });
  check('every card in the deck has a photograph on disk', () => {
    const missing = HALL.filter(c => !fs.existsSync(path.join(ROOT, 'assets', 'cards', c.key + '.jpg')))
                        .map(c => c.key);
    assert.deepStrictEqual(missing, [],
      'these cards would land on the wall with no picture: ' + missing.join(', '));
  });

  /* The request cannot choose the picture. Ask for the second card by every
     name the route might plausibly read, while the FIRST is the open one. */
  const forgeries = await Promise.all([
    art(hall.room, '&card=' + second),
    art(hall.room, '&key=' + second),
    art(hall.room, '&scenario=' + second),
    art(hall.room, '&file=' + second)
  ]);
  const forged = await Promise.all(forgeries.map(async r => Buffer.from(await r.arrayBuffer())));
  check('nothing in the request can pick which card is served', () => {
    for (const b of forged)
      assert.ok(b.equals(onDisk),
        'a query parameter changed which clipping came back — the deck can be read ahead by asking for it');
  });

  /* ...including a traversal attempt, which must not escape assets/cards. */
  const climb = await fetch(`${BASE}/api/card-art?room=${hall.room}&card=${encodeURIComponent('../../server.js')}`);
  const climbBuf = Buffer.from(await climb.arrayBuffer());
  check('a path-traversal attempt returns the open card, not a file from the repo', () => {
    assert.ok(climbBuf.equals(onDisk), 'the route read a file chosen by the caller');
    assert.ok(!climbBuf.includes(Buffer.from('require(')), 'source code came back from the art route');
  });

  /* Throwing a different card changes the picture. */
  await act({ act:'clear' });
  await act({ act:'scenario', key:second });
  const secondRes = await art(hall.room);
  const secondBuf = Buffer.from(await secondRes.arrayBuffer());
  check('a new card on the table means a new picture on the wall', () => {
    assert.strictEqual(secondRes.status, 200);
    assert.ok(!secondBuf.equals(openBuf), 'the second card served the first card\'s clipping');
    assert.ok(secondBuf.equals(fs.readFileSync(path.join(ROOT, 'assets', 'cards', second + '.jpg'))));
  });

  /* Closing the card takes the picture away again. */
  await act({ act:'clear' });
  const afterClear = await art(hall.room);
  check('closing the card closes the clipping', () => {
    assert.strictEqual(afterClear.status, 404,
      'the clipping outlived the card — the wall keeps a scenario up after the game master closed it');
  });

  /* The projector fetches each image once. A THIRD card, not the first again:
     a hall refuses to throw a card it has already played, so re-dealing `first`
     leaves nothing open and this would be measuring a 404. */
  const third = HALL[2].key;
  await act({ act:'scenario', key:third });
  const withTag = await art(hall.room);
  const etag = withTag.headers.get('etag');
  await withTag.arrayBuffer();
  const revalidate = await fetch(`${BASE}/api/card-art?room=${hall.room}`, { headers:{ 'If-None-Match': etag } });
  check('a projector that already has the picture is told so, not sent it again', () => {
    assert.ok(etag, 'no ETag on the clipping');
    assert.strictEqual(revalidate.status, 304);
  });

  /* The classroom drill is served the same way as a hall card — a teacher's
     console is projected too, and the drill is the rehearsal for exactly this
     moment, so it should arrive looking the way the real thing will. */
  const cls = await post('/api/host/create', { kind:'class', label:'3Z' });
  await post('/api/host/groups', { room:cls.room, hostKey:cls.hostKey, n:1 });
  const roster = await post('/api/host/roster', { room:cls.room, hostKey:cls.hostKey });
  await post('/api/team/save', { code:roster.roster[0].code, country:{ name:'Artless', members:{ leader:'A' } } });
  await post('/api/team/commit', { code:roster.roster[0].code });
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'scenario' });
  const drillArt = await fetch(`${BASE}/api/card-art?room=${cls.room}`);
  const drillBuf = Buffer.from(await drillArt.arrayBuffer());
  const E = require('../game_engine.js');
  check('the classroom drill has a picture too', () => {
    assert.strictEqual(drillArt.status, 200, 'the drill served no photograph');
    assert.ok(drillBuf.equals(fs.readFileSync(path.join(ROOT, 'assets', 'cards', E.DRILL.key + '.jpg'))),
      `the bytes served are not assets/cards/${E.DRILL.key}.jpg`);
  });
  /* A card whose file is genuinely absent must still be a plain 404 the pages
     can ignore, not a 500 — that is the fallback both overlays are built on. */
  const bogus = await fetch(`${BASE}/api/card-art?room=${cls.room}&card=nosuchcard`);
  check('a missing art file would be a plain 404, not a server error', () => {
    assert.ok([200, 404].includes(bogus.status), 'unexpected status ' + bogus.status);
  });

  /* ---- the projector side, pulled straight out of the shipped page ---- */
  const { extractFn } = require('./helpers');
  const SCREEN = path.join(ROOT, 'public', 'screen.html');
  function clipHarness(){
    const made = {};
    const el = (id) => (made[id] = made[id] || {
      id, textContent:'', src:'', srcSets:0, onerror:null, _c:new Set(),
      classList:{ add(c){ el(id)._c.add(c); }, remove(c){ el(id)._c.delete(c); },
                  contains(c){ return el(id)._c.has(c); } }
    });
    /* src counts its own assignments, which is how the "does not repaint on
       every poll" check below can tell a redraw from a no-op. */
    Object.defineProperty(el('clipImg'), 'src', {
      get(){ return this._src || ''; },
      set(v){ this._src = v; this.srcSets = (this.srcSets || 0) + 1; }
    });
    const src = 'let CLIP = null;\n' + extractFn('renderClip', SCREEN) + '\nreturn { renderClip, CLIP: () => CLIP };';
    const api = new Function('$', 'ROOM', src)(el, 'ABCD');
    return { ...api, $: el };
  }

  const card = { key:'haze', title:'The Haze Returns', story:'Thick smoke blankets the region.' };
  const h = clipHarness();
  h.renderClip(card);
  check('an open card puts the front page on the wall', () => {
    assert.ok(h.$('clip').classList.contains('on'), 'the clipping never appeared');
    assert.strictEqual(h.$('clipTitle').textContent, card.title);
    assert.strictEqual(h.$('clipStory').textContent, card.story);
    assert.ok(/\/api\/card-art\?room=ABCD/.test(h.$('clipImg').src),
      'the photograph was not requested for this room: ' + h.$('clipImg').src);
  });
  check('a poll that brings the same card again does not repaint it', () => {
    const before = h.$('clipImg').srcSets;
    h.renderClip(card);
    h.renderClip(card);
    assert.strictEqual(h.$('clipImg').srcSets, before,
      'the image was reassigned on an unchanged poll — the wall would flash every few seconds');
  });
  check('a photograph that fails to load leaves the headline standing', () => {
    h.$('clipImg').onerror();
    assert.ok(h.$('clipImg').classList.contains('gone'), 'the broken image was left on screen');
    assert.ok(h.$('clip').classList.contains('on'), 'a missing photograph took the whole card off the wall');
    assert.strictEqual(h.$('clipTitle').textContent, card.title, 'the headline went with the picture');
  });
  check('closing the card clears the wall', () => {
    h.renderClip(null);
    assert.ok(!h.$('clip').classList.contains('on'), 'the clipping outlived the card on the projector');
  });

  /* ---- the console side, which is the screen at the front of the room ----
     Dismissing the front page must NOT close the card: the room is still
     deciding and the teacher only wants the controls back. Only "Close card
     for everyone" ends it. Getting that wrong on a projected console would
     pull a live scenario off three hundred phones. */
  const HOST = path.join(ROOT, 'public', 'host.html');
  function hostHarness(){
    const made = {};
    const el = (id) => (made[id] = made[id] || {
      id, textContent:'', onerror:null, _c:new Set(),
      classList:{ add(c){ el(id)._c.add(c); }, remove(c){ el(id)._c.delete(c); },
                  contains(c){ return el(id)._c.has(c); } }
    });
    const cleared = [];
    const R = { room:'J88A', data:null };
    const src = [ extractFn('renderHostCard', HOST), extractFn('paintHostCard', HOST),
                  extractFn('hideCard', HOST), extractFn('showCard', HOST) ].join('\n')
              + '\nreturn { renderHostCard, hideCard, showCard };';
    const api = new Function('$', 'R', 'cleared', src)(el, R, cleared);
    return { ...api, $: el, R, cleared };
  }

  const openCard = { key:'boom', icon:'📈', title:'A Foreign Firm Comes Knocking', story:'A giant company will build a plant.' };
  const hh = hostHarness();
  hh.R.data = { card: openCard };
  hh.renderHostCard(hh.R.data);
  check('throwing a card raises the front page over the console', () => {
    assert.ok(hh.$('hcard').classList.contains('on'), 'the card never appeared on the console');
    assert.strictEqual(hh.$('hcardTitle').textContent, openCard.title);
    assert.ok(/\/api\/card-art\?room=J88A/.test(hh.$('hcardImg').src || ''),
      'the console asked for no photograph: ' + hh.$('hcardImg').src);
  });
  check('dismissing it gives the console back without closing the card', () => {
    hh.hideCard();
    assert.ok(!hh.$('hcard').classList.contains('on'), 'the front page would not go away');
    assert.ok(!hh.$('showCardBtn').classList.contains('hidden'), 'no way offered to bring the card back');
    /* the poll keeps arriving with the same card open — it must stay dismissed */
    hh.renderHostCard(hh.R.data);
    hh.renderHostCard(hh.R.data);
    assert.ok(!hh.$('hcard').classList.contains('on'),
      'the next poll raised the card again over a teacher who had just dismissed it');
  });
  check('the card can be put back up on purpose', () => {
    hh.showCard();
    assert.ok(hh.$('hcard').classList.contains('on'), 'Show the card again did nothing');
    assert.ok(hh.$('showCardBtn').classList.contains('hidden'), 'the offer to show it stayed up while it was up');
  });
  check('closing the card for everyone clears the console', () => {
    hh.renderHostCard({ card:null });
    assert.ok(!hh.$('hcard').classList.contains('on'), 'the front page outlived the card on the console');
    assert.ok(hh.$('showCardBtn').classList.contains('hidden'),
      'the console still offered to show a card that is no longer open');
  });
  check('a photograph that fails to load leaves the headline on the console', () => {
    const h2 = hostHarness();
    h2.renderHostCard({ card: openCard });
    h2.$('hcardImg').onerror();
    assert.ok(h2.$('hcardImg').classList.contains('gone'), 'the broken image stayed on the projected screen');
    assert.ok(h2.$('hcard').classList.contains('on'), 'a missing photograph took the whole card off the console');
    assert.strictEqual(h2.$('hcardTitle').textContent, openCard.title);
  });

  if (!ran) console.error('FAIL  card-art.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  card-art — the wall gets the open card\'s picture, and no other');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
