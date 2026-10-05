/* Two properties the infrastructure design rests on. Both were measured before
   the feature was written, and a careless cost change would quietly break
   either one — so they are pinned rather than trusted.

   1. No dead ends: a group that spends NOTHING on Infrastructure must still
      reach a playable country. Homes are always available and Farms cost no
      Materials or Food, so there is always something to do.
   2. Trade pressure: River Delta and Dry Plains must remain complements — one
      short of Materials with Food to spare, the other the reverse. That is what
      makes trading two-sided, which is the whole point of the feature. */
const assert = require('assert');
const E = require('../game_engine.js');

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

/* Greedy self-sufficient play: house who you can with the cheapest capacity
   per worker, then staff the best ungated industries you can afford. */
function playGreedy(homelandKey, unlockedCards) {
  const c = E.blankCountry();
  c.homeland = homelandKey;
  c.picks = { edu: [], def: [], trade: [], infra: unlockedCards.slice() };
  const avail = E.BUILDINGS.filter(b => !b.card || unlockedCards.includes(b.card))
                           .filter(b => b.housed > 0);
  for (let guard = 0; guard < 40; guard++) {
    if (E.housed(c) >= E.pool(c).W) break;
    const f = E.free(c);
    const opts = avail.filter(b => (b.need.M || 0) <= f.M && (b.need.F || 0) <= f.F)
                      .sort((a, b) => ((a.need.M + a.need.F) / a.housed) - ((b.need.M + b.need.F) / b.housed));
    if (!opts.length) break;
    const b = opts[0];
    c.buildings[b.key] = (c.buildings[b.key] || 0) + 1;
  }
  const inds = E.INDUSTRIES.filter(i => !i.req).sort((a, b) => (b.out.coin || 0) - (a.out.coin || 0));
  let sites = 0;
  for (let guard = 0; guard < 40; guard++) {
    const f = E.free(c);
    const pick = inds.find(i => i.need.W <= f.W && i.need.M <= f.M && i.need.F <= f.F);
    if (!pick) break;
    c.industries[pick.key] = (c.industries[pick.key] || 0) + 1;
    sites++;
  }
  c.meters = E.foundingMeters(c);
  return { country: c, sites, housed: E.housed(c), workforce: E.pool(c).W, income: E.roundIncome(c) };
}

check('no homeland is a dead end without any Infrastructure card', () => {
  for (const h of E.HOMELANDS) {
    const r = playGreedy(h.key, []);
    assert.ok(r.sites >= 2, `${h.name}: only ${r.sites} industry site(s) with no infra card`);
    assert.ok(r.income.gross > 0, `${h.name}: earns nothing`);
    assert.ok(r.housed > Math.ceil(h.res.W / 2) || h.res.M < 2 || h.res.F < 2,
      `${h.name}: could not house a single extra worker despite having the resources`);
  }
});

check('an Infrastructure card is worth having', () => {
  for (const h of E.HOMELANDS) {
    const without = playGreedy(h.key, []);
    const withCard = playGreedy(h.key, ['mixed']);
    assert.ok(withCard.housed >= without.housed,
      `${h.name}: the estate card made housing worse (${withCard.housed} vs ${without.housed})`);
  }
});

check('nobody can ever employ more workers than they house', () => {
  for (const h of E.HOMELANDS) {
    const r = playGreedy(h.key, ['mixed', 'mrt', 'coal']);
    assert.ok(E.free(r.country).W >= 0,
      `${h.name}: greedy play overcommitted workers (free ${E.free(r.country).W})`);
    assert.ok(r.housed <= r.workforce, `${h.name}: housed more people than exist`);
  }
});

/* The design's central claim. Housing the WHOLE workforce with basic Homes
   should leave Delta short of Materials and Dry Plains short of Food. */
function costToHouseAll(homelandKey) {
  const h = E.HOMELANDS.find(x => x.key === homelandKey);
  const home = E.BUILDINGS.find(b => b.key === 'home');
  const base = Math.ceil(h.res.W / 2);
  const homes = Math.ceil((h.res.W - base) / home.housed);
  return { M: h.res.M - homes * home.need.M, F: h.res.F - homes * home.need.F };
}

check('River Delta and Dry Plains stay trading complements', () => {
  const delta = costToHouseAll('delta');
  const dry = costToHouseAll('dry');
  assert.ok(delta.M < 0, `River Delta should be short of Materials, has ${delta.M} spare`);
  assert.ok(delta.F > 0, `River Delta should have Food to spare, has ${delta.F}`);
  assert.ok(dry.F < 0, `Dry Plains should be short of Food, has ${dry.F} spare`);
  assert.ok(dry.M > 0, `Dry Plains should have Materials to spare, has ${dry.M}`);
});

// Spec D. roundIncome gained a workerPull factor. The claim made in its
// comment — and in the spec — is that it can only ever be 1 for a country
// that has never been struck, because every path that could push free().W
// negative already refuses to. A claim like that is worth a test, not a
// comment: if some future route stops clamping on free(), this goes red
// and names the reason.
//
// The check has to stand at the boundary to mean anything: a fixture with
// worker headroom to spare would keep passing even if a route stopped
// clamping. playGreedy() with every housing card unlocked already drives a
// country to near-maximal legitimate worker commitment for the OTHER check
// above ('nobody can ever employ more workers than they house') — reused
// here rather than hand-built, so usedW sits right up against housed(c).
check('workerPull is exactly 1 at maximal legitimate worker commitment', () => {
  for (const h of E.HOMELANDS) {
    const r = playGreedy(h.key, ['mixed', 'mrt', 'coal']);
    const pull = E.roundIncome(r.country).workerPull;
    assert.strictEqual(pull, 1,
      `${h.key}: workerPull is ${pull}, not 1, at legitimate max commitment — ` +
      `some route is letting free().W go negative without this change noticing`);
  }
});

if (fails) process.exit(1);
console.log('PASS  balance — no dead ends, and trade stays two-sided');
