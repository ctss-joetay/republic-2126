/* The same card, landing differently on different countries. A choice may
   declare `bite` entries — a condition, an effect and a sentence — and this is
   the whole of how they are read.

   Two rules carry the design and are worth more than the rest put together:

   The CAP. Meter tilt may never exceed the choice's own meter weight, and coin
   tilt may never exceed |base coin|. That is what keeps this a tilt rather than
   a flip, mechanically instead of by authoring discipline, and it is what
   bounds the spiral that a meters-based condition would otherwise create. A
   struggling country's card gets worse; it never gets ruinous.

   And IGNORING NONSENSE. The deck is hand-edited. A typo in a condition must
   cost a nuance, never take down a hall in front of 300 people. */
const assert = require('assert');
const E = require('../game_engine.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* A country with only the fields biteChoice reads. */
const country = (over) => Object.assign({
  industries: {}, picks: { edu:[], def:[], trade:[], infra:[] },
  homeland: 'delta', meters: { E:50, H:50, S:50, K:50, D:50, G:50 }
}, over || {});

/* A base big enough that the cap never binds unless a test wants it to. */
const choice = (bite, over) => Object.assign({
  key:'a', label:'X', fx:{ E:-40, G:40 }, coin:-40, bite
}, over || {});

/* --- the four conditions --------------------------------------------- */

check('an industry condition matches only at or above its minimum', () => {
  const c = choice([{ if:{industry:'fact', min:2}, fx:{E:-1}, note:'n' }]);
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:1 } })).fx, {});
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:2 } })).fx, { E:-1 });
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:9 } })).fx, { E:-1 });
});

check('a country with nothing built is bitten by nothing', () => {
  const c = choice([{ if:{industry:'fact', min:1}, fx:{E:-5}, note:'n' }]);
  const t = biteOf(c, country());
  assert.deepStrictEqual(t.fx, {});
  assert.strictEqual(t.coin, 0);
  assert.deepStrictEqual(t.notes, []);
});

check('a pick condition finds the card in any ministry', () => {
  const c = choice([{ if:{pick:'strip'}, fx:{E:-3}, note:'n' }]);
  assert.deepStrictEqual(biteOf(c, country()).fx, {}, 'matched a pick nobody took');
  assert.deepStrictEqual(
    biteOf(c, country({ picks:{ edu:[], def:[], trade:['strip'], infra:[] } })).fx, { E:-3 });
  assert.deepStrictEqual(
    biteOf(c, country({ picks:{ edu:['strip'], def:[], trade:[], infra:[] } })).fx, { E:-3 },
    'a pick in a different ministry should still count — the condition names a card, not a ministry');
});

check('a homeland condition matches the dealt homeland', () => {
  const c = choice([{ if:{homeland:'isles'}, fx:{G:3}, note:'n' }]);
  assert.deepStrictEqual(biteOf(c, country()).fx, {});
  assert.deepStrictEqual(biteOf(c, country({ homeland:'isles' })).fx, { G:3 });
});

check('a meter condition reads below and above', () => {
  const lo = choice([{ if:{meter:'G', below:40}, fx:{H:-2}, note:'n' }]);
  assert.deepStrictEqual(biteOf(lo, country()).fx, {}, 'G is 50, which is not below 40');
  assert.deepStrictEqual(biteOf(lo, country({ meters:{ G:39, E:50,H:50,S:50,K:50,D:50 } })).fx, { H:-2 });
  const hi = choice([{ if:{meter:'E', above:70}, fx:{H:-2}, note:'n' }]);
  assert.deepStrictEqual(biteOf(hi, country({ meters:{ E:71, H:50,S:50,K:50,D:50,G:50 } })).fx, { H:-2 });
});

/* --- per, and the note ------------------------------------------------ */

check('per multiplies the effect by how many you own', () => {
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-2}, coin:-3, note:'n' }]);
  const t = biteOf(c, country({ industries:{ fact:3 } }));
  assert.deepStrictEqual(t.fx, { E:-6 });
  assert.strictEqual(t.coin, -9);
});

check('without per the effect applies once, however many you own', () => {
  const c = choice([{ if:{industry:'fact', min:1}, fx:{E:-2}, note:'n' }]);
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:7 } })).fx, { E:-2 });
});

check('{n} is filled with the count', () => {
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-2},
                      note:'You run {n} factories — this lands harder on you.' }]);
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:3 } })).notes,
    ['You run 3 factories — this lands harder on you.']);
});

check('two bites accumulate onto the same meter', () => {
  const c = choice([
    { if:{industry:'fact', min:1}, fx:{E:-2}, note:'a' },
    { if:{homeland:'isles'},       fx:{E:-3}, note:'b' }
  ]);
  assert.deepStrictEqual(
    biteOf(c, country({ industries:{ fact:1 }, homeland:'isles' })).fx, { E:-5 });
});

/* --- nonsense is ignored, never thrown -------------------------------- */

