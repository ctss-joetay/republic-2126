/* The land grid is a view over rules that already exist: a plot is one unit of
   C.buildings / C.industries, and placing one calls build() or site(). These pin
   the derivation, the gating and the preview. The DOM is exercised only through a
   hand-rolled stub — there is no jsdom in a zero-dependency repo — so everything
   worth trusting here is written to be callable without a browser. */
const assert = require('assert');
const fs = require('fs');
const { loadFn, extractFn, loadConst, APP } = require('./helpers');
const E = require('../game_engine.js');

let fails = 0;
/* Deliberately synchronous. check() does not await its callback, so an async
   callback returns a promise nobody looks at and its assertions can never fail.
   Do not write one. */
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

const landCells = loadFn('landCells');

check('one plot per unit built, in table order', () => {
  const cells = landCells({ home: 3, coal: 1 }, E.BUILDINGS);
  assert.strictEqual(cells.length, 4, 'three homes and a coal plant should fill four plots');
  assert.deepStrictEqual(cells.map(d => d.key), ['home', 'home', 'home', 'coal']);
});

check('clearing one of three homes leaves two plots', () => {
  assert.strictEqual(landCells({ home: 2 }, E.BUILDINGS).length, 2);
});

check('an empty country fills no plots', () => {
  assert.strictEqual(landCells({}, E.BUILDINGS).length, 0);
});

check('a key the tables do not define fills no plots', () => {
  assert.strictEqual(landCells({ notAThing: 5 }, E.BUILDINGS).length, 0,
    'an unknown key drew a plot the country cannot own');
});

check('industries derive the same way buildings do', () => {
  const cells = landCells({ farm: 2, mine: 1 }, E.INDUSTRIES);
  assert.deepStrictEqual(cells.map(d => d.key), ['farm', 'farm', 'mine']);
});

const peopleCount = loadFn('peopleCount', { ENGINE: E });

check('homeless is workers minus housed', () => {
  const c = E.blankCountry(); c.homeland = 'port';    // W12, base housed 6
  const p = peopleCount(c);
  assert.strictEqual(p.workers, 12);
  assert.strictEqual(p.housed, 6);
  assert.strictEqual(p.homeless, 6, 'homeless must be workers − housed');
  assert.strictEqual(p.atWork, 0, 'nothing is staffed yet');
  assert.strictEqual(p.stalled, 0);
});

check('at work counts the workers industries actually demand', () => {
  const c = E.blankCountry(); c.homeland = 'port';    // housed 6
  c.industries = { fact: 2 };                         // 2 sites x W3 = 6
  const p = peopleCount(c);
  assert.strictEqual(p.atWork, 6);
  assert.strictEqual(p.stalled, 0, 'six housed workers can staff six jobs');
});

check('the stall warning fires when industry demand outruns housing', () => {
  const c = E.blankCountry(); c.homeland = 'port';    // housed 6
  c.industries = { fact: 3 };                         // 9 workers wanted
  assert.ok(E.free(c).W < 0, 'test setup no longer over-staffs the country');
  const p = peopleCount(c);
  assert.strictEqual(p.atWork, 9);
  assert.strictEqual(p.stalled, 3, 'three sites have nobody housed to run them');
});

check('housing everyone clears the homeless count', () => {
  const c = E.blankCountry(); c.homeland = 'high';    // W6, base housed 3
  c.buildings = { home: 2 };                          // +4, capped at 6
  const p = peopleCount(c);
  assert.strictEqual(p.housed, 6);
  assert.strictEqual(p.homeless, 0, 'over-building homes must not go negative');
});

/* Shared by trayModel and lgPreview below — both now ask lgDefs(kind) rather
   than a `kind === 'build'` ternary of their own, matching lgPreviewPrep's
   established `lgDefs(kind) === BUILDINGS` pattern in the shipped file. */
const lgDefsForKind = k => ((k === 'build' || k === 'hbuild') ? E.BUILDINGS : E.INDUSTRIES);

const trayModelRaw = loadFn('trayModel', {
  ENGINE: E, BUILDINGS: E.BUILDINGS, INDUSTRIES: E.INDUSTRIES,
  METER_INFO: E.METER_INFO, RES: E.RES, lgDefs: lgDefsForKind
});
/* Task 4: trayModel now takes the meters it judges gates against as a
   parameter instead of computing them itself, because the answer differs
   between prep and the hall. Every check below is a prep check, and prep
   always judged against foundingMeters(c) — this thin wrapper supplies that
   when a caller here omits the third argument, so every assertion below is
   unchanged. */
const trayModel = (kind, c, meters) =>
  trayModelRaw(kind, c, meters !== undefined ? meters : E.foundingMeters(c));

check('a building whose Infrastructure card was not picked is not in the tray at all', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  c.picks.infra = [];
  const keys = trayModel('build', c).map(t => t.def.key);
  assert.deepStrictEqual(keys, ['home'], 'only Homes are unconditional');
});

check('picking the card puts the building in the tray', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  c.picks.infra = ['mixed'];
  const keys = trayModel('build', c).map(t => t.def.key);
  assert.ok(keys.includes('estate'), 'Mixed housing estates did not unlock the Housing estate');
  assert.ok(!keys.includes('coal'), 'a card nobody picked still unlocked the Coal plant');
});

check('a locked industry states the gap it has to close', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  assert.strictEqual(Math.round(E.foundingMeters(c).G), 50, 'test setup no longer leaves Tourism locked');
  const t = trayModel('ind', c).find(x => x.def.key === 'tour');
  assert.strictEqual(t.why, 'Needs Green 55 — you have 50');
});

check('an industry whose gate is met is offered without a reason', () => {
  const c = E.blankCountry(); c.homeland = 'high';    // W6 M12 F4 — farms are affordable
  const t = trayModel('ind', c).find(x => x.def.key === 'farm');
  assert.strictEqual(t.why, null, `Farms should be offered outright, got ${JSON.stringify(t.why)}`);
});

