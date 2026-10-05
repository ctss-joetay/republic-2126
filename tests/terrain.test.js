/* The renderer's idea of a homeland must not drift from the engine's. Every
   key in game_engine.js's HOMELANDS needs a form here, or that country
   silently falls back and gets drawn as somebody else's terrain. */
const assert = require('assert');
const { CityView } = require('../city.js');
const E = require('../game_engine.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('every homeland in the engine has a form in the renderer', () => {
  for (const h of E.HOMELANDS)
    assert.ok(CityView.FORM[h.key], `homeland "${h.key}" has no entry in CityView.FORM`);
});

check('every form is one of the three known values', () => {
  for (const k of Object.keys(CityView.FORM))
    assert.ok(['island', 'coast', 'inland'].indexOf(CityView.FORM[k].form) >= 0,
      `"${k}" has form "${CityView.FORM[k].form}"`);
});

check('every inland homeland names a surround, and no other kind does', () => {
  for (const k of Object.keys(CityView.FORM)) {
    const f = CityView.FORM[k];
    if (f.form === 'inland')
      assert.ok(['ridge', 'canopy', 'dune'].indexOf(f.surround) >= 0,
        `inland "${k}" has surround "${f.surround}"`);
    else
      assert.strictEqual(f.surround, undefined, `"${k}" is ${f.form} but names a surround`);
  }
});

check('Green Isles is the only island', () => {
  const islands = Object.keys(CityView.FORM).filter(k => CityView.FORM[k].form === 'island');
  assert.deepStrictEqual(islands, ['isles'],
    'exactly one homeland may be drawn as an island: ' + islands.join(', '));
});

check('an unrecognised homeland falls back the way the engine does', () => {
  /* game_engine's homelandOf() falls back to HOMELANDS[0], which is delta, so
     the renderer must agree — a legacy country must not be drawn as one
     terrain and fed by another. */
  assert.deepStrictEqual(CityView.formOf('nonsense'), CityView.formOf('delta'));
  assert.deepStrictEqual(CityView.formOf(undefined), CityView.formOf('delta'));
});

check('an inland or island form keeps every plot it has today', () => {
  const all = CityView.buildSlots('island').length;
  assert.ok(all > 30, 'expected the full plot list, got ' + all);
  assert.strictEqual(CityView.buildSlots('inland').length, all);
});

check('a coast drops the plots that fall in the water', () => {
  const coast = CityView.buildSlots('coast');
  assert.ok(coast.length < CityView.buildSlots('island').length,
    'a coast must have fewer buildable plots than an island');
  for (const s of coast)
    assert.ok(s.x + s.y <= 11,
      `plot (${s.x},${s.y}) is at depth ${s.x + s.y}, seaward of the buildable limit`);
});

check('every coast plot sits landward of the shoreline with room to spare', () => {
  /* A building is drawn with a half-extent of 0.4 tiles, so its front corner
     reaches x + y + 0.8. Clearing SHORE is not enough: the shoreline band
     wobbles up to amp*(1+rough) = 0.55*1.4 = 0.77 half-tiles landward of it,
     so the front corner has to clear SHORE - 0.77 or the building stands in
     the surf at the wave's highest excursion. */
  for (const s of CityView.buildSlots('coast'))
    assert.ok(s.x + s.y + 0.8 < CityView.SHORE - 0.77,
      `plot (${s.x},${s.y}) reaches depth ${s.x + s.y + 0.8}, into the surf — ` +
      `the shoreline wobbles as far landward as ${CityView.SHORE - 0.77}`);
});

check('a coast still has enough plots for a full country', () => {
  /* _plan lays down 8 civic plots before it places a single industry */
  assert.ok(CityView.buildSlots('coast').length >= 20,
    'too few plots left to lay out a country: ' + CityView.buildSlots('coast').length);
});

check('a seaport stays a seaport where there is a sea', () => {
  assert.strictEqual(CityView.tileFor('port', 'island'), 'port');
  assert.strictEqual(CityView.tileFor('port', 'coast'), 'port');
});

check('a landlocked country draws a depot instead of a harbour', () => {
  assert.strictEqual(CityView.tileFor('port', 'inland'), 'depot');
});

