/* The eight hall cards are the one piece of content in this app that has to
   stay unknown until it is played. They used to live in game_engine.js, which
   tools/sync-engine.js inlines verbatim into public/index.html and
   public/host.html — so every student's phone downloaded all eight, with their
   stories, choices, meter effects and coin values. View Source was enough.

   This pins the fix from the outside: fetch what a device can actually fetch,
   and assert the cards are not in it. Raw text rather than a field list,
   because a field list only ever catches the leak it was told to look for.

   NOT asserted, deliberately: the card KEYS ('haze', 'quake', …) remain on the
   client, because CityView.WEATHER_FOR maps a key to a sky and the renderer
   needs that. Eight one-word keys are a hint at the topics; the stories, the
   choices and every number attached to them are what matter, and those go. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PORT = 3334;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-secret-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get  = (p) => fetch(BASE + p).then(r => r.json());
const text = (p) => fetch(BASE + p).then(r => r.text());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, HALL_KEY:'a-very-long-hall-passcode-for-tests' }, stdio: 'ignore'
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

  const { HALL, STRIKES } = require('../hall-scenarios.js');
  const E = require('../game_engine.js');

  const pages = {};
  for (const p of ['/', '/play', '/host', '/screen?room=ZZZZ']) pages[p] = await text(p);

  check('the hall deck is not in game_engine.js at all', () => {
    const src = fs.readFileSync(path.join(ROOT, 'game_engine.js'), 'utf8');
    for (const s of HALL)
      assert.ok(!src.includes(s.story), `"${s.title}" is still in the engine, which every page inlines`);
    assert.strictEqual(E.SCENARIOS, undefined,
      'game_engine.js still exports SCENARIOS — a caller could silently read the wrong deck');
    assert.ok(E.DRILL, 'the engine lost the classroom drill');
  });

  check('the hall deck is not inlined into any page', () => {
    const tool = fs.readFileSync(path.join(ROOT, 'tools', 'sync-engine.js'), 'utf8');
    assert.ok(!tool.includes('hall-scenarios'),
      'the sync tool knows about hall-scenarios.js — it must never copy it into a page');
  });

  check('no page a device can load carries a hall card', () => {
    for (const [p, body] of Object.entries(pages))
      for (const s of HALL) {
        assert.ok(!body.includes(s.story), `${p} contains the story of "${s.title}"`);
        assert.ok(!body.includes(s.title), `${p} contains the title of "${s.title}"`);
      }
  });

  check('no page carries the choices or their effects either', () => {
    /* Even without a title, the choice labels and their fx would let a student
       work out the best answer to a card before it is dealt. */
    for (const [p, body] of Object.entries(pages))
      for (const s of HALL)
        for (const c of s.choices) {
          assert.ok(!body.includes(c.label), `${p} contains the choice "${c.label}"`);
          assert.ok(!body.includes(c.tag),   `${p} contains the tag "${c.tag}"`);
        }
  });

  check('no page carries a strike\'s title or story either', () => {
    /* Task 11. public/host.html's strike picker (STRIKE_KINDS) only ever
       carries the four keys and an icon of its own — never the titles or
       lines that live in hall-scenarios.js's STRIKES, which arrive on a
       device only after a strike has actually landed, via room.lastStrike.
       Same reasoning as the hall deck above, same page it would leak from. */
    for (const [p, body] of Object.entries(pages))
      for (const s of STRIKES) {
        assert.ok(!body.includes(s.title), `${p} contains the strike title "${s.title}"`);
        assert.ok(!body.includes(s.line), `${p} contains the strike line "${s.line}"`);
      }
  });

  check('no page carries a strike\'s shielding meter either', () => {
    /* The shielding meter is the tactically valuable secret, more so than the
       title or line above: a group that knows a flood shields on Green plays
       a different game, choosing where to spend a scarce turn. Matched as a
       shield:'X' shaped fragment rather than a bare letter, because a bare
       letter would false-positive on every page (it is one of 26). */
    for (const [p, body] of Object.entries(pages))
      for (const s of STRIKES) {
        assert.ok(!new RegExp(`shield\\s*:\\s*['"]${s.shield}['"]`).test(body),
          `${p} leaks which meter shields against ${s.key}`);
      }
  });

  check('the drill IS still on the pages, deliberately', () => {
    /* A teacher runs it, and "Practise offline" applies its effects with no
       server at all — so it has to be there. If this ever fails, somebody moved
       the wrong deck. */
    assert.ok(pages['/'].includes(E.DRILL.story), 'the student app lost the drill card');
    assert.ok(pages['/host'].includes(E.DRILL.title), 'the host console lost the drill card');
  });

  /* --- the card on the wire ------------------------------------------- */
  const hall = await post('/api/host/create', { kind:'hall', key:'a-very-long-hall-passcode-for-tests' });
  const room = await openClassRoom(post, { label:'3E' });
  const a = await post('/api/join', { room:room.room, name:'Alpha', homeland:'delta' });
  await post('/api/team/save', { code:a.code, country:{ name:'Alpha', members:{ leader:'Ana' } } });
  await post('/api/team/commit', { code:a.code });
  await post('/api/host/act', { room:room.room, hostKey:room.hostKey, act:'scenario' });
  const stateOpen = await get('/api/state?code=' + a.code);
  const roomOpen  = await get('/api/room?room=' + room.room);
  await post('/api/host/act', { room:room.room, hostKey:room.hostKey, act:'clear' });
  const stateShut = await get('/api/state?code=' + a.code);

  /* a hall card, to prove the hall path sends the real thing and not the drill */
  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'scenario', key:HALL[2].key });
  const hallRoom = await get('/api/room?room=' + hall.room);

  check('the open card travels with the state', () => {
    assert.ok(stateOpen.card, '/api/state does not carry the open card');
    assert.strictEqual(stateOpen.card.key, E.DRILL.key);
    assert.strictEqual(stateOpen.card.title, E.DRILL.title);
    assert.strictEqual(stateOpen.card.choices.length, 3);
    assert.ok(roomOpen.card, '/api/room does not carry the open card');
  });

  check('a hall sends its own card, not the drill', () => {
    assert.ok(hallRoom.card, '/api/room carries no card for a hall');
    assert.strictEqual(hallRoom.card.key, HALL[2].key);
    assert.strictEqual(hallRoom.card.title, HALL[2].title);
  });

  check('the card on the wire carries no effects', () => {
    /* The whole reason a device may have the open card at all. With fx and coin
       attached, a student in devtools reads off the best answer before the
       cabinet has finished arguing. */
    for (const [name, card] of [['state', stateOpen.card], ['hall room', hallRoom.card]]) {
      const raw = JSON.stringify(card);
      assert.ok(!/"fx"/.test(raw),   `the ${name} card carries fx`);
      assert.ok(!/"coin"/.test(raw), `the ${name} card carries coin`);
      for (const c of card.choices) {
        assert.ok(c.label && c.tag && c.icon, 'a choice lost something the renderer draws');
        assert.strictEqual(c.fx, undefined);
        assert.strictEqual(c.coin, undefined);
      }
    }
  });

  check('no card travels when none is open', () => {
    assert.strictEqual(stateShut.card, null, 'a closed scenario still sends a card');
  });

  /* --- the deck shrinks as it is played ------------------------------- */
  /* A game master throws a card and it leaves the console's list, so nothing
     gets dealt twice by accident in front of the whole cohort. Kept on the
     server, not in the page, so a reload or a resume the next morning does not
     hand back a card the hall has already seen. HALL[2] was thrown above. */
  const deck = (r, k) => get(`/api/host/scenarios?room=${r}&hostKey=${k}`);
  const afterThrow = await deck(hall.room, hall.hostKey);

  check('a thrown card leaves the hall list, and is counted', () => {
    assert.strictEqual(afterThrow.used, 1, 'the deck did not record the card that was thrown');
    assert.strictEqual(afterThrow.cards.length, HALL.length - 1, 'the list is still the whole deck');
    assert.ok(!afterThrow.cards.some(c => c.key === HALL[2].key),
      'the card that was just thrown is still on the list');
  });

  check('the shrunken list still carries titles only', () => {
    const raw = JSON.stringify(afterThrow);
    for (const s of HALL) assert.ok(!raw.includes(s.story), `"${s.title}"'s story reached the console`);
    assert.ok(!/"fx"|"coin"|"choices"/.test(raw), 'the list leaked effects or choices');
  });

  const twice = await post('/api/host/act',
    { room:hall.room, hostKey:hall.hostKey, act:'scenario', key:HALL[2].key });
  check('the same card cannot be thrown a second time', () => {
    assert.ok(twice.error, 'a card already played was dealt again');
    assert.ok(/already been thrown/i.test(twice.error), `unhelpful refusal: ${twice.error}`);
  });

  const classReset = await post('/api/host/act',
    { room:room.room, hostKey:room.hostKey, act:'deckreset' });
  check('a classroom has no deck to reset', () => {
    assert.ok(classReset.error, 'a classroom accepted a deck reset');
    /* Refused on the server, not merely hidden on the console — a hall console
       is projected with its room code on screen. */
    assert.ok(/classroom/i.test(classReset.error), `unhelpful refusal: ${classReset.error}`);
  });

  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'deckreset' });
  const afterReset = await deck(hall.room, hall.hostKey);
  check('resetting the deck brings every card back', () => {
    assert.strictEqual(afterReset.used, 0, 'the reset left cards marked as thrown');
    assert.strictEqual(afterReset.cards.length, HALL.length, 'the reset did not restore the whole deck');
  });

  const reThrow = await post('/api/host/act',
    { room:hall.room, hostKey:hall.hostKey, act:'scenario', key:HALL[2].key });
  check('a card refused before the reset can be thrown after it', () => {
    assert.ok(!reThrow.error, `the reset did not actually free the card: ${reThrow.error}`);
  });

  /* A backup written before any of this existed has no usedScenarios key at
     all. It must come back with a full deck rather than a room that throws on
     the first .includes(). */
  const exported = await get(`/api/host/export?room=${hall.room}&hostKey=${hall.hostKey}`);
  const old = JSON.parse(JSON.stringify(exported.snapshot));
  delete old.usedScenarios;
  const imported = await post('/api/host/import', { snapshot: old });
  const afterImport = imported.error ? null : await deck(imported.room, imported.hostKey);

  check('a backup from before the deck was tracked restores with a full deck', () => {
    assert.ok(!imported.error, `the stripped backup would not import: ${imported.error}`);
    assert.ok(afterImport && !afterImport.error, 'the restored room cannot list its deck at all');
    assert.strictEqual(afterImport.used, 0, 'a room with no record of thrown cards claimed some');
    assert.strictEqual(afterImport.cards.length, HALL.length,
      'an older backup came back with a deck missing cards');
  });

  if (!ran) console.error('FAIL  scenario-secrecy.test.js ran zero checks — the server likely never started');
  if (fails || !ran) return done(1);
  console.log('PASS  scenario secrecy — the hall deck is on the server and nowhere else');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
