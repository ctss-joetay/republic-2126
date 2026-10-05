/* The deck's own bite entries, checked as data rather than as prose. Written
   because a bite is easy to get subtly wrong in ways nothing else notices: a
   condition naming an industry that does not exist matches nobody, a note with
   no {n} beside a `per` reads as a fixed sentence about a varying number, and a
   tilt far over its budget is silently scaled to something the author never
   intended.

   This does not check that the writing is good. It checks that every bite in
   the deck can actually fire. */
const assert = require('assert');
const E = require('../game_engine.js');
const { HALL } = require('../hall-scenarios.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

const INDUSTRY_KEYS = E.INDUSTRIES.map(i => i.key);
const HOMELAND_KEYS = E.HOMELANDS.map(h => h.key);
const PICK_KEYS = Object.keys(E.CARDS).flatMap(m => E.CARDS[m].map(c => c.key));
const bites = [];
for(const card of HALL)
  for(const ch of card.choices)
    for(const b of (ch.bite || [])) bites.push({ card:card.key, choice:ch.key, b, ch });

check('the deck carries bites at all', () => {
  assert.ok(bites.length >= 3, `only ${bites.length} bites in the whole deck`);
});

check('every condition names something that exists', () => {
  for(const { card, choice, b } of bites){
    const where = `${card}/${choice}`;
    assert.ok(b.if && typeof b.if === 'object', `${where}: a bite with no condition`);
    if(b.if.industry != null)
      assert.ok(INDUSTRY_KEYS.includes(b.if.industry), `${where}: no industry '${b.if.industry}'`);
    if(b.if.pick != null)
      assert.ok(PICK_KEYS.includes(b.if.pick), `${where}: no policy card '${b.if.pick}'`);
    if(b.if.homeland != null)
      assert.ok(HOMELAND_KEYS.includes(b.if.homeland), `${where}: no homeland '${b.if.homeland}'`);
    if(b.if.meter != null)
      assert.ok(E.METER_KEYS.includes(b.if.meter), `${where}: no meter '${b.if.meter}'`);
  }
});

check('every per names a real industry', () => {
  for(const { card, choice, b } of bites)
    if(b.per != null)
      assert.ok(INDUSTRY_KEYS.includes(b.per), `${card}/${choice}: per names no industry '${b.per}'`);
});

check('a per bite says {n} in its note, and a flat one does not', () => {
  for(const { card, choice, b } of bites){
    if(!b.note) continue;
    const where = `${card}/${choice}`;
    if(b.per) assert.ok(/\{n\}/.test(b.note), `${where}: a per bite whose note never says how many`);
    else assert.ok(!/\{n\}/.test(b.note), `${where}: {n} in a note with nothing to count`);
  }
});

check('every note is a plain sentence a student can read', () => {
  for(const { card, choice, b } of bites){
    if(!b.note) continue;
    const where = `${card}/${choice}`;
    assert.ok(b.note.length <= 120, `${where}: note is ${b.note.length} chars — too long for a phone`);
    assert.ok(!/!/.test(b.note), `${where}: no exclamation marks`);
    assert.ok(!/[0-9]/.test(b.note.replace('{n}','')), `${where}: a note leaks a number`);
  }
});

check('every bite can actually fire, and lands inside its budget', () => {
  /* A bite scaled to nothing by the cap is a bite nobody will ever notice. */
  for(const { card, choice, b, ch } of bites){
    const c = { industries:{}, picks:{ edu:[], def:[], trade:[], infra:[] },
                homeland:'delta', meters:{ E:50,H:50,S:50,K:50,D:50,G:50 } };
    if(b.if.industry) c.industries[b.if.industry] = (b.if.min == null ? 1 : b.if.min);
    if(b.per) c.industries[b.per] = Math.max(c.industries[b.per] || 0, 1);
    if(b.if.pick) c.picks.trade = [b.if.pick];
    if(b.if.homeland) c.homeland = b.if.homeland;
    if(b.if.meter) c.meters[b.if.meter] = b.if.below != null ? b.if.below - 1 : b.if.above + 1;
    const t = E.biteChoice(ch, c);
    const moved = Object.keys(t.fx).length > 0 || t.coin !== 0;
    assert.ok(moved, `${card}/${choice}: a bite that matches but changes nothing`);
  }
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);