check('nothing else is substituted', () => {
  for (const k of ['home', 'fact', 'mine', 'tech', 'tour', 'care', 'farm', 'green', 'bank'])
    for (const f of ['island', 'coast', 'inland'])
      assert.strictEqual(CityView.tileFor(k, f), k, `${k} was rewritten on ${f}`);
});

check('the depot is a real tile the renderer can draw', () => {
  const K = CityView.KIND.depot;
  assert.ok(K, 'KIND.depot is missing — _plan would place a tile nothing draws');
  assert.ok(typeof K.top === 'string' && typeof K.left === 'string' && typeof K.right === 'string',
    'a depot needs the three box faces every solid tile has');
});

check('every inland surround has bands, painted far to near', () => {
  for (const s of ['ridge', 'canopy', 'dune']) {
    const bands = CityView.surroundBands(s);
    assert.ok(bands.length >= 2, `${s} has only ${bands.length} band(s)`);
    for (let i = 1; i < bands.length; i++)
      assert.ok(bands[i].base > bands[i - 1].base,
        `${s} band ${i} is painted after a nearer one — the far bands must come first`);
  }
});

check('the plain is the last band painted, for every surround', () => {
  /* Bands fill downward. If the nearest ridge is painted last it floods the
     foreground and the plateau reads as floating in water again. */
  for (const s of ['ridge', 'canopy', 'dune']) {
    const bands = CityView.surroundBands(s);
    const last = bands[bands.length - 1];
    assert.ok(last.plain, `the last band of "${s}" is not the plain`);
    assert.strictEqual(bands.filter(b => b.plain).length, 1,
      `"${s}" has more than one plain`);
  }
});

check('an unknown surround still yields a plain rather than nothing', () => {
  const bands = CityView.surroundBands('nonsense');
  assert.ok(bands.length >= 1 && bands[bands.length - 1].plain,
    'a surround the renderer does not know must still paint ground');
});

check('the shoreline sits in front of the civic square, not through it', () => {
  /* the square is the 3x3 block at depths 6..10; water at or before that would
     put the sea in the middle of town */
  assert.ok(CityView.SHORE > 10, 'the shoreline crosses the civic square');
});

check('the shoreline sits inside the drawn grid', () => {
  /* max depth of the 9x9 grid is 16; a shoreline past that is off-screen and
     the map is an island again by accident */
  assert.ok(CityView.SHORE < 16, 'the shoreline falls outside the grid entirely');
});

check('the harbour straddles the shoreline', () => {
  /* Sitting entirely on the land side it reads as an inland lagoon; entirely
     on the water side it is not an inlet at all. It has to cross the line. */
  const seaY = 400, hw = 40, hh = 20;
  const b = CityView.harbourBox(seaY, hw, hh);
  assert.ok(b.cy - b.ry < seaY, 'the harbour does not reach inland past the shoreline');
  assert.ok(b.cy + b.ry > seaY, 'the harbour does not reach the open sea');
});

check('the harbour reaches meaningfully into the land', () => {
  const seaY = 400, hw = 40, hh = 20;
  const b = CityView.harbourBox(seaY, hw, hh);
  assert.ok(seaY - (b.cy - b.ry) > hh * 2,
    'the inlet barely dents the shore — it will not read as a harbour');
});

check('traffic on a coast turns back before the water', () => {
  /* Cars run along road lines 2 and 6 and pedestrians carry a ±0.42 offset, so
     the deepest anything reaches is line + t. _step caps t at
     min(N - 1, LANDWARD - line); line 6 is the worst case. Without the cap a
     car reached depth 14 — past SHORE at 13.4 — and reversed there, so it
     lingered in the surf. */
  assert.ok(CityView.LANDWARD < CityView.SHORE,
    `LANDWARD (${CityView.LANDWARD}) must sit landward of SHORE (${CityView.SHORE})`);
  const deepest = (line) => Math.min(8, CityView.LANDWARD - line) + line;
  for (const line of [2, 6, 6.42, 1.58, 2.42, 5.58])
    assert.ok(deepest(line) <= CityView.LANDWARD,
      `road line ${line} lets traffic reach depth ${deepest(line)}, past LANDWARD ` +
      `at ${CityView.LANDWARD}`);
});

