/* A country that never decides on a scenario card used to get off free — and on
   five of the eight cards every option costs coins, so silence was often the
   cheapest play. A government that cannot agree still bears a consequence. */
const assert = require('assert');
const E = require('../game_engine.js');

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

check('the penalty is defined and costs Stability and Harmony', () => {
  assert.ok(E.INDECISION, 'ENGINE.INDECISION is missing');
  assert.ok(E.INDECISION.fx.S < 0, 'indecision must cost Stability');
  assert.ok(E.INDECISION.fx.H < 0, 'indecision must cost Harmony');
  assert.ok(typeof E.INDECISION.note === 'string' && E.INDECISION.note.length,
    'the penalty needs a line the feed can show');
});

check('it costs no coins — the point is the governing, not the money', () => {
  assert.ok(!('coin' in E.INDECISION), 'indecision should not move coins');
});

const worstOf = (deck) => Math.min(...deck.flatMap(s => s.choices.map(c =>
  Object.values(c.fx || {}).reduce((a, b) => a + Math.min(0, b), 0))));

check('it is milder than actually choosing badly', () => {
  /* If ducking the card hurt more than the worst option, groups would be
     pushed into panic-picking rather than deciding.

     The hall deck only. The classroom drill is deliberately NOT held to this:
     indecision is applied by advanceRound(), and a classroom refuses to run
     rounds at all, so a group that ignores the drill pays nothing whatever the
     numbers say. Asserting it over the drill as well looked tidy and was
     simply false — the drill's worst choice is -5 against indecision's -7. */
  const { HALL } = require('../hall-scenarios.js');
  const mine = Object.values(E.INDECISION.fx).reduce((a, b) => a + Math.min(0, b), 0);
  assert.ok(mine > worstOf(HALL),
    `indecision (${mine}) hurts more than the worst hall choice (${worstOf(HALL)})`);
});

check('the drill is gentler than the hall it rehearses', () => {
  /* A rehearsal that swings the meters as hard as the real thing is not a
     rehearsal — and the two decks can now drift apart independently. */
  const { HALL } = require('../hall-scenarios.js');
  const swing = (deck) => Math.max(...deck.flatMap(s => s.choices.flatMap(c =>
    Object.values(c.fx || {}).map(Math.abs))));
  assert.ok(swing([E.DRILL]) < swing(HALL),
    `the drill swings ${swing([E.DRILL])}, the hall swings ${swing(HALL)}`);
});

check('applying it actually moves the meters down', () => {
  const before = { E: 50, H: 50, S: 50, K: 50, D: 50, G: 50 };
  const after = E.applyFx(before, E.INDECISION.fx);
  assert.ok(after.S < before.S, 'Stability did not fall');
  assert.ok(after.H < before.H, 'Harmony did not fall');
  assert.strictEqual(after.K, before.K, 'indecision should not touch Knowledge');
  assert.strictEqual(after.G, before.G, 'indecision should not touch Green');
});

check('a country already on the floor is not driven below it', () => {
  /* nudge() floors at FLOOR; a struggling country should not be ground to
     nothing by repeatedly failing to decide */
  let m = { E: 50, H: 6, S: 6, K: 50, D: 50, G: 50 };
  for (let i = 0; i < 10; i++) m = E.applyFx(m, E.INDECISION.fx);
  assert.ok(m.S >= 6, `Stability fell through the floor to ${m.S}`);
  assert.ok(m.H >= 6, `Harmony fell through the floor to ${m.H}`);
});

if (fails) process.exit(1);
console.log('PASS  indecision — failing to govern has a cost, and a bounded one');
