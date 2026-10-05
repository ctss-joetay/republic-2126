/* The tally is served to the console, which is projected in front of the whole
   cohort. Two guards, both on the server: the host key, and the phase. Hiding
   the button is not a guard — a console tab left open from an earlier phase,
   or a direct call, has to hit the same wall.

   And what comes back must not carry the effects table. The deck's fx and coin
   values have never left the server, and a results screen has no use for them.

   Spawned against a real server: the route's guards are what is being tested,
   and calling the handler directly would skip the routing that applies them. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HALL_PASS = 'K7m2Qx9p';
const PORT = 3971;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-results-'));
const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, HALL_KEY: HALL_PASS }, stdio: 'ignore'
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

(async () => {
  /* the server needs a moment to bind */
  for (let i = 0; i < 40; i++) {
    try { await fetch(base + '/api/room?room=ZZZZ'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
  }

  const room = await post('/api/host/create', { kind: 'hall', key: HALL_PASS, label: 'Hall' });
  assert.ok(!room.error, 'could not open a hall room: ' + room.error);
  const R = { room: room.room, hostKey: room.hostKey };

  await check('a wrong host key is refused', async () => {
    const r = await get('/api/host/results', { room: R.room, hostKey: 'nope' });
    assert.ok(r.error, 'a wrong host key was served the hall\'s decisions');
  });

  await check('prep is refused', async () => {
    const r = await get('/api/host/results', R);
    assert.ok(r.error, 'the tally was served before the game was called');
  });

  await post('/api/host/act', { ...R, act: 'phase', phase: 'game' });

  await check('mid-game is refused', async () => {
    const r = await get('/api/host/results', R);
    assert.ok(r.error, 'the tally was served while the game was still running');
  });

  /* play one card: throw it, then close it by hand */
  const deck = await get('/api/host/scenarios', R);
  const first = deck.cards[0].key;
  await post('/api/host/act', { ...R, act: 'scenario', key: first });
  await post('/api/host/act', { ...R, act: 'clear' });
  await post('/api/host/act', { ...R, act: 'phase', phase: 'final' });

  await check('final is served, and the played card is in it', async () => {
    const r = await get('/api/host/results', R);
    assert.ok(!r.error, 'the tally was refused after the game was called: ' + r.error);
    assert.strictEqual(r.cards.length, 1, 'one card was played and the record does not hold one card');
    assert.strictEqual(r.cards[0].key, first);
  });

  await check('every choice is present, at zero, in deck order', async () => {
    const r = await get('/api/host/results', R);
    const c = r.cards[0];
    assert.strictEqual(c.choices.length, 3, 'a card lost its choices');
    assert.deepStrictEqual(c.choices.map(x => x.key), ['a', 'b', 'c']);
    assert.deepStrictEqual(c.choices.map(x => x.count), [0, 0, 0]);
    assert.ok(c.title && c.icon, 'a card came back without a title to put on the wall');
  });

  await check('the effects table does not come with it', async () => {
    const r = await get('/api/host/results', R);
    const body = JSON.stringify(r);
    assert.ok(!/"fx"/.test(body), 'the meter effects reached the page');
    assert.ok(!/"coin"/.test(body), 'the coin values reached the page');
    assert.ok(!/"story"/.test(body), 'the card stories reached the page');
  });

  await check('an unknown room is refused', async () => {
    const r = await get('/api/host/results', { room: 'ZZZZ', hostKey: R.hostKey });
    assert.ok(r.error);
  });

  /* Next round does NOT clear room.scenario — it only wipes every chosen. So
     the card a hall just finished is still the open card as far as the server
     is concerned, right up until the next one is thrown. Throwing that next
     card must not re-record the finished one as a card nobody answered.

     Found by playing a hall by hand; the unit tests missed it because they
     null room.scenario themselves, which is what act:'clear' does and what
     advanceRound does not. */
  await check('Next round then a new card records two cards, not three', async () => {
    const two = await post('/api/host/create', { kind: 'hall', key: HALL_PASS, label: 'Two' });
    const T = { room: two.room, hostKey: two.hostKey };
    await post('/api/host/act', { ...T, act: 'phase', phase: 'game' });

    const deck = await get('/api/host/scenarios', T);
    await post('/api/host/act', { ...T, act: 'scenario', key: deck.cards[0].key });
    await post('/api/host/act', { ...T, act: 'round' });          // closes card one
    await post('/api/host/act', { ...T, act: 'scenario', key: deck.cards[1].key });
    await post('/api/host/act', { ...T, act: 'round' });          // closes card two
    await post('/api/host/act', { ...T, act: 'phase', phase: 'final' });

    const r = await get('/api/host/results', T);
    assert.deepStrictEqual(r.cards.map(c => c.key), [deck.cards[0].key, deck.cards[1].key],
      'a finished card was recorded a second time when the next one was thrown');
  });

  await check('a card thrown OVER an open one records the one it replaced, once', async () => {
    const three = await post('/api/host/create', { kind: 'hall', key: HALL_PASS, label: 'Three' });
    const T = { room: three.room, hostKey: three.hostKey };
    await post('/api/host/act', { ...T, act: 'phase', phase: 'game' });

    const deck = await get('/api/host/scenarios', T);
    await post('/api/host/act', { ...T, act: 'scenario', key: deck.cards[0].key });
    await post('/api/host/act', { ...T, act: 'scenario', key: deck.cards[1].key });
    await post('/api/host/act', { ...T, act: 'clear' });
    await post('/api/host/act', { ...T, act: 'phase', phase: 'final' });

    const r = await get('/api/host/results', T);
    assert.deepStrictEqual(r.cards.map(c => c.key), [deck.cards[0].key, deck.cards[1].key]);
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  done(fails ? 1 : 0);
})();