check('a tile the country cannot pay for says what it is short of', () => {
  const c = E.blankCountry(); c.homeland = 'delta';   // M3 F11
  c.buildings = { home: 1 };                          // M2 spent, 1 left
  assert.strictEqual(E.free(c).M, 1, 'test setup no longer leaves the country a Material short');
  const t = trayModel('build', c).find(x => x.def.key === 'home');
  assert.strictEqual(t.why, 'Not enough Materials');
});

check('a building is never called short of workers', () => {
  const c = E.blankCountry(); c.homeland = 'port';
  c.industries = { fact: 3 };                         // free workers go negative
  assert.ok(E.free(c).W < 0, 'test setup no longer over-staffs the country');
  const t = trayModel('build', c).find(x => x.def.key === 'home');
  assert.ok(!/Workers/.test(t.why || ''),
    `a home was refused for lack of workers, which buildings do not cost — got ${JSON.stringify(t.why)}`);
});

/* Task 4: lgPreview is now a dispatcher over lgDefs/lgHall/lgPreviewPrep/
   lgPreviewHall. Every check below stays on the prep path (lgHall always
   false here), so lgPreviewHall is never reached and does not need a stub —
   the ternary that would call it is never evaluated. lgPreviewPrep is loaded
   standalone, exactly the old lgPreview body under a new name. */
const lgPreview = loadFn('lgPreview', {
  ENGINE: E, METER_KEYS: E.METER_KEYS,
  lgDefs: lgDefsForKind,
  lgHall: () => false,
  lgPreviewPrep: loadFn('lgPreviewPrep', {
    ENGINE: E, METER_KEYS: E.METER_KEYS, BUILDINGS: E.BUILDINGS,
    lgDefs: lgDefsForKind
  })
});

check('the preview reports what a coal plant would cost in Green', () => {
  const c = E.blankCountry(); c.homeland = 'high'; c.picks.infra = ['coal'];
  const g = lgPreview(c, 'build', 'coal').find(x => x.k === 'G');
  assert.ok(g, 'a coal plant previewed no pillar change at all');
  assert.strictEqual(g.d, -4, 'the preview must be the engine\'s own arithmetic, diminishing returns included');
});

check('the preview reports what an industry would do', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  const g = lgPreview(c, 'ind', 'mine').find(x => x.k === 'G');
  assert.ok(g && g.d === -4, `a mine should cost 4 Green, preview said ${g && g.d}`);
});

check('the preview never touches the country it is previewing', () => {
  const c = E.blankCountry(); c.homeland = 'high'; c.picks.infra = ['coal'];
  lgPreview(c, 'build', 'coal');
  lgPreview(c, 'ind', 'mine');
  assert.deepStrictEqual(c.buildings, {}, 'the preview built the building for real');
  assert.deepStrictEqual(c.industries, {}, 'the preview opened the site for real');
});

check('a tile that moves no pillar previews nothing', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  assert.deepStrictEqual(lgPreview(c, 'build', 'home'), [],
    'Homes have no fx, so an empty preview is the honest answer');
});

const lgMoved = loadFn('lgMoved');

check('a press that barely moved is a tap, not a drag', () => {
  assert.strictEqual(lgMoved(100, 100, 100, 100), false, 'no movement at all is a tap');
  assert.strictEqual(lgMoved(100, 100, 105, 100), false, '5px is a tap');
  assert.strictEqual(lgMoved(100, 100, 104, 104), false, '5.7px diagonal is still a tap');
  assert.strictEqual(lgMoved(100, 100, 92, 100), false, '8px exactly is still a tap');
});

check('a real drag is not mistaken for a tap', () => {
  assert.strictEqual(lgMoved(100, 100, 140, 100), true, '40px is a drag');
  assert.strictEqual(lgMoved(100, 100, 100, 60), true, 'upward drags count too');
  assert.strictEqual(lgMoved(100, 100, 109, 100), true, '9px is over the threshold');
});

const SRC = fs.readFileSync(APP, 'utf8');
const pane = (open, close) => {
  const m = new RegExp(open + '([\\s\\S]*?)' + close).exec(SRC);
  assert.ok(m, 'could not find the pane between ' + open + ' and ' + close);
  return m[1];
};

check('the Build pane holds the land, the tray and everything it held before', () => {
  const p5 = pane('<!-- 5 build -->', '<!-- 6 industries -->');
  for(const id of ['buildResRow','housedCount','buildNote','buildTrade','btGive','btWant',
                   'bt_to','btWho','btOffers','buildLand','buildTiles','buildSay','buildPeople']){
    assert.ok(p5.includes(`id="${id}"`), `the Build pane lost #${id}`);
  }
  assert.ok(!p5.includes('id="buildGrid"'), 'the old stepper grid is still in the Build pane');
});

check('the Industry pane holds the land and the tray', () => {
  const p6 = pane('<!-- 6 industries -->', '<!-- 7 review -->');
  for(const id of ['resRow','homeName','housedNote','indLand','indTiles','indSay','indPeople']){
    assert.ok(p6.includes(`id="${id}"`), `the Industry pane lost #${id}`);
  }
  assert.ok(!p6.includes('id="indGrid"'), 'the old stepper grid is still in the Industry pane');
});

check('the drag ghost exists once, outside both panes', () => {
  assert.strictEqual((SRC.match(/id="lgGhost"/g) || []).length, 1,
    'there must be exactly one #lgGhost, shared by both steps');
  const p5 = pane('<!-- 5 build -->', '<!-- 6 industries -->');
  const p6 = pane('<!-- 6 industries -->', '<!-- 7 review -->');
  assert.ok(!p5.includes('id="lgGhost"'), '#lgGhost must not live inside the Build pane');
  assert.ok(!p6.includes('id="lgGhost"'), '#lgGhost must not live inside the Industry pane');
});

/* This check used to demand touch-action:none on BOTH, on the theory that a
   drag across a plot would otherwise scroll the page. That is not how
   touch-action works: it is resolved from the element the gesture STARTS on,
   and a plot is never a drag source — lgStartDrag is only ever reached from the
   tray listener. So `none` on a plot bought nothing and cost the page its
   scroll over the single largest block on the screen. In portrait the land sits
   above the tray, so a group could be unable to reach the tiles at all. */
