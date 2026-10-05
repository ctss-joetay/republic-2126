/* Spec B §4. The tab is role-shaped, and getting that wrong is not cosmetic:
   a Defence Minister handed a Build tab would tap it, be refused by
   lgApply's canBuild(), and learn that the screen is broken. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFn, APP } = require('./helpers');
const E = require('../game_engine.js');

let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };
/* hallCommit is the one thing here that has to be awaited — it posts, then
   refreshes, and the order of those two is the whole point. */
const checkAsync = async (name, fn) => { ran++; try { await fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

const src = fs.readFileSync(APP, 'utf8');

/* GT is a const ARRAY, so loadConst (which only matches an object literal)
   cannot reach it. Pull the real four-tab list out of the shipped source
   rather than stubbing it — gtLabel's whole job is to append a fifth entry to
   exactly this list, and a stub would let the base list rot unnoticed. */
const GT = eval(/^const GT = (\[[\s\S]*?\]);$/m.exec(src)[1]);

check('both hall land panes exist in the markup', () => {
  for (const id of ['hbuildLand','hbuildScene','hbuildTiles','hbuildPeople','hbuildSay',
                    'hindLand','hindScene','hindTiles','hindPeople','hindSay']) {
    assert.ok(src.includes(`id="${id}"`), `#${id} is missing from #s_game`);
  }
});

check('each hall land sits inside a .pane, or landTick will never draw it', () => {
  /* landTick tests cv.closest('.pane') and skips a canvas without one, so a
     hall land outside a .pane would sit there frozen. The panes ship hidden,
     hence the \b rather than a closing quote. */
  const gMinistry = src.slice(src.indexOf('id="g_ministry"'), src.indexOf('id="g_board"'));
  for (const id of ['hbuildPane', 'hindPane']) {
    assert.ok(new RegExp(`class="pane\\b[^"]*"\\s+id="${id}"`).test(gMinistry),
      `#${id} carries no .pane class — landTick will never draw its canvas`);
  }
});

/* ---------- does the dimming rule actually reach this element? ----------------

   The two checks that used to sit here matched /#s_game\.ro[^{]*\.lg-plot/ and
   /#s_game\.ro[^{]*:not\(\.mine\)[^{]*\.lg-plot/ over the raw file. `[^{]*`
   cannot cross a `{`, and a CSS comment contains no `{` — so deleting the whole
   rule and leaving a comment that names the selector satisfied both of them,
   and the file still read 40/40. Neither check could fail for the reason it
   claimed to exist.

   What follows does the work instead. It reads the declarations the stylesheet
   actually ships, builds the element tree renderHall leaves behind (pane
   classes seeded from the shipped markup, then toggled by the shipped
   renderHall, tile classes taken from a real renderProgrammes run), and asks
   whether any rule that switches the pointer off reaches a given element. A
   commented-out rule parses to nothing and reaches nobody — which is a failure
   below, not a pass.

   What it deliberately does NOT claim: that a browser lays the page out this
   way. It is a selector-matching check over real inputs, not a rendering one.
   Naming it as a match is the point — a check named as if it defends behaviour
   while only reading source shape is worse than no check at all. */

/* Every selector in this stylesheet that switches the pointer off, comments
   stripped first so a commented-out rule contributes nothing. */
const NO_POINTER = (() => {
  const css = src.slice(src.indexOf('<style'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/pointer-events\s*:\s*none/.test(m[2])) continue;
    for (const sel of m[1].split(',')) if (sel.trim()) out.push(sel.trim());
  }
  return out;
})();

/* Only the grammar this stylesheet uses, and anything else THROWS rather than
   quietly returning false — a selector this cannot read must never be reported
   as "does not reach". */
function compoundMatches(el, compound) {
  const parts = compound.match(/#[\w-]+|\.[\w-]+|:not\(\.[\w-]+\)/g) || [];
  if (parts.join('') !== compound)
    throw new Error('selector grammar not supported by this check: ' + JSON.stringify(compound));
  return parts.every(p => {
    if (p[0] === '#') return el.id === p.slice(1);
    if (p[0] === '.') return el.classes.has(p.slice(1));
    return !el.classes.has(p.slice(6, -1));            // :not(.x)
  });
}
function ancestorsMatch(el, parts) {
  if (!parts.length) return true;
  for (let a = el; a; a = a.parent)
    if (compoundMatches(a, parts[parts.length - 1]) && ancestorsMatch(a.parent, parts.slice(0, -1)))
      return true;
  return false;
}
function selectorReaches(sel, el) {
  const parts = sel.trim().split(/\s+/);
  const last = parts.pop();
  return compoundMatches(el, last) && ancestorsMatch(el.parent, parts);
}
const pointerOff = el => NO_POINTER.some(sel => selectorReaches(sel, el));

/* The class attribute an element is BORN with, read out of the shipped markup
   rather than assumed. This is not decoration: `class="pane hidden"` on
   #progPane is the entire reason a selector written for land reached the
   Education Minister's catalogue. */
/* Throws on a miss rather than returning [], and does not care whether `class`
   comes before `id`. Both halves were live defects, and together they disarmed
   the check above this one.

   The old regex required `class="…" id="…"` in that order, so #g_ministry —
   shipped as `<div id="g_ministry" class="hidden">` — read as carrying no
   classes at all. And a miss returned [], which is indistinguishable from an
   element that genuinely has no class attribute. Combined: reordering
   #progPane's two attributes, a no-op edit, dropped `pane` out of its class
   set, so `.pane:not(.mine)` no longer reached the programme tiles and the
   check that exists to catch a pointer-dead catalogue passed on one.

   An element with an id but no class is still legal and still returns [] —
   that is a real answer. Only a missing id is a broken fixture. */
function markupClasses(id) {
  const tag = new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`).exec(src);
  if (!tag) throw new Error(
    `markupClasses: no element with id="${id}" in public/index.html — ` +
    'the fixture is reading markup that no longer exists');
  const cls = /\sclass="([^"]*)"/.exec(tag[0]);
  return cls ? cls[1].trim().split(/\s+/) : [];
}
const node = (id, classes, parent) => ({ id, classes: new Set(classes), parent });
/* #s_game > #g_ministry > the pane > … > the element in question. `.ro` comes
   from the shipped RO(), the pane's classes from the shipped markup as the
   shipped renderHall left them. */
function inPane(h, paneId, inner) {
  const game = node('s_game', h.ro() ? ['ro'] : [], null);
  let el = node(paneId, [...h.els[paneId].cl], node('g_ministry', markupClasses('g_ministry'), game));
  for (const [id, cls] of inner) el = node(id, cls, el);
  return el;
}

const paneStub = (base) => {
  const cl = new Set(base);
  return { innerHTML: '', textContent: '', cl, classList: {
    toggle(n, f){ if(f) cl.add(n); else cl.delete(n); },
    add(n){ cl.add(n); }, remove(n){ cl.delete(n); }, contains(n){ return cl.has(n); } } };
};
function hallHarness(role, sub, phase){
  const els = {};
  const $ = id => els[id] || (els[id] = paneStub(markupClasses(id)));
  const S = { role, phase: phase || 'game' };
  const C = E.blankCountry(); C.homeland = 'delta';
  const drawn = [];
  const renderHall = loadFn('renderHall', {
    S, C, HALL_SUB: sub || 'hbuild', $, ENGINE: E, RES: E.RES, esc: s => String(s),
    hallKind: loadFn('hallKind', { S }),
    canBuild: loadFn('canBuild', { S }), canSite: loadFn('canSite', { S }),
    renderPeople: k => drawn.push(['people', k]),
    renderLand:   k => drawn.push(['land', k]),
    renderTray:   k => drawn.push(['tray', k]),
    renderProgrammes: () => drawn.push(['prog']),
    /* Task 5: renderHall now prepends mandateBanner('build'/'site'/'programme')
       to its own panes on every call. This file is about the land and the
       catalogue, not the banner — tests/cabinet-screen.test.js owns that — so
       a silent stub keeps this harness green rather than throwing a
       ReferenceError for a free variable it never used to need. */
    mandateBanner: () => ''
  });
  return { renderHall, els, drawn, ro: loadFn('RO', { S }) };
}

/* renderProgrammes for real, so the class attribute its tiles carry is the
   shipped one rather than a guess. */
function progHtml(C){
  let html = '';
  loadFn('renderProgrammes', {
    PROGRAMMES: E.PROGRAMMES, METER_INFO: E.METER_INFO, C,
    esc: s => String(s), $: () => ({ set innerHTML(v){ html = v; } })
  })();
  return html;
}

check('the hall dimming rule reaches a land pane this device does not own', () => {
  /* An Education Minister: canBuild() is false, so #hbuildPane gets no .mine
     and the rule is meant to bite. Delete the rule (or comment it out) and this
     is the check that goes red. */
  const h = hallHarness('edu');
  h.renderHall();
  const plot = inPane(h, 'hbuildPane', [['hbuildLand', ['lg-grid','iso']], [null, ['lg-plot']]]);
  assert.ok(pointerOff(plot),
    'no shipped rule switches off a hall plot on a device that cannot write that land — a member can Tab and Enter straight onto it');
  const tile = inPane(h, 'hbuildPane', [['hbuildTiles', ['lg-tray']], [null, ['lg-tile']]]);
  assert.ok(pointerOff(tile), 'the tray tiles of an unowned hall land are still live');
});

check('the dimming rule lets go of the land this device IS allowed to write', () => {
  const h = hallHarness('infra');
  h.renderHall();
  const plot = inPane(h, 'hbuildPane', [['hbuildLand', ['lg-grid','iso']], [null, ['lg-plot']]]);
  assert.ok(!pointerOff(plot),
    'the Infrastructure Minister\'s own build land is dimmed — the .mine exemption is gone or renderHall stopped setting it');
});

/* The blocker this whole fix wave was sent back for. #progPane is a .pane, and
   renderProgrammes reuses .lg-tile for its cards with the "Run it" button
   nested INSIDE one — so `#s_game.ro .pane:not(.mine) .lg-tile` made all six
   cards pointer-events:none on the only device that has any use for them. No
   existing check could see it: the harness above stubs renderProgrammes and
   never asks about #progPane at all. */
check('the Education Minister can actually tap her own programme cards', () => {
  const h = hallHarness('edu');
  h.renderHall();
  assert.ok(!h.els.progPane.cl.has('hidden'),
    'the catalogue is hidden from the Education Minister');
  const cls = /<div class="([^"]*)"/.exec(progHtml({ coins: 300, programmes: [] }))[1]
                .trim().split(/\s+/);
  const card = inPane(h, 'progPane', [['progList', []], [null, cls]]);
  assert.ok(!pointerOff(card),
    'every programme card is pointer-events:none on the Education Minister\'s own device — the Run it button inside it cannot be tapped, and the catalogue exists for no one else');
});

check('the Leader can tap the programme cards too', () => {
  const h = hallHarness('leader', 'prog');
  h.renderHall();
  assert.ok(!h.els.progPane.cl.has('hidden'), 'the Leader\'s Programmes tab shows nothing');
  const cls = /<div class="([^"]*)"/.exec(progHtml({ coins: 300, programmes: [] }))[1]
                .trim().split(/\s+/);
  assert.ok(!pointerOff(inPane(h, 'progPane', [['progList', []], [null, cls]])),
    'the Leader\'s programme cards are dimmed');
});