check('an inland ridge is scaled to fit inside the frame it is drawn in', () => {
  /* bandFit exists because the ridge table is tuned in half-tiles while the
     horizon sits only ~3.4 half-tiles below the top of the frame. Unscaled,
     the crests land above y=0 and the snow line derived from them goes with
     them — fillRect(0, 0, W, snowY) with a negative height paints nothing. */
  const SPAN_X = 2 * (9 - 1 + 2 * 1.2);              /* the constants resize() uses */
  const SPAN_Y = 7.0 + (2 * 9 - 1 + 2 * 1.2) + 2.2;
  const BOTTOM = (2 * 9 - 1 + 2 * 1.2) + 2.2;
  const band = CityView.surroundBands('ridge')[0];
  assert.ok(band.snow, 'the farthest ridge band is the one that carries snow');

  for (const [W, H] of [[358, 250], [600, 360], [1016, 360]]) {
    const hw = Math.max(5, Math.min((W * 0.99) / SPAN_X, (H * 0.98) / (SPAN_Y * 0.5)));
    const hh = hw * 0.5;
    const hy = (H * 0.98 - BOTTOM * hh) - 3.4 * hh;   /* iso(-0.5-PAD, -0.5-PAD).y */

    const k = CityView.bandFit(hy - H * 0.06, hh, band);
    const A = hh * band.amp * k;
    const baseY = hy + hh * band.base;
    const crest = baseY - A * (1 + band.rough);
    const snowY = crest + (baseY - crest) * 0.42;

    assert.ok(crest > 0,
      `at ${W}x${H} the ridge crest is at y=${crest.toFixed(2)} — off the top of the frame`);
    assert.ok(snowY > crest && snowY < baseY,
      `at ${W}x${H} the snow line y=${snowY.toFixed(2)} is not between the crest ` +
      `(${crest.toFixed(2)}) and the baseline (${baseY.toFixed(2)})`);
  }
});

check('a country is seeded from its name unless it says otherwise', () => {
  assert.strictEqual(CityView.seedOf({ name:'Kampong Baru' }), 'Kampong Baru');
  assert.strictEqual(CityView.seedOf({ code:'ABC123' }), 'ABC123');
  assert.ok(CityView.seedOf({}), 'a country with nothing at all still needs a seed');
});

check('an explicit seed beats the name', () => {
  /* Two groups in a hall of sixty picking the same country name is not
     unlikely, and without this they draw the identical island. Setting `code`
     cannot fix it — name wins the || chain — so the foreign-city callers set
     `seed` instead. */
  assert.strictEqual(CityView.seedOf({ name:'Republic', seed:'3I4' }), '3I4');
  assert.notStrictEqual(CityView.seedOf({ name:'Republic', seed:'3I4' }),
                        CityView.seedOf({ name:'Republic', seed:'7B2' }));
});

check('a country with no seed field hashes to exactly what it always did', () => {
  /* The risk in introducing seedOf is a silent reseed: if it returns anything
     different for a country that already exists, every island in the game
     quietly relays itself and every student's city changes under them.

     Proven by equivalence rather than by comparing two renders — the render
     harness is not frame-deterministic (building heights lerp up over however
     many frames the capture happened to run), so two PNGs of identical code
     are not byte-identical and a pixel compare would prove nothing. */
  const before = (c) => c.name || c.code || 'republic';       /* the old expression */
  const cases = [
    { name:'Republic', code:'ABC123' }, { name:'Kampong Baru' }, { code:'XYZ789' },
    { name:'', code:'ABC123' }, { name:'', code:'' }, {},
    { name:'Republic', code:'ABC123', pid:'3I4' }             /* pid must NOT win */
  ];
  for (const c of cases)
    assert.strictEqual(CityView.seedOf(c), before(c),
      `seedOf changed the layout seed of ${JSON.stringify(c)}`);
});

check('identity distinguishes two countries and not two polls of one', () => {
  const poll1 = { pid:'3I4', name:'Kampong Baru', meters:{ E:50 } };
  const poll2 = { pid:'3I4', name:'Kampong Baru', meters:{ E:63 } };
  const other = { pid:'7B2', name:'Kampong Baru', meters:{ E:50 } };
  assert.strictEqual(CityView.identityOf(poll1), CityView.identityOf(poll2),
    'the same country two polls apart reads as two different countries — every city would cut every second');
  assert.notStrictEqual(CityView.identityOf(poll1), CityView.identityOf(other),
    'two countries with the same name read as one — the spotlight would morph instead of cut');
  assert.strictEqual(CityView.identityOf(null), null);
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