check('a malformed or unknown condition is ignored', () => {
  /* Every one of these is a plausible hand-editing slip. */
  const c = choice([
    { if:{ industry:'nosuch', min:1 }, fx:{E:-9}, note:'n' },
    { if:{ nonsense:'x' },             fx:{E:-9}, note:'n' },
    { if:{},                           fx:{E:-9}, note:'n' },
    { if:null,                         fx:{E:-9}, note:'n' },
    { fx:{E:-9}, note:'n' },
    null
  ]);
  const t = biteOf(c, country({ industries:{ fact:5 } }));
  assert.deepStrictEqual(t.fx, {}, 'a malformed condition was treated as a match');
  assert.deepStrictEqual(t.notes, []);
});

check('a choice with no bite at all is a zero tilt', () => {
  const t = biteOf({ key:'a', fx:{E:-10}, coin:-5 }, country());
  assert.deepStrictEqual(t.fx, {});
  assert.strictEqual(t.coin, 0);
  assert.deepStrictEqual(t.notes, []);
});

check('a country missing the fields it reads does not throw', () => {
  const c = choice([{ if:{industry:'fact', min:1}, fx:{E:-2}, note:'n' }]);
  assert.doesNotThrow(() => biteOf(c, {}));
  assert.doesNotThrow(() => biteOf(c, { industries:null, picks:null, meters:null }));
});

/* --- the cap ---------------------------------------------------------- */

check('a tilt inside the budget passes through untouched', () => {
  /* base meter weight = |-40| + |40| = 80; tilt weight = 6 */
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-2}, note:'n' }]);
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:3 } })).fx, { E:-6 });
});

check('a tilt over the budget is scaled down to it', () => {
  /* base meter weight = |-5| + |5| = 10. Ten factories at -3 each is -30. */
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-3}, note:'n' }],
                   { fx:{ E:-5, G:5 }, coin:-10 });
  const t = biteOf(c, country({ industries:{ fact:10 } }));
  const weight = Object.values(t.fx).reduce((s,v)=>s+Math.abs(v), 0);
  assert.ok(weight <= 10 + 1e-9, `tilt weight ${weight} exceeded the base weight of 10`);
  assert.ok(t.fx.E < 0, 'the cap flipped the direction of the tilt');
});

check('the cap scales every meter proportionally, not just the biggest', () => {
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-3, H:-1}, note:'n' }],
                   { fx:{ E:-4 }, coin:-10 });
  const t = biteOf(c, country({ industries:{ fact:10 } }));
  assert.ok(t.fx.E < 0 && t.fx.H < 0, 'a meter was dropped instead of scaled');
  assert.ok(Math.abs(t.fx.E) > Math.abs(t.fx.H), 'the proportions between meters changed');
});

check('coin tilt is capped at the choice\'s own coin cost', () => {
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', coin:-5, note:'n' }],
                   { fx:{ E:-40 }, coin:-8 });
  const t = biteOf(c, country({ industries:{ fact:10 } }));
  assert.ok(Math.abs(t.coin) <= 8, `coin tilt ${t.coin} exceeded the base cost of 8`);
});

check('a choice with no coin cost never grows one', () => {
  /* A bite intensifies what a card already does. It does not invent a kind of
     consequence the card does not have. */
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', coin:-5, note:'n' }],
                   { fx:{ E:-40 }, coin:0 });
  assert.strictEqual(biteOf(c, country({ industries:{ fact:10 } })).coin, 0);
});

check('a choice with no meter effect never grows one', () => {
  const c = choice([{ if:{industry:'fact', min:1}, fx:{E:-5}, note:'n' }],
                   { fx:{}, coin:-10 });
  assert.deepStrictEqual(biteOf(c, country({ industries:{ fact:2 } })).fx, {});
});

/* --- the notes -------------------------------------------------------- */

check('at most two notes come back, the two that matter most', () => {
  const c = choice([
    { if:{homeland:'delta'},       fx:{E:-1}, note:'small' },
    { if:{industry:'fact', min:1}, fx:{E:-9}, note:'big' },
    { if:{meter:'G', below:60},    fx:{E:-5}, note:'middle' }
  ]);
  const t = biteOf(c, country({ industries:{ fact:1 } }));
  assert.deepStrictEqual(t.notes, ['big', 'middle'],
    'notes should be the two heaviest, heaviest first');
});

check('a bite with no note contributes its effect and no line', () => {
  const c = choice([{ if:{homeland:'delta'}, fx:{E:-2} }]);
  const t = biteOf(c, country());
  assert.deepStrictEqual(t.fx, { E:-2 });
  assert.deepStrictEqual(t.notes, []);
});

check('coin-only bites are ranked too', () => {
  const c = choice([
    { if:{homeland:'delta'},       coin:-9, note:'money' },
    { if:{industry:'fact', min:1}, fx:{E:-1}, note:'meter' }
  ]);
  assert.strictEqual(biteOf(c, country({ industries:{ fact:1 } })).notes[0], 'money');
});

/* --- determinism ------------------------------------------------------ */

check('the same country and choice always give the same tilt', () => {
  const c = choice([{ if:{industry:'fact', min:1}, per:'fact', fx:{E:-2}, coin:-1, note:'n' }]);
  const a = biteOf(c, country({ industries:{ fact:4 } }));
  const b = biteOf(c, country({ industries:{ fact:4 } }));
  assert.deepStrictEqual(a, b);
});

function biteOf(c, ctry){ return E.biteChoice(c, ctry); }

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);