check("renderHall marks the Infrastructure Minister's build pane as theirs", () => {
  const h = hallHarness('infra');
  h.renderHall();
  assert.ok(h.els.hbuildPane.cl.has('mine'),
    'the Infrastructure Minister\'s own land is left under the read-only dimming');
  assert.ok(!h.els.hindPane.cl.has('mine'),
    'Infrastructure was handed the Industry land as well — the server refuses that field');
  assert.ok(!h.els.hbuildPane.cl.has('hidden'), 'the build pane is hidden from the minister who owns it');
  assert.deepStrictEqual(h.drawn, [['people','hbuild'], ['land','hbuild'], ['tray','hbuild']]);
});

check("renderHall marks the Trade Minister's industry pane as theirs", () => {
  const h = hallHarness('trade');
  h.renderHall();
  assert.ok(h.els.hindPane.cl.has('mine'), 'the Trade Minister\'s own land is left dimmed');
  assert.ok(!h.els.hbuildPane.cl.has('mine'), 'Trade was handed the Build land as well');
  assert.deepStrictEqual(h.drawn, [['people','hind'], ['land','hind'], ['tray','hind']]);
});

check('the Leader gets the switcher and both lands; a minister never sees the switcher', () => {
  const leader = hallHarness('leader', 'hind');
  leader.renderHall();
  assert.ok(!leader.els.hallSub.cl.has('hidden'), 'the Leader has no way to reach the other two lands');
  assert.ok(/Programmes/.test(leader.els.hallSub.innerHTML), 'the switcher does not offer Programmes');
  assert.deepStrictEqual(leader.drawn, [['people','hind'], ['land','hind'], ['tray','hind']]);
  const infra = hallHarness('infra');
  infra.renderHall();
  assert.ok(infra.els.hallSub.cl.has('hidden'), 'a minister is shown a switcher between lands they do not hold');
});

