/* Spec B §4. Two things are pinned here, and both are about the same danger:
   the number on the tile disagreeing with the number the server applies.

   1. foundingMeters() must not be reachable from the hall path. It rebuilds
      the whole meter set and would erase every scenario effect and every
      round of drift. The pin is structural: the functions are extracted with
      a deps object that simply does not supply foundingMeters, so a source
      that still reaches for it throws. That is stronger than a grep.

   2. lgPreviewHall must agree, to the rounded point, with what server.js's
      growCounts() does. They are two implementations of one rule and this is
      the only thing standing between them and silent drift. */
const assert = require('assert');
const { loadFn } = require('./helpers');
const E = require('../game_engine.js');

let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

/* Deliberately absent from every deps object below: ENGINE.foundingMeters.
   ENGINE is passed with everything EXCEPT that one function. */
const ENGINE = { ...E };
delete ENGINE.foundingMeters;

const METER_KEYS = E.METER_KEYS;
const RES = E.RES;
const METER_INFO = E.METER_INFO;

const lgPreviewHall = loadFn('lgPreviewHall', { ENGINE, METER_KEYS });

check('lgPreviewHall never reaches for foundingMeters', () => {
  const park = E.BUILDINGS.find(b => b.key === 'park');
  const m = { ...E.GAME.startMeters };
  const out = lgPreviewHall(m, park);       // throws if the source calls it
  assert.ok(out.length > 0, 'a park previews no change at all');
});

check('lgPreviewHall agrees with what the server will apply', () => {
  /* growCounts(): fx[m] = def.fx[m] * added * FOUND_SCALE, then applyFx. */
  for (const def of [...E.BUILDINGS, ...E.INDUSTRIES]) {
    if (!def.fx) continue;
    const m = { ...E.GAME.startMeters };
    const fx = {};
    for (const k in def.fx) fx[k] = def.fx[k] * E.FOUND_SCALE;
    const server = E.applyFx(m, fx);
    const client = lgPreviewHall(m, def);
    for (const { k, d } of client) {
      assert.strictEqual(d, Math.round(server[k] - m[k]),
        `${def.key} previews ${k} ${d}, the server applies ${Math.round(server[k] - m[k])}`);
    }
  }
});

check('the coal plant warns about Green before the tap', () => {
  const coal = E.BUILDINGS.find(b => b.key === 'coal');
  const out = lgPreviewHall({ ...E.GAME.startMeters }, coal);
  const green = out.find(x => x.k === 'G');
  assert.ok(green && green.d < 0, 'a hall coal plant previews no Green cost');
});

check('trayModel judges gates against the meters it is GIVEN', () => {
  const C = E.blankCountry();
  C.homeland = 'high';                       // 12 Materials, room to build
  /* trayModel asks lgDefs(kind), a plain module-level function — not the
     LG_KIND table lgDefs itself is built from, which holds arrow functions
     closing over C and over canBuild/canSite and so cannot be eval'd
     standalone. lgDefs is enough on its own for what trayModel needs. */
  const trayModel = loadFn('trayModel', {
    ENGINE, BUILDINGS: E.BUILDINGS, INDUSTRIES: E.INDUSTRIES,
    METER_INFO, RES, C,
    lgDefs: k => (k === 'build' || k === 'hbuild' ? E.BUILDINGS : E.INDUSTRIES)
  });
  const low = trayModel('hind', C, { ...E.GAME.startMeters, K: 30 });
  const high = trayModel('hind', C, { ...E.GAME.startMeters, K: 95 });
  const techLow = low.find(t => t.def.key === 'tech');
  const techHigh = high.find(t => t.def.key === 'tech');
  assert.ok(/Knowledge/.test(techLow.why || ''), 'K30 did not lock the Tech Park');
  assert.ok(!/Knowledge/.test(techHigh.why || ''), 'K95 still locked the Tech Park');
});

/* Intended, not a gap: the hall Build tray (hbuild) is filtered by
   Infrastructure picks exactly like prep's is, because trayModel's
   `raw === BUILDINGS` identity test does not distinguish hbuild from build —
   a building is only ever offered because its policy card was picked, in
   prep or in the hall. Pinned cheaply so nobody "fixes" this into offering
   every building regardless of picks. */
check('the hall Build tray is filtered by Infrastructure picks the same way prep\'s is', () => {
  const C = E.blankCountry();
  C.homeland = 'high';
  C.picks.infra = [];                        // no Infrastructure card picked yet
  const trayModel = loadFn('trayModel', {
    ENGINE, BUILDINGS: E.BUILDINGS, INDUSTRIES: E.INDUSTRIES,
    METER_INFO, RES, C,
    lgDefs: k => (k === 'build' || k === 'hbuild' ? E.BUILDINGS : E.INDUSTRIES)
  });
  const keys = trayModel('hbuild', C, E.GAME.startMeters).map(t => t.def.key);
  assert.deepStrictEqual(keys, ['home'],
    'hbuild listed a building whose Infrastructure card was never picked — only Homes are unconditional');
});

