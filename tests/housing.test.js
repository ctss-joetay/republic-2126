/* Housing is what makes a workforce usable. These pin the arithmetic and the
   card->building wiring; tests/balance.test.js pins that the resulting economy
   is playable. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../game_engine.js');

/* The city renderer is a browser IIFE with no exports, so its tables are read
   out of the source rather than imported — and out of public/index.html, which
   is the copy that actually runs. city.js is a master that nothing loads;
   tests/engine-sync.test.js is what keeps the two identical. */
const CITY = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const cityTable = (name, re) => {
  const m = new RegExp('^const ' + name + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\};', 'm').exec(CITY);
  if (!m) throw new Error('could not find const ' + name + ' in city.js');
  return [...m[1].matchAll(re)].map(x => x.slice(1));
};

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

check('every building except Homes names a real Infrastructure card', () => {
  const cardKeys = E.CARDS.infra.map(c => c.key);
  const always = E.BUILDINGS.filter(b => !b.card);
  assert.strictEqual(always.length, 1, 'exactly one building must be always-available');
  assert.strictEqual(always[0].key, 'home', 'the always-available building must be Homes');
  for (const b of E.BUILDINGS.filter(x => x.card)) {
    assert.ok(cardKeys.includes(b.card),
      `building ${b.key} names card "${b.card}", which is not in CARDS.infra`);
  }
});

check('a fresh country houses about half its workforce', () => {
  for (const h of E.HOMELANDS) {
    const c = E.blankCountry(); c.homeland = h.key;
    const base = E.housed(c);
    assert.strictEqual(base, Math.ceil(h.res.W / 2),
      `${h.name}: base housed ${base}, expected ceil(${h.res.W}/2)`);
    assert.ok(base < h.res.W, `${h.name}: nothing is left to unlock`);
  }
});

check('buildings raise the housed count', () => {
  const c = E.blankCountry(); c.homeland = 'high';      // W6, base 3
  c.buildings = { home: 1 };                             // +2
  assert.strictEqual(E.housed(c), 5);
});

check('housed never exceeds the workforce that exists', () => {
  const c = E.blankCountry(); c.homeland = 'high';       // W6
  c.buildings = { home: 9 };                             // absurdly over-built
  assert.strictEqual(E.housed(c), 6, 'housing more people than the country has');
});

check('blankCountry starts with an empty buildings map', () => {
  assert.deepStrictEqual(E.blankCountry().buildings, {});
});

check('industries can only employ housed workers', () => {
  const c = E.blankCountry(); c.homeland = 'port';      // W12, base housed 6
  c.industries = { fact: 2 };                           // 2 factories = 6 workers
  assert.strictEqual(E.free(c).W, 0, 'all housed workers should be employed');
  c.industries = { fact: 3 };                           // 9 workers, only 6 housed
  assert.ok(E.free(c).W < 0, 'employing more workers than are housed must go negative');
});

check('buildings consume Materials and Food', () => {
  const c = E.blankCountry(); c.homeland = 'high';      // M12 F4
  const before = E.free(c);
  c.buildings = { home: 2 };                            // M4 F4
  const after = E.free(c);
  assert.strictEqual(before.M - after.M, 4, 'Materials not charged for homes');
  assert.strictEqual(before.F - after.F, 4, 'Food not charged for homes');
});

check('a building that houses people raises free workers', () => {
  const c = E.blankCountry(); c.homeland = 'high';      // W6, base 3
  const before = E.free(c).W;
  c.buildings = { home: 1 };                            // +2 housed
  assert.strictEqual(E.free(c).W - before, 2, 'housing did not free up workers');
});

check('building effects reach the meters', () => {
  const a = E.blankCountry(); a.homeland = 'high';
  const b = E.blankCountry(); b.homeland = 'high';
  b.buildings = { coal: 3 };
  assert.ok(E.foundingMeters(b).G < E.foundingMeters(a).G,
    'three coal plants did not cost any Green');
  const s = E.blankCountry(); s.homeland = 'high'; s.buildings = { solar: 2 };
  assert.ok(E.foundingMeters(s).G > E.foundingMeters(a).G,
    'solar farms did not raise Green');
});

check('the city draws a tile per building actually built', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  c.picks.infra = ['mixed'];
  const estates = x => E.cityPlan(x).tiles.filter(t => t.icon === '🏘️').length;
  const noneBuilt = estates(c);
  c.buildings = { estate: 3 };
  const built = estates(c);
  assert.ok(built > noneBuilt, 'building three estates drew no more tiles than building none');
  assert.ok(built >= 3, `expected at least 3 estate tiles, drew ${built}`);
});

/* The engine's cityPlan() is not what the island is drawn from — city.js has
   its own _plan(). These pin the table that one reads, because a building
   added to BUILDINGS and forgotten there would simply never appear. */
check('city.js draws a tile for every building the engine defines', () => {
  const buildTile = new Map(cityTable('BUILD_TILE', /(\w+)\s*:\s*'(\w+)'/g));
  const kinds = new Set(cityTable('KIND', /^\s*(\w+)\s*:\s*\{/gm).map(x => x[0]));
  for (const b of E.BUILDINGS) {
    assert.ok(buildTile.has(b.key), `city.js BUILD_TILE has no tile for building "${b.key}"`);
    assert.ok(kinds.has(buildTile.get(b.key)),
      `building "${b.key}" maps to tile "${buildTile.get(b.key)}", which city.js cannot draw`);
  }
  assert.strictEqual(buildTile.size, E.BUILDINGS.length,
    'BUILD_TILE names a building the engine does not define');
});

check('a built island is bigger than an unbuilt one', () => {
  /* the padding used to fill the island to twelve homes regardless, so this
     asserts the stand-in is small enough for real building to show */
  const filler = /\n\s*push\('home', (\d+)\);/.exec(CITY);
  assert.ok(filler, 'city.js no longer pads the island with stand-in homes');
  assert.ok(Number(filler[1]) < 12,
    `stand-in homes (${filler[1]}) still fill the island, so building nothing looks the same as building a lot`);
});

if (fails) process.exit(1);
console.log('PASS  housing — arithmetic and unlock wiring hold');