/* A device that rejoins after the host has called the game still gets the hall
   UI — doCode() routes every phase that is not 'prep' to enterGame(). Before
   the guard in renderHall the land came up live: a tap incremented locally and
   said "built", the server skipped the field for 'final' and answered
   {ok:true}, so hallCommit had nothing to toast and the refresh behind it put
   the building back with no message anywhere. */
for (const phase of ['final', 'prep']) {
  check(`renderHall draws no land at all in phase '${phase}'`, () => {
    const h = hallHarness('infra', 'hbuild', phase);
    h.renderHall();
    assert.deepStrictEqual(h.drawn, [],
      `the build land was drawn and made tappable in phase '${phase}' — every tap on it is silently reverted`);
    for (const id of ['hbuildPane','hindPane','progPane'])
      assert.ok(h.els[id].cl.has('hidden'), `#${id} is on screen in phase '${phase}'`);
    assert.ok(h.els.hallSub.cl.has('hidden'), 'the pane switcher is still offered');
  });
}

check('and it says why, rather than showing an empty tab', () => {
  const h = hallHarness('infra', 'hbuild', 'final');
  h.renderHall();
  assert.ok(!h.els.hallShut.cl.has('hidden'),
    'the ministry tab is blank after the game is called — nothing on it says what happened');
  assert.ok(/called/i.test(h.els.hallShut.textContent),
    `the notice does not say the game has been called: ${JSON.stringify(h.els.hallShut.textContent)}`);
});