check('a tray tile owns its gesture, and the land does not steal the page\'s scroll', () => {
  assert.ok(/\.lg-tile\{[^}]*touch-action:none/.test(SRC),
    '.lg-tile without touch-action:none — a drag off a tray tile will scroll the page instead of dragging');
  assert.ok(!/\.lg-plot\{[^}]*touch-action:none/.test(SRC),
    '.lg-plot has touch-action:none again — it is never a drag source, so this only kills scrolling ' +
    'over the land, and in portrait that can strand a group above the tray');
  assert.ok(/\.lg-plot\{[^}]*touch-action:manipulation/.test(SRC),
    '.lg-plot should set touch-action:manipulation — taps stay instant, scrolling still works');
});

check('a tile says what it is for, not just what it costs', () => {
  const tray = extractFn('renderTray');
  assert.ok(/d\.tag/.test(tray),
    'renderTray does not render def.tag — every building and industry lost its explanatory line, ' +
    'including the estate\'s "every race lives on the same landing"');
  assert.ok(/esc\(d\.tag\)/.test(tray), 'def.tag is rendered unescaped');
  assert.ok(/\.lg-tag\{/.test(SRC), 'the .lg-tag rule is missing, so the line has no styling');
});

/* The tray must not become the trap the land just stopped being. Its tiles all
   declare touch-action:none, so any scrollport they sit inside cannot be panned
   by a finger — only the gaps between them would move. Seven industry tiles,
   each carrying a tag line, exceed 520px before wrapping, so a capped tray put
   its last entries below a fold no touch device could reach. */
check('the tray has no inner scrollport its own tiles would refuse to scroll', () => {
  assert.ok(!/\.lg-tray\{[^}]*max-height/.test(SRC),
    '.lg-tray has a max-height again — its tiles declare touch-action:none, so anything ' +
    'past the cap is unreachable on a touch device. Let the page scroll instead.');
  assert.ok(/\.lg-tile\{[^}]*touch-action:none/.test(SRC),
    'this check only matters while tray tiles claim the gesture');
});

check('a drag keeps receiving events after the pointer leaves the window', () => {
  const start = extractFn('lgStartDrag');
  assert.ok(/setPointerCapture\(/.test(start),
    'lgStartDrag does not capture the pointer. A release outside the viewport delivers no ' +
    'pointerup, and because a live LG.drag makes every later pointerdown a no-op, the tray ' +
    'would stay dead until the student reloads');
  assert.ok(/try \{[^}]*setPointerCapture/.test(start),
    'setPointerCapture is uncaught — it throws if the pointer is already gone, which would ' +
    'take the whole drag down with it');
});

check('a second finger cannot hijack or end a drag already in progress', () => {
  const bind = extractFn('lgBind');
  const start = extractFn('lgStartDrag');
  assert.ok(/LG\.drag = \{[^}]*\bid\b/.test(start),
    'lgStartDrag does not record the pointerId on LG.drag, so no handler can tell whose gesture it is');
  assert.ok(/if\(LG\.drag\) return;/.test(bind),
    'a second pointerdown still overwrites the drag in progress — the first finger lifting would ' +
    'then place the second finger\'s tile');
  const guards = bind.match(/e\.pointerId !== LG\.drag\.id/g) || [];
  assert.strictEqual(guards.length, 3,
    `pointermove, pointerup and pointercancel must each ignore other pointers — found ${guards.length} guards`);
  assert.ok(/lgStartDrag\([^)]*e\.pointerId\)/.test(bind),
    'lgBind does not pass e.pointerId into lgStartDrag');
});

check('a watching member cannot tap the land or the tray', () => {
  assert.ok(/#s_prep\.ro \.pane \.lg-tile,\s*\n#s_prep\.ro \.pane \.lg-plot\{pointer-events:none/.test(SRC),
    'the new tap targets are divs with no disabled state, and nothing kills their clicks in read-only mode');
});

check('the new classes do not collide with the ones already in the file', () => {
  // Scope to the CSS block Task 4 inserted, rather than enumerating names by
  // hand — an enumerated list only covers what someone remembered to list,
  // and .grid{} / .ghost{} are pre-existing classes a naive list would miss
  // testing for. Walk the block by brace depth so @media-wrapped rules are
  // covered too, pull out every selector list, and require that any selector
  // which is JUST a bare class (nothing else — no descendant, no compound,
  // no id) is lg- prefixed. A bare, unprefixed class is the exact shape that
  // silently overrides an existing same-name rule of the same specificity.
  const startMark = '/* the land grid — steps 5 and 6.';
  const start = SRC.indexOf(startMark);
  assert.ok(start !== -1, 'could not find the start of the new CSS block');
  const styleClose = SRC.indexOf('</style>', start);
  assert.ok(styleClose !== -1, 'could not find the </style> that closes the new CSS block');
  const block = SRC.slice(start, styleClose).replace(/\/\*[\s\S]*?\*\//g, '');

  const selectorLists = [];
  let buf = '';
  for (const ch of block) {
    if (ch === '{') {
      const sel = buf.trim();
      if (sel && !sel.startsWith('@')) selectorLists.push(sel);
      buf = '';
    } else if (ch === '}') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  assert.ok(selectorLists.length >= 20,
    `only found ${selectorLists.length} rules in the new CSS block — the block markers may be wrong`);

  const bare = [];
  for (const list of selectorLists) {
    for (const sel of list.split(',')) {
      const s = sel.trim();
      if (/^\.[\w-]+$/.test(s) && !s.startsWith('.lg-')) bare.push(s);
    }
  }
  assert.deepStrictEqual(bare, [],
    `a bare, unprefixed class rule in the new CSS block will collide with an existing rule of the same name: ${bare.join(', ')}`);
});

check('placing and clearing go through build() and site(), never through C', () => {
  const calls = [];
  /* Task 4: lgApply now looks up can()/apply() on LG_KIND[kind] rather than
     asking canBuild()/canSite() and calling build()/site() by a ternary on
     kind — the stub reproduces the exact same behaviour under the new shape.
     hall is false throughout this suite, so the up-only guard never engages
     and a -1 still reaches apply(), as every check here expects. */
  const lgApply = loadFn('lgApply', {
    LG_KIND: {
      build: { can: () => true, apply: (k, d) => calls.push(['build', k, d]) },
      ind:   { can: () => true, apply: (k, d) => calls.push(['site',  k, d]) }
    },
    lgHall: () => false
  });
  lgApply('build', 'home', 1);
  lgApply('build', 'home', -1);
  lgApply('ind', 'farm', 1);
  lgApply('ind', 'farm', -1);
  assert.deepStrictEqual(calls, [
    ['build','home',1], ['build','home',-1], ['site','farm',1], ['site','farm',-1]
  ]);
});

/* The check above proves lgApply() dispatches correctly through WHATEVER
   table it is handed — it never reads the real LG_KIND, so a wrong wiring in
   the shipped file needs its own pin.

   A first version of this pin matched LG_KIND's raw row text with a regex.
   That is comment-foolable: a row can carry a decoy comment naming the
   right function right next to the wrong assignment — the text regex
   reads the decoy name, while the real assignment is something else
   entirely — the same trick a doc-comment used to fool
   minister-client.test.js earlier in this file's history. Demonstrated
   directly: with that regex, `node tests/build-grid.test.js` and
   `node tests/hall-land-client.test.js` both exit 0 with Infrastructure
   locked out of building and Trade let in.

   This version evaluates the real LG_KIND as actual JavaScript instead of
   scanning its text — loadConst() runs it through eval(), which strips
   comments the way any JS parser does, so a decoy comment cannot change
   what gets assigned. canBuild/canSite/build/site are replaced with
   sentinels that record which one a row's can/apply actually invoke, and
   BUILDINGS/INDUSTRIES are the real arrays, so defs() can be checked by
   identity in the same pass rather than by name. No text pattern can
   satisfy a function that was actually called. */
check('LG_KIND wires each land kind to its own role check, its own writer, its own defs table and its own counts bag, in the real file (evaluated, not text-matched)', () => {
  const GLOBALS = ['BUILDINGS', 'INDUSTRIES', 'C', 'canBuild', 'canSite', 'build', 'site'];
  const had = {}, prev = {};
  for (const k of GLOBALS) { had[k] = Object.prototype.hasOwnProperty.call(global, k); prev[k] = global[k]; }

  const calls = [];
  const CBuildings = { sentinel: 'C.buildings' };
  const CIndustries = { sentinel: 'C.industries' };
  global.BUILDINGS = E.BUILDINGS;
  global.INDUSTRIES = E.INDUSTRIES;
  global.C = { buildings: CBuildings, industries: CIndustries };
  global.canBuild = (...a) => { calls.push(a.length ? ['canBuild', ...a] : 'canBuild'); return true; };
  global.canSite  = (...a) => { calls.push(a.length ? ['canSite',  ...a] : 'canSite');  return true; };
  global.build    = (...a) => { calls.push(['build', ...a]); };
  global.site     = (...a) => { calls.push(['site',  ...a]); };

  /* defs()/counts()/can()/apply() are closures over these globals — they
     resolve BUILDINGS/C/canBuild/etc. lazily, when CALLED, not when the
     object literal is eval'd. So every call has to happen before the
     globals are restored in `finally`, not after — calling row.defs() or
     row.counts() once the real values have been put back is exactly the
     ReferenceError this test is trying to catch in the SHIPPED code,
     self-inflicted on the harness instead. */
  try {
    const LG_KIND = loadConst('LG_KIND');
    const expect = {
      build:  { can: 'canBuild', apply: 'build', defs: E.BUILDINGS,  counts: CBuildings,  hall: false },
      ind:    { can: 'canSite',  apply: 'site',  defs: E.INDUSTRIES, counts: CIndustries, hall: false },
      hbuild: { can: 'canBuild', apply: 'build', defs: E.BUILDINGS,  counts: CBuildings,  hall: true  },
      hind:   { can: 'canSite',  apply: 'site',  defs: E.INDUSTRIES, counts: CIndustries, hall: true  }
    };
    for (const kind of Object.keys(expect)) {
      const row = LG_KIND[kind];
      assert.ok(row, `LG_KIND has no ${kind} row`);
      const want = expect[kind];

      calls.length = 0;
      row.can();
      assert.deepStrictEqual(calls, [want.can],
        `LG_KIND.${kind}.can() actually called ${JSON.stringify(calls)}, not ${want.can}() — the wrong ministry would gate this land`);

      calls.length = 0;
      row.apply('key', 1);
      assert.deepStrictEqual(calls, [[want.apply, 'key', 1]],
        `LG_KIND.${kind}.apply() actually called ${JSON.stringify(calls)}, not ${want.apply}() — placing here would write to the wrong bag`);

      assert.strictEqual(row.defs(), want.defs,
        `LG_KIND.${kind}.defs() does not return the real ${want.defs === E.BUILDINGS ? 'BUILDINGS' : 'INDUSTRIES'} table by identity`);

      assert.strictEqual(row.counts(), want.counts,
        `LG_KIND.${kind}.counts() does not return C.${want.counts === CBuildings ? 'buildings' : 'industries'} by identity — this land would count the wrong bag`);

      assert.strictEqual(row.hall, want.hall,
        `LG_KIND.${kind}.hall is ${row.hall}, not ${want.hall}`);
    }
  } finally {
    for (const k of GLOBALS) { if (had[k]) global[k] = prev[k]; else delete global[k]; }
  }
});

check('an unaffordable placement is still refused and the count does not move', () => {
  const c = E.blankCountry(); c.homeland = 'delta';   // M3
  c.buildings = { home: 1 };                          // 1 Material left, a home needs 2
  const toasts = [];
  const build = loadFn('build', {
    C: c, BUILDINGS: E.BUILDINGS, ENGINE: E,
    toast: m => toasts.push(m), renderBuildings: () => {}
  });
  build('home', 1);
  assert.deepStrictEqual(c.buildings, { home: 1 }, 'an unaffordable home was built anyway');
  assert.strictEqual(toasts.length, 1, 'nothing told the group why');
});

check('clearing the last of a kind deletes the key rather than banking a zero', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  c.buildings = { home: 1 };
  const build = loadFn('build', {
    C: c, BUILDINGS: E.BUILDINGS, ENGINE: E, toast: () => {}, renderBuildings: () => {}
  });
  build('home', -1);
  assert.deepStrictEqual(c.buildings, {}, 'a zeroed building key was left behind');
});

check('the grid is built on pointer events, never on HTML5 drag-and-drop', () => {
  const bind = extractFn('lgBind');
  for(const ev of ['dragstart','dragover','dragend','drop']){
    assert.ok(!bind.includes(ev), `lgBind listens for "${ev}", which never fires on iPad`);
  }
  for(const ev of ['pointerdown','pointermove','pointerup','pointercancel']){
    assert.ok(bind.includes(ev), `lgBind does not listen for "${ev}"`);
  }
  assert.ok(/keydown/.test(bind), 'lgBind has no keyboard path, so a switch user cannot place anything');
});

/* --- fix round 1: a refused placement must stop lying about what is armed --- */

check('a refusal (still short after build()/site() declines) leaves the say line true, not still armed', () => {
  const LG = { kind: 'build', armed: 'home', drag: null };
  const sayCalls = [];
  const lgTapPlot = loadFn('lgTapPlot', {
    LG,
    landCells: () => [],                       // the tapped plot is empty
    lgCounts: () => ({ home: 0 }),              // the count never moved — the refusal held
    lgDefs: () => [{ key: 'home', name: 'Homes' }],
    lgApply: () => {},                          // stands in for a build() that declined
    lgSay: (kind, text, tone) => sayCalls.push({ kind, text, tone }),
    lgEffect: () => '',
    renderLand: () => {}, renderTray: () => {}
  });
  lgTapPlot('build', 0);
  assert.strictEqual(LG.armed, null, 'the armed flag must be cleared even on a refusal');
  const last = sayCalls[sayCalls.length - 1];
  assert.ok(last, 'a refusal must leave the say line saying something, not silence');
  assert.strictEqual(last.tone, 'bad', 'a refusal should read as bad news, not neutral');
  assert.ok(!/Tap any plot to place it/.test(last.text),
    'the say line still told the student to do the thing that just failed — the dead-loop bug');
  assert.ok(/Homes/.test(last.text), 'the say line should name the tile that was refused');
});

/* --- fix round 1: step 6 keeps its route back to Policies --- */

check('a meter-gated industry tile carries a route back to Policies; a cost-gated tile does not', () => {
  const c = E.blankCountry(); c.homeland = 'high';   // G ≈ 50, short of Tourism's 55
  const el = { innerHTML: '' };
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind: 'ind', armed: null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO, esc: s => String(s),
    $: () => el, lgMeters: () => E.foundingMeters(c), lgHall: () => false,
    trayModel: () => [
      { def: E.INDUSTRIES.find(x => x.key === 'tour'), why: 'Needs Green 55 — you have 50' },
      { def: E.INDUSTRIES.find(x => x.key === 'mine'), why: 'Not enough Materials' }
    ]
  });
  renderTray('ind');
  const parts = el.innerHTML.split('<div class="lg-tile').slice(1);
  assert.strictEqual(parts.length, 2, 'expected exactly the two stubbed tiles');
  assert.ok(/goStep\(4\)/.test(parts[0]), 'Tourism is locked by a meter — it should carry a Policies link');
  assert.ok(parts[0].includes(E.METER_INFO.G.from), 'the ministry that raises Green should be named');
  assert.ok(!/goStep\(4\)/.test(parts[1]), 'Mines is locked by cost, not a meter — it must not carry a Policies link');
});

