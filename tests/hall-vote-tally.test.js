/* What the hall decided, per card. The counting rule is the whole of it, and
   it has two edges that are easy to get wrong: a `chosen` left over from an
   EARLIER card must not be counted as an answer to this one, and a country
   that migrated in this round was never asked — advanceRound already excuses
   it from the indecision penalty, so the chart must excuse it too, or the bar
   on the wall accuses countries the game itself let off. */
const assert = require('assert');
const S = require('../server.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* A room shaped like the real thing, with only the fields the tally reads. */
const roomWith = (teams, over) => Object.assign({
  kind: 'hall', scenario: 'haze', round: 2, results: [],
  teams: Object.fromEntries(teams.map((t, i) => [t.pid || 'P' + i,
    Object.assign({ pid: 'P' + i, name: 'C' + i, arrived: 0, chosen: null }, t)]))
}, over || {});

/* A team that answered the open card. */
const chose = (choice, scenario) => ({ chosen: { scenario: scenario || 'haze', choice } });

check('a country that chose is counted under its choice', () => {
  const r = roomWith([chose('a'), chose('a'), chose('c')]);
  const t = S.tallyCard(r);
  assert.deepStrictEqual(t.counts, { a: 2, c: 1 });
  assert.strictEqual(t.key, 'haze');
  assert.strictEqual(t.round, 2);
});

check('a country that did not choose is undecided', () => {
  const t = S.tallyCard(roomWith([chose('a'), {}, {}]));
  assert.deepStrictEqual(t.counts, { a: 1 });
  assert.strictEqual(t.undecided, 2);
});

check('a country that arrived this round is in neither bucket', () => {
  /* advanceRound exempts exactly this country from the indecision penalty.
     It is not undecided — it was never asked. */
  const t = S.tallyCard(roomWith([chose('a'), { arrived: 2 }]));
  assert.deepStrictEqual(t.counts, { a: 1 });
  assert.strictEqual(t.undecided, 0, 'a country that arrived this round was counted as undecided');
  assert.strictEqual(t.total, 1, 'a country that was never asked is in the denominator');
});

check('a country that arrived in an EARLIER round is judged normally', () => {
  const t = S.tallyCard(roomWith([{ arrived: 1 }]));
  assert.strictEqual(t.undecided, 1);
});

check('a decision about an earlier card is counted under neither', () => {
  const t = S.tallyCard(roomWith([chose('a', 'boom'), chose('b')]));
  assert.deepStrictEqual(t.counts, { b: 1 }, 'a stale chosen was counted as an answer to this card');
  assert.strictEqual(t.undecided, 1, 'a country holding a stale chosen did not answer THIS card');
});

check('total is the counts plus the undecided', () => {
  const t = S.tallyCard(roomWith([chose('a'), chose('b'), {}, { arrived: 2 }]));
  assert.strictEqual(t.total, 3);
});

check('no card open means nothing to tally', () => {
  assert.strictEqual(S.tallyCard(roomWith([chose('a')], { scenario: null })), null);
});

check('a classroom is never tallied', () => {
  assert.strictEqual(S.tallyCard(roomWith([chose('a')], { kind: 'class' })), null);
});

check('an empty hall tallies to zeroes, not to null', () => {
  /* A card thrown at a room nobody has joined is still a card that happened. */
  const t = S.tallyCard(roomWith([]));
  assert.deepStrictEqual(t.counts, {});
  assert.strictEqual(t.total, 0);
});

/* --- the record, and when it is written --------------------------------- */

check('closing a card appends one row', () => {
  const r = roomWith([chose('a'), chose('b'), {}]);
  S.closeCard(r);
  assert.strictEqual(r.results.length, 1);
  assert.deepStrictEqual(r.results[0].counts, { a: 1, b: 1 });
  assert.strictEqual(r.results[0].undecided, 1);
});

check('closing twice records one row, not two', () => {
  /* The game master closes the card by hand and then presses Next round.
     Both paths call closeCard; only the first has a card open. */
  const r = roomWith([chose('a')]);
  S.closeCard(r);
  r.scenario = null;            // what act:'clear' does next
  S.closeCard(r);
  assert.strictEqual(r.results.length, 1, 'the same card was recorded twice');
});

check('a classroom drill records nothing', () => {
  const r = roomWith([chose('a')], { kind: 'class' });
  S.closeCard(r);
  assert.deepStrictEqual(r.results, []);
});

check('a room with no results array is not a crash', () => {
  /* A room object from an old backup reaches this before migrateRoom in no
     supported path, but closeCard must not be the thing that throws. */
  const r = roomWith([chose('a')]);
  delete r.results;
  S.closeCard(r);
  assert.strictEqual(r.results.length, 1);
});

/* Dealing a card is pushScenario's job, and it clears scenarioTallied as it
   goes — see closeCard. A fixture that sets room.scenario by hand has to do
   the same or it is describing something the server never does. */
const deal = (r, key, round) => {
  r.scenario = key; r.round = round; r.scenarioTallied = false;
  for(const t of Object.values(r.teams)) t.chosen = null;
};

check('cards are recorded in the order the hall played them', () => {
  const r = roomWith([chose('a')]);
  S.closeCard(r);
  deal(r, 'boom', 3);
  for(const t of Object.values(r.teams)) t.chosen = { scenario: 'boom', choice: 'c' };
  S.closeCard(r);
  assert.deepStrictEqual(r.results.map(x => x.key), ['haze', 'boom']);
});

check('one dealing is one row, however many times it is closed', () => {
  /* advanceRound leaves room.scenario SET — it only wipes chosen. So the
     card a hall just finished is still open when the next one is thrown,
     and without the flag it would be recorded again with nobody on it. */
  const r = roomWith([chose('a'), chose('b')]);
  S.closeCard(r);                                     // Next round
  for(const t of Object.values(r.teams)) t.chosen = null;   // what advanceRound wipes
  S.closeCard(r);                                     // the next card being thrown
  assert.strictEqual(r.results.length, 1, 'a finished card was recorded twice');
  assert.deepStrictEqual(r.results[0].counts, { a: 1, b: 1 }, 'the second close overwrote the real counts');
});

check('the same card dealt again is a second row, not a duplicate', () => {
  /* Only possible after a deck reset, and it is the honest record: the hall
     answered that card twice. This is why the guard is a per-dealing flag
     and not a check against the last row's key. */
  const r = roomWith([chose('a')]);
  S.closeCard(r);
  deal(r, 'haze', 4);
  for(const t of Object.values(r.teams)) t.chosen = { scenario: 'haze', choice: 'c' };
  S.closeCard(r);
  assert.deepStrictEqual(r.results.map(x => x.key), ['haze', 'haze']);
  assert.deepStrictEqual(r.results.map(x => x.counts), [{ a: 1 }, { c: 1 }]);
});

check('a new room opens with an empty record', () => {
  const room = S.newRoom({ kind: 'hall' });
  assert.deepStrictEqual(room.results, [], 'a new room did not open with a results array');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