check('a running game is not shut down by the guard', () => {
  const h = hallHarness('edu');
  h.renderHall();
  /* Put back, not merely left alone: a host can set a room's phase back to
     'game' after calling it, and a notice that is only ever added would then
     sit over a live catalogue saying the game is over. */
  assert.ok(h.els.hallShut && h.els.hallShut.cl.has('hidden'),
    'renderHall does not put the "game has been called" notice away during the game — a room the host reopens keeps it on screen');
  assert.deepStrictEqual(h.drawn, [['prog']], 'the Education Minister lost her catalogue');
});

for (const [role, want] of [['infra','hbuild'], ['trade','hind'], ['edu',null],
                            ['def',null], ['leader',null], ['member',null]]) {
  check(`hallKind() for ${role} is ${want}`, () => {
    const fn = loadFn('hallKind', { S: { role }, HALL_SUB: 'hbuild' });
    assert.strictEqual(fn(), want);
  });
}

for (const [role, shown] of [['leader',true], ['infra',true], ['trade',true],
                             ['edu',true], ['def',false], ['member',false]]) {
  check(`the fifth tab is ${shown ? 'shown' : 'hidden'} for ${role}`, () => {
    const gtLabel = loadFn('gtLabel', { S: { role }, GT });
    const has = gtLabel().some(([k]) => k === 'ministry');
    assert.strictEqual(has, shown);
  });
}

check('gtLabel never mutates GT — four tabs in, four tabs still there', () => {
  const before = GT.length;
  loadFn('gtLabel', { S: { role: 'infra' }, GT })();
  loadFn('gtLabel', { S: { role: 'member' }, GT })();
  assert.strictEqual(GT.length, before, 'gtLabel pushed the fifth tab onto the shared GT array');
});

/* paintGame's three new lines — the gtLabel() strip, the GTAB reset, the
   'ministry' entry in the show/hide list — and the renderHall() call are all
   driven for real here. A grep over extractFn('paintGame') cannot pin any of
   them: 'ministry' appears twice in the function, so deleting either use
   leaves the other satisfying the pattern, and the reset can be satisfied by a
   comment. Every assertion below was confirmed by deleting the line it names. */
function paintHarness(role, tab){
  const els = {};
  const $ = id => els[id] || (els[id] = paneStub());
  /* The shipped markup: #g_country is the only game panel not born hidden.
     Modelling that is what makes "paintGame never un-hides it" detectable. */
  for (const id of ['g_scenario','g_trade','g_board','g_ministry']) $(id).classList.add('hidden');
  $('g_country');
  const S = { role, round:1, maxRounds:3, scenario:null, code:'QBXND', board:[] };
  const C = E.blankCountry(); C.name = 'Solaria'; C.coins = 10;
  const calls = [];
  const paintGame = loadFn('paintGame', {
    $, document: { querySelectorAll: () => [] },
    gtLabel: loadFn('gtLabel', { S, GT }), GTAB: tab,
    S, C, GAME: { rounds:3 }, ENGINE: E, esc: s => String(s),
    renderCity: () => {}, renderMeters: () => {},
    renderScenario: () => calls.push('scenario'), renderTrade: () => calls.push('trade'),
    renderBoard: () => calls.push('board'), renderHall: () => calls.push('hall'),
    /* Spec D's banner is not what this file is testing — a stub that draws
       nothing keeps this harness pinned to the fifth-tab dispatch it was
       built for. */
    strikeBanner: () => '', offersWaiting: () => 0, tradeShutFor: () => 0,
    roleCan: () => role === 'leader' || role === 'trade', RO: () => role !== 'leader'
  });
  return { paintGame, els, calls };
}

check('opening the fifth tab renders it — an un-hidden #g_ministry is an empty box until renderHall runs', () => {
  const h = paintHarness('infra', 'ministry');
  h.paintGame();
  assert.deepStrictEqual(h.calls, ['hall'],
    'paintGame showed #g_ministry without ever filling it: every pane inside ships hidden, so the Build tab lights up on a blank screen');
});

check('the fifth tab actually appears, and the other four go away', () => {
  const h = paintHarness('infra', 'ministry');
  h.paintGame();
  assert.ok(!h.els.g_ministry.cl.has('hidden'),
    '#g_ministry ships hidden and paintGame never un-hides it — the tab lights up and nothing appears');
  for (const id of ['g_country','g_scenario','g_trade','g_board'])
    assert.ok(h.els[id].cl.has('hidden'), `#${id} is still on screen underneath the ministry tab`);
});

check('the other four tabs neither render nor reveal the hall', () => {
  const h = paintHarness('infra', 'country');
  h.paintGame();
  assert.deepStrictEqual(h.calls, [], 'renderHall ran for a tab that is not the ministry tab');
  assert.ok(h.els.g_ministry.cl.has('hidden'), '#g_ministry stayed on screen behind My country');
  assert.ok(!h.els.g_country.cl.has('hidden'), 'My country is hidden on its own tab');
});