check('the Build tray never grows a Policies link, even for a hypothetically meter-gated definition', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  const el = { innerHTML: '' };
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind: 'build', armed: null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO, esc: s => String(s),
    $: () => el, lgMeters: () => E.foundingMeters(c), lgHall: () => false,
    trayModel: () => [{
      def: { key: 'home', name: 'Homes', icon: '🏠', need: { M: 2, F: 2 }, req: { G: 999 } },
      why: 'Needs Green 999 — you have 50'
    }]
  });
  renderTray('build');
  assert.ok(!/goStep\(4\)/.test(el.innerHTML),
    'buildings are never meter-gated in this game and must never sprout a Policies link');
});

check('the ministry name in a Policies link is escaped like every other interpolated value', () => {
  const c = E.blankCountry(); c.homeland = 'high';
  const el = { innerHTML: '' };
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind: 'ind', armed: null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO,
    esc: s => '[ESC[' + s + ']]',
    $: () => el, lgMeters: () => E.foundingMeters(c), lgHall: () => false,
    trayModel: () => [{ def: E.INDUSTRIES.find(x => x.key === 'tour'), why: 'Needs Green 55 — you have 50' }]
  });
  renderTray('ind');
  assert.ok(el.innerHTML.includes('[ESC[' + E.METER_INFO.G.from + ']]'),
    'METER_INFO[…].from must be passed through esc() before it reaches markup, like everything else here');
});

