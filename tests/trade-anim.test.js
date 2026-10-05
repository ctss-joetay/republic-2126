/* An accepted trade plays an animation on the country's own city. The rule for
   WHICH offer does that is the whole of it, and it is easy to get wrong in two
   directions: replaying every old deal on every page load, or missing the deal
   the student just closed. Pulled out of the shipped page, not a copy of it. */
const assert = require('assert');
const { loadFn } = require('./helpers');

const newlyAccepted = loadFn('newlyAccepted');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

const off = (id, status, from, to) => ({ id, status, from, to,
  give:{W:0,M:1,F:0}, want:{W:0,M:0,F:1}, coins:0 });

check('an offer that just flipped to accepted plays', () => {
  const prev = [off('a', 'pending', 'P1', 'P2')];
  const next = [off('a', 'accepted', 'P1', 'P2')];
  assert.deepStrictEqual(newlyAccepted(prev, next, 'P2').map(o => o.id), ['a']);
  assert.deepStrictEqual(newlyAccepted(prev, next, 'P1').map(o => o.id), ['a'],
    'the country that SENT the offer does not see its own deal arrive');
});

check('an offer that was already accepted does not replay', () => {
  const prev = [off('a', 'accepted', 'P1', 'P2')];
  const next = [off('a', 'accepted', 'P1', 'P2')];
  assert.deepStrictEqual(newlyAccepted(prev, next, 'P2'), []);
});

check('an offer first SEEN as accepted does not replay', () => {
  /* the first poll after a reload carries every past deal at once. Without
     this, opening the app replays an afternoon of trading. */
  assert.deepStrictEqual(newlyAccepted([], [off('a', 'accepted', 'P1', 'P2')], 'P2'), []);
  assert.deepStrictEqual(newlyAccepted(null, [off('a', 'accepted', 'P1', 'P2')], 'P2'), []);
});

check('declined and pending offers never play', () => {
  const prev = [off('a', 'pending', 'P1', 'P2'), off('b', 'pending', 'P1', 'P2')];
  const next = [off('a', 'declined', 'P1', 'P2'), off('b', 'pending', 'P1', 'P2')];
  assert.deepStrictEqual(newlyAccepted(prev, next, 'P2'), []);
});

check('somebody else\'s deal does not dock at our city', () => {
  const prev = [off('a', 'pending', 'P3', 'P4')];
  const next = [off('a', 'accepted', 'P3', 'P4')];
  assert.deepStrictEqual(newlyAccepted(prev, next, 'P2'), []);
});

check('two deals closing in one poll both come back', () => {
  const prev = [off('a', 'pending', 'P1', 'P2'), off('b', 'pending', 'P2', 'P5')];
  const next = [off('a', 'accepted', 'P1', 'P2'), off('b', 'accepted', 'P2', 'P5')];
  assert.strictEqual(newlyAccepted(prev, next, 'P2').length, 2);
});

check('a missing offer list is not a crash', () => {
  assert.deepStrictEqual(newlyAccepted(undefined, undefined, 'P2'), []);
  assert.deepStrictEqual(newlyAccepted([off('a','pending','P1','P2')], null, 'P2'), []);
});

/* --- what actually reaches the canvas ---------------------------------- */

/* playTrade decides which half of the offer arrives and which half leaves,
   and the two are trivially easy to swap. Getting it backwards shows a group
   its own goods being delivered TO it, which is the opposite of the lesson. */
function harness(pid, running) {
  const calls = [];
  const view = { _raf: running ? 1 : null, deliver: (i, o, c) => calls.push({ i, o, c }) };
  const playTrade = loadFn('playTrade', {
    S: { pid }, CITY_VIEWS: { cityBox: view }
  });
  return { playTrade, calls };
}

check('the country that accepted receives what the sender offered to give', () => {
  const h = harness('P2', true);
  h.playTrade({ from:'P1', to:'P2', give:{W:0,M:2,F:0}, want:{W:0,M:0,F:3}, coins:5 });
  assert.strictEqual(h.calls.length, 1, 'nothing reached the canvas');
  assert.deepStrictEqual(h.calls[0].i, {W:0,M:2,F:0}, 'the wrong half of the deal arrived');
  assert.deepStrictEqual(h.calls[0].o, {W:0,M:0,F:3}, 'the wrong half of the deal left');
  assert.strictEqual(h.calls[0].c, 5);
});

check('the country that sent the offer receives what it asked for', () => {
  /* same offer, other side of it — everything is mirrored */
  const h = harness('P1', true);
  h.playTrade({ from:'P1', to:'P2', give:{W:0,M:2,F:0}, want:{W:0,M:0,F:3}, coins:5 });
  assert.deepStrictEqual(h.calls[0].i, {W:0,M:0,F:3}, 'the sender was delivered its own goods');
  assert.deepStrictEqual(h.calls[0].o, {W:0,M:2,F:0});
});

check('a city nobody is looking at is not animated', () => {
  /* renderCity stops every view except the visible one; animating a stopped
     canvas burns the delivery before anyone sees it */
  const h = harness('P2', false);
  h.playTrade({ from:'P1', to:'P2', give:{W:1,M:0,F:0}, want:{}, coins:0 });
  assert.strictEqual(h.calls.length, 0, 'a stopped city view was sent a delivery');
});

check('a deal with no coins still animates', () => {
  const h = harness('P2', true);
  h.playTrade({ from:'P1', to:'P2', give:{W:1,M:0,F:0}, want:{W:0,M:1,F:0} });
  assert.strictEqual(h.calls[0].c, 0, 'a missing coin field is not zero');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