check('a device whose tab vanished on rejoin lands on My country, not a blank panel', () => {
  /* Defence has no fifth tab. A rejoin that turns this device from Infra into
     Defence while GTAB==='ministry' must not leave it staring at a hidden
     panel with no tab lit and no way back. */
  const h = paintHarness('def', 'ministry');
  h.paintGame();
  assert.ok(!h.els.g_country.cl.has('hidden'),
    'the device was left on a panel its role no longer has — GTAB was never reset');
  assert.ok(h.els.g_ministry.cl.has('hidden'), '#g_ministry is on screen for a Defence Minister');
  assert.deepStrictEqual(h.calls, [], 'renderHall ran for a role that has no ministry tab at all');
  const strip = h.els.gameTabs.innerHTML;
  assert.strictEqual((strip.match(/class="tab on"/g) || []).length, 1,
    'exactly one tab must be lit — without the reset none is, and the screen has no way back');
  assert.ok(/class="tab on"[^>]*gtab\('country'\)/.test(strip), 'the lit tab is not My country');
});

/* The tooltip is the only place the land itself states the removal rule, and a
   long-press on a shared iPad is how a student meets it. An unconditional "tap
   to take it back" is the screen promising precisely what lgTapPlot then
   refuses. */
function landTitles(kind, hall){
  const els = {};
  const $ = id => els[id] || (els[id] = { innerHTML:'', style:{}, parentElement:{},
    classList:{ toggle(){}, add(){}, remove(){} } });
  const home = E.BUILDINGS.find(b => b.key === 'home');
  loadFn('renderLand', {
    $, LG: { armed:null, kind:null }, LG_PLOTS: 2, LAND_N: 6, esc: s => String(s),
    landCells: () => [home], lgCounts: () => ({ home:1 }), lgDefs: () => E.BUILDINGS,
    lgHall: () => hall,
    landGeom: () => ({ tw:40, th:20, head:50, ox:0, oy:0 }), landIso: () => ({ x:0, y:0 }),
    drawLand: () => {}, landStart: () => {}
  })(kind);
  return els[kind + 'Land'].innerHTML;
}

check('a filled hall plot does not offer to give itself back', () => {
  const hall = landTitles('hbuild', true);
  assert.ok(!/take it back/.test(hall),
    'the hall land still promises a removal that lgTapPlot refuses outright');
  assert.ok(/stays up/.test(hall), 'the hall plot says nothing about the rule at all');
  const prep = landTitles('build', false);
  assert.ok(/take it back/.test(prep), 'prep lost its removal tooltip, which is still true there');
});

check('a filled hall plot cannot be taken back', () => {
  const counts = { home: 2 };
  const C = { buildings: counts, industries: {} };
  let applied = null;
  const lgTapPlot = loadFn('lgTapPlot', {
    C,
    lgCounts: () => counts,
    lgDefs: () => [{ key:'home', name:'Homes', need:{M:2,F:2} }],
    landCells: () => [{ key:'home', name:'Homes', need:{M:2,F:2} }],
    lgHall: () => true,
    lgApply: (k, key, d) => { applied = d; },
    lgSay: () => {},
    lgEffect: () => '',
    LG: { armed: null, kind: null },
    RES: [{ key:'M', name:'Materials' }, { key:'F', name:'Food' }]
  });
  lgTapPlot('hbuild', 0);
  assert.strictEqual(applied, null, 'tapping a built plot in the hall tried to remove it');
  assert.strictEqual(counts.home, 2, 'the count changed');
});

check('a hall placement commits, and hands over a copy of the counts, not the live bag', () => {
  const counts = { };
  const C = { buildings: counts, industries: {} };
  const commits = [];
  const redrawn = [];
  const lgTapPlot = loadFn('lgTapPlot', {
    C,
    lgCounts: () => counts,
    lgDefs: () => [{ key:'home', name:'Homes', need:{M:2,F:2} }],
    landCells: () => [],
    lgHall: () => true,
    lgApply: (k, key, d) => { counts[key] = (counts[key] || 0) + d; },
    lgSay: () => {},
    lgEffect: () => '',
    hallCommit: (k, want) => commits.push([k, want]),
    LG: { armed: 'home', kind: 'hbuild' },
    RES: [{ key:'M', name:'Materials' }, { key:'F', name:'Food' }],
    renderLand: k => redrawn.push(['land', k]), renderTray: k => redrawn.push(['tray', k])
  });
  lgTapPlot('hbuild', 0);
  assert.strictEqual(commits.length, 1, 'a hall placement did not reach the server at all');
  assert.deepStrictEqual(commits[0][1], { home: 1 }, 'the committed map is not what was just built');
  assert.notStrictEqual(commits[0][1], counts,
    'hallCommit was handed the live counts object — a poll can mutate it before the post goes out');
  /* build()/site() redraw the PREP land (renderBuildings writes #buildResRow),
     so without this the hall plots keep describing the land as it was until
     hallCommit's refresh returns — and a tap on the plot just built finds no
     cell there and answers "Pick something from the list first". */
  assert.deepStrictEqual(redrawn, [['land','hbuild'], ['tray','hbuild']],
    'a successful hall placement did not redraw its own land — the plot divs lag behind the building until the server answers');
});