/* Task 4's own two ideas, pinned directly: which kinds are the hall's, and
   what meters each kind is judged against. Neither was reachable through the
   checks above — trayModel and lgPreviewHall both take meters as a plain
   argument, so an inverted lgHall() or an inverted lgMeters() would still
   leave every assertion above green. */

/* A first version of this file pinned the real LG_KIND's hall values by
   matching its raw row text with a regex — the same comment-foolable shape a
   code review later found in build-grid.test.js's can/apply pin: a decoy
   comment naming the wrong value right next to the real assignment reads
   correctly to a text scan while the row itself is wired wrong. That
   version is gone. build-grid.test.js's "LG_KIND wires each land kind to
   its own role check, its own writer and its own defs table" check now
   covers hall too, by actually evaluating the real LG_KIND (loadConst, via
   eval — comments vanish the way they do to any JS parser) rather than
   scanning its text, so it cannot be fooled the same way. Re-pinning hall
   here as well would only reintroduce the same flaw a second time; the
   functional lgHall()/lgMeters() checks below stay, since those pin
   lgHall's/lgMeters' own dispatch logic against a stub table and were never
   text-matching in the first place. */

check('lgHall reads the .hall flag off whichever LG_KIND table it is given', () => {
  const lgHall = loadFn('lgHall', {
    LG_KIND: { build: { hall: false }, ind: { hall: false }, hbuild: { hall: true }, hind: { hall: true } }
  });
  assert.strictEqual(lgHall('build'), false, 'lgHall(\'build\') must be false');
  assert.strictEqual(lgHall('ind'), false, 'lgHall(\'ind\') must be false');
  assert.strictEqual(lgHall('hbuild'), true, 'lgHall(\'hbuild\') must be true');
  assert.strictEqual(lgHall('hind'), true, 'lgHall(\'hind\') must be true');
});

check('lgMeters reads C.meters for a hall kind and rebuilds foundingMeters for a prep kind', () => {
  const meters = { E: 1, H: 2, S: 3, K: 4, D: 5, G: 6 };
  const C = { meters };
  const founding = { E: 9, H: 9, S: 9, K: 9, D: 9, G: 9 };
  let foundingCalls = 0;
  const lgMeters = loadFn('lgMeters', {
    C,
    lgHall: k => k === 'hbuild' || k === 'hind',
    ENGINE: { foundingMeters: c => { foundingCalls++; assert.strictEqual(c, C); return founding; } }
  });
  assert.strictEqual(lgMeters('hbuild'), meters,
    'a hall land must read C.meters directly, not rebuild it');
  assert.strictEqual(foundingCalls, 0, 'foundingMeters must not run for a hall kind');
  assert.strictEqual(lgMeters('build'), founding,
    'a prep land must still rebuild foundingMeters(C)');
  assert.strictEqual(foundingCalls, 1, 'a prep land must call foundingMeters(C) exactly once');
});

/* lgApply's up-only guard is what stops a student demolishing a hall
   building — the server refuses a lower count outright, so an allowed tap
   would only lie about what happened. Pinned functionally against a stub
   LG_KIND: a hall kind's writer must not fire for d<0, a prep kind's must
   still fire, same as it always did (taking a placed tile back is a normal
   part of prep). */
check('lgApply refuses a demolish (d<0) for a hall kind but still allows it for a prep kind', () => {
  const calls = [];
  const LG_KIND = {
    build:  { can: () => true, apply: (...a) => calls.push(['build',  ...a]), hall: false },
    hbuild: { can: () => true, apply: (...a) => calls.push(['hbuild', ...a]), hall: true  }
  };
  const lgApply = loadFn('lgApply', {
    LG_KIND,
    lgHall: k => LG_KIND[k].hall
  });

  lgApply('hbuild', 'key', -1);
  assert.deepStrictEqual(calls, [],
    'lgApply let a demolish through on a hall land — the server refuses this outright, so an allowed tap only lies about what happened');

  lgApply('build', 'key', -1);
  assert.deepStrictEqual(calls, [['build', 'key', -1]],
    'lgApply refused a demolish on a PREP land — taking a placed tile back is ordinary prep behaviour and must still work');
});

check('every land kind is registered for redraw', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  /* landTick() and the resize handler used to carry hardcoded ['build','ind'].
     A kind missing from the shared list draws once and then freezes. */
  assert.ok(!/for\s*\(\s*const kind of \[\s*'build'\s*,\s*'ind'\s*\]/.test(src),
    'a hardcoded [build, ind] list is still there — new kinds will not redraw');
  assert.ok(/const LG_KINDS = Object\.keys\(LG_KIND\)/.test(src),
    'LG_KINDS is not derived from LG_KIND');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