check("the tray's pointerdown handler lets a tap on the Policies link through untouched", () => {
  const bind = extractFn('lgBind');
  assert.ok(/closest\(['"]a['"]\)/.test(bind),
    'lgBind must not preventDefault() a pointerdown that started on an <a>, or a locked tile\'s Policies link can never be tapped or dragged from');
});

/* --- fix round 1: the interaction layer, exercised without a browser ---
   loadFn injects whatever the function closes over, so a fake $ / document /
   LG / and the functions each one calls next stand in for the DOM and the
   rest of the module. Only the decision points are covered here — pointermove
   and ghost positioning genuinely need a finger. */

check('dropping a dragged tile onto an already-filled plot removes what was there — reviewed and ruled a deliberate decision, NOT a bug to silently "fix"', () => {
  // lgEndDrag arms LG with the dragged key and hands off to lgTapPlot, whose
  // first branch (a filled plot) is unconditional: it removes and refunds
  // whatever is already on that plot rather than refusing the drop. The
  // project owner has ruled this ships exactly as the plan wrote it — do not
  // add a guard here to "fix" it.
  const calls = { arm: [], tapPlot: [] };
  const LG = { kind: 'build', armed: null, drag: { key: 'coal', el: { classList: { remove: () => {} } }, x0: 10, y0: 10 } };
  const target = { dataset: { i: '3' }, classList: { contains: () => true } };  // a filled plot
  const lgEndDrag = loadFn('lgEndDrag', {
    LG,
    $: () => ({ style: {} }),
    document: { querySelectorAll: () => [] },
    lgPlotUnder: () => target,
    lgMoved: () => true,
    lgArm: (...a) => calls.arm.push(a),
    lgSay: () => {},
    lgTapPlot: (...a) => calls.tapPlot.push(a)
  });
  lgEndDrag(50, 50);
  assert.strictEqual(LG.armed, 'coal', 'lgEndDrag arms the dragged key before handing off to lgTapPlot');
  assert.deepStrictEqual(calls.tapPlot, [['build', 3]], 'a drop on a plot must hand off to lgTapPlot, which removes whatever is already there');
  assert.deepStrictEqual(calls.arm, [], 'a drop that lands on a plot is not the tap-to-arm path');
});

check('a press that never moved and lands on no plot arms the tile, not a failed drop', () => {
  const calls = { arm: [], say: [] };
  const LG = { kind: 'ind', armed: null, drag: { key: 'farm', el: { classList: { remove: () => {} } }, x0: 100, y0: 100 } };
  const lgEndDrag = loadFn('lgEndDrag', {
    LG,
    $: () => ({ style: {} }),
    document: { querySelectorAll: () => [] },
    lgPlotUnder: () => null,               // no plot under the release point
    lgMoved: () => false,                  // 8px or under — a tap, not a drag
    lgArm: (...a) => calls.arm.push(a),
    lgSay: (...a) => calls.say.push(a),
    lgTapPlot: () => { throw new Error('a tap that never moved must not fall through to a placement attempt'); }
  });
  lgEndDrag(103, 101);
  assert.deepStrictEqual(calls.arm, [['ind', 'farm']], 'a stationary press should arm the tile it started on');
  assert.deepStrictEqual(calls.say, [], 'a stationary press is not a failed drop and must not be told so');
});

check('a real drag that ends outside the land places nothing and says so', () => {
  const calls = { say: [], tapPlot: [] };
  const LG = { kind: 'build', armed: null, drag: { key: 'home', el: { classList: { remove: () => {} } }, x0: 10, y0: 10 } };
  const lgEndDrag = loadFn('lgEndDrag', {
    LG,
    $: () => ({ style: {} }),
    document: { querySelectorAll: () => [] },
    lgPlotUnder: () => null,               // released off the land
    lgMoved: () => true,                   // this really was a drag
    lgArm: () => { throw new Error('a real drag that missed the land must not be silently re-armed'); },
    lgSay: (...a) => calls.say.push(a),
    lgTapPlot: (...a) => calls.tapPlot.push(a)
  });
  lgEndDrag(500, 500);
  assert.deepStrictEqual(calls.tapPlot, [], 'nothing should be placed when the drop misses the land');
  assert.strictEqual(calls.say.length, 1, 'a missed drop must be explained');
  assert.match(calls.say[0][1], /nothing was built/i, 'the say line should tell the student nothing was built');
});

check('arming a tile, then arming the same tile again, disarms it', () => {
  const LG = { kind: 'build', armed: null, drag: null };
  const disarmCalls = [];
  const lgArm = loadFn('lgArm', {
    LG, C: {}, lgMeters: () => ({}),
    trayModel: () => [{ def: { key: 'home', name: 'Homes' }, why: null }],
    lgDisarm: k => disarmCalls.push(k),
    lgSay: () => {}, renderLand: () => {}, renderTray: () => {},
    lgCost: () => 'costs nothing', lgEffect: () => ''
  });
  lgArm('build', 'home');
  assert.strictEqual(LG.armed, 'home', 'the first tap should arm the tile');
  lgArm('build', 'home');
  assert.deepStrictEqual(disarmCalls, ['build'], 'the second tap on the same tile should disarm it, not re-arm it');
});

check('a tile armed on one step does not place when a plot is tapped on the other step', () => {
  const calls = { apply: [], say: [] };
  const LG = { kind: 'build', armed: 'home', drag: null };
  const lgTapPlot = loadFn('lgTapPlot', {
    LG,
    landCells: () => [],                 // the tapped plot (on the 'ind' step) is empty
    lgCounts: () => ({}),
    lgDefs: () => [],
    lgApply: (...a) => calls.apply.push(a),
    lgSay: (...a) => calls.say.push(a),
    lgEffect: () => '',
    renderLand: () => {}, renderTray: () => {}
  });
  lgTapPlot('ind', 0);   // armed on 'build', tapping a plot on 'ind'
  assert.deepStrictEqual(calls.apply, [], 'a tile armed on one step must not place on the other step');
  assert.strictEqual(calls.say.length, 1);
  assert.match(calls.say[0][1], /Pick something from the list first/,
    'crossing steps should ask the student to pick something on THIS step first, not silently place');
});

/* --- fix round 1: a read-only member device is stopped at the one writer --- */

check('a read-only member device cannot place or clear anything through lgApply', () => {
  const calls = [];
  const lgApply = loadFn('lgApply', {
    LG_KIND: {
      build: { can: () => false, apply: (...a) => calls.push(['build', ...a]) },
      ind:   { can: () => false, apply: (...a) => calls.push(['site',  ...a]) }
    },
    lgHall: () => false
  });
  lgApply('build', 'home', 1);
  lgApply('ind', 'farm', 1);
  assert.deepStrictEqual(calls, [], 'a read-only device must not be able to write through the one writer');
});

/* --- Task 11: lgApply asks Infrastructure about building and Trade about
   siting, not one leader-only question for both --- */

check('Infrastructure can build but not site; Trade can site but not build', () => {
  const buildCalls = [];
  const lgApplyFor = (canBuild, canSite) => loadFn('lgApply', {
    LG_KIND: {
      build: { can: () => canBuild, apply: (...a) => buildCalls.push(['build', ...a]) },
      ind:   { can: () => canSite,  apply: (...a) => buildCalls.push(['site',  ...a]) }
    },
    lgHall: () => false
  });
  const infra = lgApplyFor(true, false);
  infra('build', 'home', 1);
  infra('ind', 'farm', 1);
  assert.deepStrictEqual(buildCalls, [['build', 'home', 1]],
    'Infrastructure must be able to build but not site');

  buildCalls.length = 0;
  const trade = lgApplyFor(false, true);
  trade('build', 'home', 1);
  trade('ind', 'farm', 1);
  assert.deepStrictEqual(buildCalls, [['site', 'farm', 1]],
    'Trade must be able to site but not build');
});

/* renderBuildings() only ever touches innerHTML, textContent, dataset, classList
   and .open, so a dozen lines of stub stand in for a DOM this repo has no
   dependency to provide. loadFn injects every global the function closes over. */
function stubDoc(){
  const els = {};
  const make = () => ({ innerHTML:'', textContent:'', open:false, dataset:{},
    classList:{ toggle(){}, add(){}, remove(){} } });
  return { $: id => els[id] || (els[id] = make()), els };
}
const renderBuildingsWith = (c, doc, trade) => loadFn('renderBuildings', {
  C: c, S: { solo:true, code:null }, ENGINE: E, RES: E.RES, BUILDINGS: E.BUILDINGS,
  METER_INFO: E.METER_INFO, INDUSTRIES: E.INDUSTRIES, esc: E.esc, $: doc.$,
  renderBuildTrade: s => trade.push(s),
  renderLand: () => {}, renderTray: () => {}, renderPeople: () => {}
});

check('the stuck note still appears for a homeland that cannot house everyone', () => {
  const c = E.blankCountry(); c.homeland = 'delta';   // W8 M3 F11
  c.buildings = { home: 1 };                          // housed 6 of 8, 1 Material left
  assert.ok(E.housed(c) < E.pool(c).W, 'test setup no longer leaves anyone unhoused');
  assert.strictEqual(E.free(c).M, 1, 'test setup can still afford another home');
  const doc = stubDoc(), trade = [];
  renderBuildingsWith(c, doc, trade)();
  assert.ok(/not a mistake/.test(doc.els.buildNote.innerHTML),
    'the stuck note vanished — a delta group can no longer tell "stuck by design" from "we got it wrong"');
  assert.deepStrictEqual(trade, [true], 'renderBuildTrade was not told the country is stuck');
});

check('a country that can still build is not told it is stuck', () => {
  const c = E.blankCountry(); c.homeland = 'high';    // M12 F4 — homes are affordable
  assert.ok(E.housed(c) < E.pool(c).W, 'test setup houses everyone already, so nothing is proved');
  const doc = stubDoc(), trade = [];
  renderBuildingsWith(c, doc, trade)();
  assert.strictEqual(doc.els.buildNote.innerHTML, '',
    'a country that can still build was told its homeland cannot house everyone');
  assert.deepStrictEqual(trade, [false], 'renderBuildTrade was told a solvent country is stuck');
});

check('the housed count and the resource row still render', () => {
  const c = E.blankCountry(); c.homeland = 'delta';
  const doc = stubDoc(), trade = [];
  renderBuildingsWith(c, doc, trade)();
  assert.strictEqual(doc.els.housedCount.textContent, '4 of 8 workers');
  assert.ok(/Materials/.test(doc.els.buildResRow.innerHTML), 'the Build step lost its resource row');
});

check('renderBuildTrade still hides itself in solo play and opens once for a stuck group', () => {
  const src = extractFn('renderBuildTrade');
  assert.ok(src.includes("box.classList.toggle('hidden', !!S.solo || !S.code)"),
    'renderBuildTrade no longer hides itself in solo play');
  assert.ok(src.includes('if(stuck && !box.dataset.nudged)'),
    'renderBuildTrade no longer opens itself once for a group that has hit the wall');
  assert.ok(src.includes("box.dataset.nudged = '1'"),
    'renderBuildTrade lost the nudge latch and will re-open under a group mid-offer');
});

check('renderBuildings still hands the stuck flag to the trade panel', () => {
  const src = extractFn('renderBuildings');
  assert.ok(src.includes('renderBuildTrade(stuck)'),
    'renderBuildings no longer calls renderBuildTrade(stuck)');
  assert.ok(src.includes('(!b.card||picks.includes(b.card))'),
    'the policy gate that decides "short" is gone from the stuck calculation');
});

/* peopleCount().atWork is industry DEMAND and can exceed the housed workforce.
   Printed raw it read "at work 9 of 6 housed". These pin the readout to numbers
   a 15-year-old can parse, and pin the warning to a rule the engine actually
   has — roundIncome() stalls an industry on an unmet METER gate only, never on
   housing, so the old copy promised a penalty that never arrives. */
const renderPeopleWith = (c) => {
  const els = {};
  const $ = id => els[id] || (els[id] = { innerHTML:'' });
  const fn = loadFn('renderPeople', {
    C: c, ENGINE: E, $,
    peopleCount: loadFn('peopleCount', { ENGINE: E })
  });
  fn('build');
  return els.buildPeople.innerHTML;
};

check('the at-work count never claims more workers than the country houses', () => {
  const c = E.blankCountry(); c.homeland = 'port';   // housed 6
  c.industries = { fact: 3 };                        // demands 9
  const html = renderPeopleWith(c);
  assert.ok(!/at work <b>9<\/b>/.test(html),
    '"at work 9 of 6 housed" is not a sentence a student can parse');
  assert.ok(/at work <b>6<\/b> of 6 housed/.test(html),
    'the at-work chip should show the workers actually staffed, capped at housed');
});

check('the shortfall warning names the real rule — building, not income', () => {
  const c = E.blankCountry(); c.homeland = 'port';
  c.industries = { fact: 3 };
  const html = renderPeopleWith(c);
  assert.ok(/3 more jobs/.test(html), 'the shortfall of 3 is not reported');
  assert.ok(!/can only employ|nobody housed to fill/.test(html),
    'the warning still promises a payout penalty for under-housing, which roundIncome() ' +
    'never applies — it stalls on unmet meter gates only, never on housing');
  assert.ok(/build homes/i.test(html),
    'the warning does not tell the group what to actually do about it');
});

/* Without this case, `staffed = p.housed` — ignoring atWork entirely — passes
   every other readout check, because the over-staffed and exactly-staffed cases
   both expect 6. This is the one that pins the min(). */
check('an under-staffed country shows the jobs it actually filled, not its housing', () => {
  const c = E.blankCountry(); c.homeland = 'port';   // housed 6
  c.industries = { fact: 1 };                        // demands 3
  const html = renderPeopleWith(c);
  assert.ok(/at work <b>3<\/b> of 6 housed/.test(html),
    'a country with 6 housed and 3 jobs should report 3 at work, not 6');
  assert.ok(!/more job/.test(html), 'a country with workers to spare was warned of a shortfall');
});

check('a fully housed country is shown no shortfall warning at all', () => {
  const c = E.blankCountry(); c.homeland = 'port';
  c.industries = { fact: 2 };                        // demands 6, houses 6
  const html = renderPeopleWith(c);
  assert.ok(!/more job/.test(html), 'a country that can staff every site was warned anyway');
  assert.ok(/at work <b>6<\/b> of 6 housed/.test(html));
});

/* The one path in this feature that destroys something a group built. Every
   other lgTapPlot test injects landCells: () => [], i.e. an empty plot, so the
   removal branch shipped three times without ever being entered. */
const tapFilled = (kind, cells, counts, opts) => {
  const said = [], applied = [];
  const bag = { ...counts };
  const fn = loadFn('lgTapPlot', Object.assign({
    LG: { kind, armed:null, drag:null },
    landCells: () => cells,
    lgCounts: () => bag,
    lgDefs: () => (kind === 'build' ? E.BUILDINGS : E.INDUSTRIES),
    RES: E.RES,
    lgApply: (k, key, d) => { applied.push([k, key, d]); if(d < 0) bag[key] = (bag[key]||0) + d; },
    lgSay: (k, text, tone) => said.push({ text, tone }),
    /* Both kinds this helper drives are prep kinds. Removal is a prep-only act
       from Spec B onward — the hall branch is pinned in hall-build-screen. */
    lgHall: () => false,
    lgEffect: () => '', renderLand: () => {}, renderTray: () => {}
  }, opts || {}));
  fn(kind, 0);
  return { said, applied, bag };
};

check('tapping a filled plot removes exactly that building, through lgApply', () => {
  const home = E.BUILDINGS.find(b => b.key === 'home');
  const r = tapFilled('build', [home, home], { home: 2 });
  assert.deepStrictEqual(r.applied, [['build', 'home', -1]],
    'removing a building did not go through lgApply exactly once with -1');
  assert.strictEqual(r.bag.home, 1, 'the count did not fall');
});

check('taking a building back names Materials and Food — what it actually cost', () => {
  const home = E.BUILDINGS.find(b => b.key === 'home');   // need M2 F2, no workers
  const said = tapFilled('build', [home], { home: 1 }).said;
  assert.strictEqual(said.length, 1);
  assert.ok(/Materials and Food/.test(said[0].text),
    `a home costs Materials and Food; the message said ${JSON.stringify(said[0].text)}`);
});

check('taking a site back names Workers, not materials — step 6 is not step 5', () => {
  const farm = E.INDUSTRIES.find(i => i.key === 'farm');  // need W2 only
  const said = tapFilled('ind', [farm], { farm: 1 }).said;
  assert.ok(/Workers/.test(said[0].text),
    `a farm costs Workers; the message said ${JSON.stringify(said[0].text)}`);
  assert.ok(!/[Mm]aterials/.test(said[0].text),
    'build-step copy is still leaking into the Industry step — a farm costs no Materials');
});

check('a member whose removal was refused is not told the building came back', () => {
  const home = E.BUILDINGS.find(b => b.key === 'home');
  /* lgApply is the read-only gate, so a refusal looks like a call that changes
     no count — exactly what a watching member's tap produces. */
  const r = tapFilled('build', [home], { home: 1 }, { lgApply: () => {} });
  assert.deepStrictEqual(r.said, [],
    'nothing was removed, but the student was told "you have your Materials again"');
});

check('the confirmation quotes the tile just placed, not the next one', () => {
  const src = extractFn('lgTapPlot');
  const fx = src.indexOf('lgEffect(kind, key)');
  const apply = src.indexOf('lgApply(kind, key, 1)');
  assert.ok(fx !== -1 && apply !== -1, 'lgTapPlot no longer previews or applies as expected');
  assert.ok(fx < apply,
    'lgEffect runs after lgApply, so it previews the NEXT unit — diminishing returns make that ' +
    'a different number from the one the student was shown while arming');
});

/* Nothing else in this repo would catch a stray brace in the shipped page:
   loadFn evaluates individual functions, so a syntax error anywhere between
   them ships silently and white-screens every device in the hall. */
check('the whole shipped page parses as JavaScript', () => {
  const blocks = [...SRC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length, 'no inline <script> found — this check has stopped checking');
  blocks.forEach((src, i) => {
    try { new Function(src); }
    catch (e) { throw new Error(`inline <script> #${i + 1} does not parse: ${e.message}`); }
  });
});

if (fails) process.exit(1);
console.log('PASS  build grid — derivation, gating, preview and the stuck note all hold');