check('a prep placement does not commit — the Next button still owns that', () => {
  const counts = {};
  const commits = [];
  const lgTapPlot = loadFn('lgTapPlot', {
    C: { buildings: counts, industries: {} },
    lgCounts: () => counts,
    lgDefs: () => [{ key:'home', name:'Homes', need:{M:2,F:2} }],
    landCells: () => [],
    lgHall: () => false,
    lgApply: (k, key, d) => { counts[key] = (counts[key] || 0) + d; },
    lgSay: () => {}, lgEffect: () => '',
    hallCommit: () => commits.push(1),
    LG: { armed: 'home', kind: 'build' },
    RES: [{ key:'M', name:'Materials' }, { key:'F', name:'Food' }],
    renderLand: () => {}, renderTray: () => {}
  });
  lgTapPlot('build', 0);
  assert.strictEqual(commits.length, 0, 'a prep placement posted to the server mid-step');
});

check('a hall tile wears its damage on its face, before it is armed', () => {
  /* In prep the cost of a tile can wait for the arm, because nothing is final
     until Next. In the hall the tap IS the commit. */
  const c = E.blankCountry(); c.homeland = 'delta';
  const el = { innerHTML: '' };
  const fact = E.INDUSTRIES.find(x => x.key === 'fact');   // G-6, E+3
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind:'hind', armed:null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO, esc: s => String(s),
    $: () => el, lgMeters: () => c.meters, lgHall: () => true,
    lgPreview: () => [{ k:'G', d:-6 }, { k:'E', d:3 }],
    trayModel: () => [{ def: fact, why: null }]
  });
  renderTray('hind');
  assert.ok(/Green -6/.test(el.innerHTML), 'the factory does not say what it costs Green');
  assert.ok(!/Economy 3/.test(el.innerHTML), 'the warning line is listing gains as if they were harm');
  assert.ok(/cannot take it back/.test(el.innerHTML), 'the hall tile does not say the tap is final');
});

check('a prep tile carries no such warning — nothing is final until Next', () => {
  const c = E.blankCountry(); c.homeland = 'delta';
  const el = { innerHTML: '' };
  const fact = E.INDUSTRIES.find(x => x.key === 'fact');
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind:'ind', armed:null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO, esc: s => String(s),
    $: () => el, lgMeters: () => E.foundingMeters(c), lgHall: () => false,
    lgPreview: () => { throw new Error('renderTray previewed every tile on a prep step'); },
    trayModel: () => [{ def: fact, why: null }]
  });
  renderTray('ind');
  assert.ok(!/cannot take it back/.test(el.innerHTML), 'prep is telling students the tap is final');
});

check('the hall gate line names Education instead of linking back to Policies', () => {
  const c = E.blankCountry(); c.homeland = 'delta';
  const el = { innerHTML: '' };
  const tour = E.INDUSTRIES.find(x => x.key === 'tour');   // req G 55
  const renderTray = loadFn('renderTray', {
    C: c, LG: { kind:'hind', armed:null }, ENGINE: E,
    RES: E.RES, METER_INFO: E.METER_INFO, esc: s => String(s),
    $: () => el, lgMeters: () => ({ ...c.meters, G: 40 }), lgHall: () => true,
    lgPreview: () => [],
    trayModel: () => [{ def: tour, why: 'Needs Green 55 — you have 40' }]
  });
  renderTray('hind');
  assert.ok(/Education Minister/.test(el.innerHTML),
    'a hall-locked industry does not say who can unlock it');
  assert.ok(!/goStep\(4\)/.test(el.innerHTML),
    'the hall tray still links back to Policies, a screen the mass game has left behind');
});

check('saveBody is untouched — the prep echo guard is still in place', () => {
  const body = src.slice(src.indexOf('function saveBody'), src.indexOf('async function save('));
  const min = body.slice(body.indexOf('const m = myMinistry()'));
  assert.ok(!/b\.buildings|b\.industries/.test(min),
    'a minister posts buildings or industries through saveBody — that is the prep echo, back again');
});

/* `html` is all six tiles concatenated, so a bare `.includes()`/`.test()`
   over the whole blob is satisfied by a decoy string dropped ANYWHERE in the
   .map() template, including one that renders unconditionally on every tile
   — the exact attack a reviewer found against the brief's own version of
   this check. Slicing out the one tile a given assertion is actually about,
   and pinning the literal rendered sentence rather than a loose word-alternation
   regex, is what makes a broken ternary the only way to satisfy it. Tiles are
   joined with no separator, but `<div class="lg-tile` only ever opens a new
   tile (the markup never nests one lg-tile inside another), so splitting on
   it is a safe boundary. */
function tileFor(html, key, PROGRAMMES) {
  const i = PROGRAMMES.findIndex(p => p.key === key);
  if (i < 0) throw new Error(`no programme with key ${key}`);
  const tiles = html.split('<div class="lg-tile').slice(1).map(t => '<div class="lg-tile' + t);
  if (tiles.length !== PROGRAMMES.length)
    throw new Error(`expected ${PROGRAMMES.length} tiles, found ${tiles.length} — the split boundary broke`);
  return tiles[i];
}

check('a bought programme is marked, and an unaffordable one says the price', () => {
  const PROGRAMMES = require('../game_engine.js').PROGRAMMES;
  const METER_INFO = require('../game_engine.js').METER_INFO;
  let html = '';
  const renderProgrammes = loadFn('renderProgrammes', {
    PROGRAMMES, METER_INFO,
    C: { coins: 30, programmes: ['literacy'] },
    esc: s => String(s),
    $: () => ({ set innerHTML(v){ html = v; } })
  });
  renderProgrammes();
  const dear = PROGRAMMES.find(p => p.cost > 30);
  const boughtTile = tileFor(html, 'literacy', PROGRAMMES);
  const dearTile = tileFor(html, dear.key, PROGRAMMES);
  /* The literal rendered sentence, not a loose /✅|done|already/i alternation
     — that alternation is broad enough that an unrelated future line like
     "already at maximum" would also satisfy it without actually marking
     anything as bought. */
  assert.ok(/✅ already running/.test(boughtTile), 'a bought programme is not marked as bought');
  assert.ok(!/you have \d+/.test(boughtTile), 'a bought programme also shows the unaffordable gap text');
  assert.ok(dearTile.includes(`you have 30`), 'an unaffordable programme does not say what is missing');
  assert.ok(dearTile.includes(dear.name), 'the unaffordable programme is not listed at all');
  assert.ok(!/✅ already running/.test(dearTile), 'an unaffordable programme is also marked as already bought');
});

/* The greyed COPY was pinned; the live BUTTON was not. Deleting the
   `${(had || poor) ? '' : …}` gate — leaving a working "Run it" on a programme
   already running, and on one the treasury cannot cover — left this file at
   40/40. A tap on either is a round trip that can only come back refused. */
check('the Run it button is on exactly the programmes that can be run', () => {
  const PROGRAMMES = require('../game_engine.js').PROGRAMMES;
  const METER_INFO = require('../game_engine.js').METER_INFO;
  let html = '';
  const renderProgrammes = loadFn('renderProgrammes', {
    PROGRAMMES, METER_INFO,
    C: { coins: 30, programmes: ['literacy'] },
    esc: s => String(s),
    $: () => ({ set innerHTML(v){ html = v; } })
  });
  renderProgrammes();
  /* heritage costs 26 against 30 coins and has not been bought: the one tile
     here that is genuinely runnable. */
  const affordable = PROGRAMMES.find(p => p.key !== 'literacy' && p.cost <= 30);
  assert.ok(affordable, 'no affordable unbought programme in this fixture — re-fixture the coins');
  const live = tileFor(html, affordable.key, PROGRAMMES);
  assert.ok(/<button[^>]*onclick="buyProgramme\('[^']+'\)"/.test(live),
    'a programme this country can afford and has not run has no Run it button — the catalogue is unbuyable');
  assert.ok(live.includes(`buyProgramme('${affordable.key}')`),
    'the button on this tile buys a different programme');
  const dear = PROGRAMMES.slice().sort((a, b) => b.cost - a.cost)[0];
  assert.ok(dear.cost > 30, 'the dearest programme is affordable here — re-fixture the coins');
  assert.ok(!/<button/.test(tileFor(html, dear.key, PROGRAMMES)),
    'an unaffordable programme still offers a live Run it button — the tap can only come back refused');
  assert.ok(!/<button/.test(tileFor(html, 'literacy', PROGRAMMES)),
    'a programme already running still offers a live Run it button — the tap can only come back refused');
});

(async () => {
  /* C and lgCounts are injected everywhere hallCommit is driven, and always
     hold something OTHER than the map being committed. That is deliberate: a
     commit that reaches for either must fail on the body it posted, with a
     message that says so, rather than throwing a ReferenceError somebody could
     make green again by widening this harness. */
  const commitHarness = (kind, want, reply) => {
    const posts = [], order = [];
    const C = { buildings: {}, industries: {} };
    const hallCommit = loadFn('hallCommit', {
      S: { code:'QBXND' }, C, lgCounts: () => C[kind === 'hbuild' ? 'buildings' : 'industries'],
      BUILDINGS: E.BUILDINGS,
      lgDefs: k => (k === 'hbuild' ? E.BUILDINGS : E.INDUSTRIES),
      api: (m, p, b) => { posts.push([m, p, b]); order.push('post'); return Promise.resolve(reply || {}); },
      toast: t => order.push('toast:' + t),
      refresh: () => { order.push('refresh'); return Promise.resolve(); },
      renderHall: () => order.push('render')
    });
    return hallCommit(kind, want).then(() => ({ posts, order }));
  };

  await checkAsync('hallCommit posts the one field the tap changed, under the country key', async () => {
    const { posts } = await commitHarness('hbuild', { home: 3 });
    assert.deepStrictEqual(posts, [['POST', '/api/team/save',
      { code:'QBXND', country:{ buildings:{ home:3 } } }]]);
  });

  await checkAsync('a hall industry posts industries, not buildings', async () => {
    const { posts } = await commitHarness('hind', { farm: 2 });
    assert.deepStrictEqual(posts[0][2].country, { industries:{ farm:2 } });
  });

  await checkAsync('hallCommit refreshes AFTER the post, so the screen shows the server\'s meters', async () => {
    const { order } = await commitHarness('hbuild', { home: 1 });
    assert.deepStrictEqual(order, ['post', 'refresh', 'render'],
      'the refresh did not follow the post — the meters on screen are the ones the tap did not cause');
  });

  await checkAsync('hallCommit posts the map it was handed, never the one C holds', async () => {
    /* The silent-vanish bug, made visible instead of described. In the hall
       applyServer() mirrors the server's country onto C on EVERY poll (see the
       Object.assign in applyServer, index.html:5770), so C can already hold a
       count the server reverted a moment ago. Here C deliberately disagrees
       with the map captured at tap time: ANY read of C or of lgCounts() — before
       an await or after one — posts the wrong number, which growCounts() then
       correctly ignores as a stale echo, and the building vanishes with no
       error anywhere. Both are injected so that a commit which reads them runs
       cleanly and fails on the posted body, rather than throwing a
       ReferenceError somebody could "fix" by widening the harness. */
    const C = { buildings: { home: 1 }, industries: { farm: 9 } };
    const posts = [];
    const hallCommit = loadFn('hallCommit', {
      S: { code:'QBXND' }, C, BUILDINGS: E.BUILDINGS,
      lgDefs: k => (k === 'hbuild' ? E.BUILDINGS : E.INDUSTRIES),
      lgCounts: () => C.buildings,
      api: (m, p, b) => { posts.push(b); return Promise.resolve({}); },
      toast: () => {}, refresh: () => Promise.resolve(), renderHall: () => {}
    });
    await hallCommit('hbuild', { home: 4 });
    assert.deepStrictEqual(posts, [{ code:'QBXND', country:{ buildings:{ home:4 } } }],
      'hallCommit posted what C holds instead of the map captured at tap time — a poll landing in between now silently loses the building');
  });

  await checkAsync('a refusal is spoken, not swallowed', async () => {
    const { order } = await commitHarness('hbuild', { home: 1 }, { error: 'Not your field.' });
    assert.ok(order.some(o => o === 'toast:Not your field.'),
      'the server refused the placement and the student was told nothing');
  });

  /* The server is the only thing that spends coins or moves meters (Task 6's
     resolved ambiguity #1), so buyProgramme must post and refresh without
     ever touching C itself — a refusal then simply arrives as unchanged
     state instead of a screen that has to be walked back. */
  await checkAsync('buyProgramme posts the key, refreshes, and never touches C itself', async () => {
    const posts = [], order = [];
    const C = { coins: 30, programmes: [] };
    const buyProgramme = loadFn('buyProgramme', {
      S: { code: 'QBXND' }, C, PROGRAMMES: E.PROGRAMMES,
      api: (m, p, b) => { posts.push([m, p, b]); order.push('post'); return Promise.resolve({ ok:true }); },
      toast: t => order.push('toast:' + t),
      refresh: () => { order.push('refresh'); return Promise.resolve(); },
      renderHall: () => order.push('render')
    });
    await buyProgramme('literacy');
    assert.deepStrictEqual(posts, [['POST', '/api/edu/programme', { code:'QBXND', key:'literacy' }]],
      'buyProgramme did not post the key under the shape the server expects');
    assert.deepStrictEqual(order, ['post', 'toast:Adult literacy drive is running.', 'refresh', 'render'],
      'buyProgramme did not refresh after the post — the coins on screen would be the ones the tap did not cause');
    assert.strictEqual(C.coins, 30, 'buyProgramme adjusted C.coins itself instead of leaving that to the server');
    assert.deepStrictEqual(C.programmes, [], 'buyProgramme adjusted C.programmes itself instead of leaving that to the server');
  });

  await checkAsync('a refusal from the server is spoken, and the screen is never refreshed on top of it', async () => {
    const order = [];
    const buyProgramme = loadFn('buyProgramme', {
      S: { code: 'QBXND' }, C: { coins: 1, programmes: [] }, PROGRAMMES: E.PROGRAMMES,
      api: () => { order.push('post'); return Promise.resolve({ error: 'Not enough coins.' }); },
      toast: t => order.push('toast:' + t),
      refresh: () => { order.push('refresh'); return Promise.resolve(); },
      renderHall: () => order.push('render')
    });
    await buyProgramme('literacy');
    assert.deepStrictEqual(order, ['post', 'toast:Not enough coins.'],
      'a refusal still refreshed or rendered instead of stopping at the toast');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
