/* Task 3 made the server publish pid, never code, on every shared payload —
   board rows, offers, allies. That guarantee is worthless if the client
   compares an incoming offer's `from` against the wrong field. S.pid is what
   the server just told this device its own public id is; C.pid is the same
   value copied onto the locally-held country object. Confusing C.pid for
   S.pid still works today because they happen to hold the same string right
   after a join or a refresh — but S is what every subsequent poll updates,
   and reverting either trade renderer (or the leaderboard's own-row
   highlight) from S.pid back to C.pid passes all 104 existing assertions
   unchanged. Only a source-level check on the shipped functions, in the idiom
   of tests/gostep.test.js, can catch that regression. */
const assert = require('assert');
const { extractFn } = require('./helpers');
const E = require('../game_engine.js');

/* A minimal stand-in for document.getElementById: enough state (innerHTML,
   textContent, dataset, classList, .open) for the three renderers below to
   read and write without throwing, and nothing more. */
function makeDom(){
  const els = new Map();
  return id => {
    if(!els.has(id)) els.set(id, {
      id, innerHTML:'', textContent:'', open:false, dataset:{},
      classList:{ toggle(){}, add(){}, remove(){} }
    });
    return els.get(id);
  };
}

/* renderBuildTrade, renderTrade and renderBoard all close over S, C, $ and a
   handful of helpers as free variables — exactly like goStep closes over ST
   in gostep.test.js. Evaluating all three together, with those names bound as
   parameters of one wrapping Function, reproduces that closure without
   pulling in the rest of the page (fetch, canvas, the DOM proper). */
function harness(){
  const $ = makeDom();
  /* role:'leader' — renderTrade() is now role-shaped (Task 11), and the
     pid-vs-pid regression these tests exist to pin is orthogonal to that: the
     leader sees the panel exactly as it always has, goods and alliance
     together, so defaulting to it keeps every existing assertion about the
     offer list and the "who" list meaning what it always meant. */
  const S = { pid:'MYPID', code:'LEADR', solo:false, role:'leader', board:[], offers:[], feed:[] };
  const C = E.blankCountry();
  const esc = s => String(s == null ? '' : s);
  const sumRes = () => 'x';
  const flagSVG = () => '<svg></svg>';
  const resInputs = () => '';
  const ACT_ROLES = { trade:['leader','trade'], ally:['leader','def'] };
  /* renderTrade now shuts itself while a scenario card is being discussed.
     The real discussLeft goes in rather than a stub, so these tests run the
     actual lock path — with no decideAt on S, the window is closed, which is
     the state every check below is about. roleCan() is real too, not stubbed
     — renderTrade() now calls it to decide which rows to show. */
  const src = extractFn('discussLeft') + '\n' + extractFn('roleCan') + '\n' +
    extractFn('fillCountryPicker') + '\n' + extractFn('tradeShutFor') + '\n' +
    extractFn('renderBuildTrade') + '\n' + extractFn('renderTrade') + '\n' + extractFn('renderBoard');
  /* Spec D's aid card is not what the pid-vs-pid regression below is about —
     a stub that draws nothing keeps this harness pinned to the "mine" check
     it was built for, the same treatment the paintGame harnesses got. */
  const aidCard = () => '';
  const fns = new Function(
    'S', 'C', '$', 'esc', 'sumRes', 'flagSVG', 'resInputs', 'ENGINE', 'RES', 'METER_KEYS', 'METER_INFO', 'ACT_ROLES', 'aidCard', `
    ${src}
    return { renderBuildTrade, renderTrade, renderBoard };
  `)(S, C, $, esc, sumRes, flagSVG, resInputs, E, E.RES, E.METER_KEYS, E.METER_INFO, ACT_ROLES, aidCard);
  return { ...fns, S, C, $ };
}

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

/* ---------------- renderBuildTrade (prep-stage trade panel) ---------------- */
(() => {
  const h = harness();
  h.S.code = 'LEADR'; h.S.solo = false;
  h.S.board = [
    { pid:'MYPID', name:'Mine' },
    { pid:'THEIRS', name:'Theirs' }
  ];

  check('renderBuildTrade lists another country by its pid, not by C.pid', () => {
    h.S.pid = 'MYPID';
    h.renderBuildTrade(false);
    const who = h.$('bt_to').innerHTML;
    assert.ok(who.includes('THEIRS'), 'the other country\'s pid was not shown');
    assert.ok(!who.includes('Mine'), 'my own country was not excluded from the "other countries" list');
  });

  check('renderBuildTrade renders no Accept button for an offer from my own pid', () => {
    h.S.pid = 'MYPID';
    h.S.offers = [{ id:'o1', from:'MYPID', to:'THEIRS', status:'pending', ally:false,
      give:{W:0,M:0,F:1}, want:{W:0,M:1,F:0}, fromName:'Mine', toName:'Theirs' }];
    h.$('btOffers').dataset.sig = undefined; // force a rebuild
    h.renderBuildTrade(false);
    assert.ok(!h.$('btOffers').innerHTML.includes('Accept'),
      'an offer this device itself sent showed an Accept button — S.pid was not used to identify "mine"');
  });

  check('renderBuildTrade DOES render an Accept button for an offer addressed to me', () => {
    h.S.pid = 'MYPID';
    h.S.offers = [{ id:'o2', from:'THEIRS', to:'MYPID', status:'pending', ally:false,
      give:{W:0,M:0,F:1}, want:{W:0,M:1,F:0}, fromName:'Theirs', toName:'Mine' }];
    h.$('btOffers').dataset.sig = undefined;
    h.renderBuildTrade(false);
    assert.ok(h.$('btOffers').innerHTML.includes('Accept'),
      'an offer addressed to me was not offered an Accept button');
  });

  /* The regression this pins: if the renderer used C.pid instead of S.pid, an
     offer this device sent (from S.pid, which the server actually assigned)
     would be judged "not mine" the moment C.pid drifts from S.pid — showing
     an Accept button on your own outgoing offer. */
  check('renderBuildTrade would misjudge "mine" if C.pid, not S.pid, were compared — pinning S.pid is used', () => {
    h.S.pid = 'MYPID';
    h.C.pid = 'SOME-OTHER-VALUE'; // C.pid deliberately diverges from S.pid
    h.S.offers = [{ id:'o3', from:'MYPID', to:'THEIRS', status:'pending', ally:false,
      give:{W:0,M:0,F:1}, want:{W:0,M:1,F:0}, fromName:'Mine', toName:'Theirs' }];
    h.$('btOffers').dataset.sig = undefined;
    h.renderBuildTrade(false);
    assert.ok(!h.$('btOffers').innerHTML.includes('Accept'),
      'with C.pid diverged from S.pid, my own offer grew an Accept button — the renderer is keying off C.pid');
  });
})();

/* ---------------- renderTrade (mass-game trade panel) ---------------- */
(() => {
  const h = harness();
  h.S.board = [
    { pid:'MYPID', name:'Mine' },
    { pid:'THEIRS', name:'Theirs' }
  ];

  check('renderTrade lists another country by its pid, not by C.pid', () => {
    h.S.pid = 'MYPID';
    h.renderTrade();
    const who = h.$('t_to').innerHTML;
    assert.ok(who.includes('THEIRS'), 'the other country\'s pid was not shown');
    assert.ok(!who.includes('Mine'), 'my own country was not excluded from the "other countries" list');
  });

  check('renderTrade renders no Accept button for an offer from my own pid', () => {
    h.S.pid = 'MYPID';
    h.S.offers = [{ id:'p1', from:'MYPID', to:'THEIRS', status:'pending', ally:false, coins:0,
      give:{W:0,M:0,F:1}, want:{W:0,M:1,F:0}, fromName:'Mine', toName:'Theirs' }];
    h.$('offerList').dataset.sig = undefined;
    h.renderTrade();
    assert.ok(!h.$('offerList').innerHTML.includes('Accept'),
      'an offer this device itself sent showed an Accept button — S.pid was not used to identify "mine"');
  });

  check('renderTrade would misjudge "mine" if C.pid, not S.pid, were compared — pinning S.pid is used', () => {
    h.S.pid = 'MYPID';
    h.C.pid = 'SOME-OTHER-VALUE';
    h.S.offers = [{ id:'p2', from:'MYPID', to:'THEIRS', status:'pending', ally:false, coins:0,
      give:{W:0,M:0,F:1}, want:{W:0,M:1,F:0}, fromName:'Mine', toName:'Theirs' }];
    h.$('offerList').dataset.sig = undefined;
    h.renderTrade();
    assert.ok(!h.$('offerList').innerHTML.includes('Accept'),
      'with C.pid diverged from S.pid, my own offer grew an Accept button — the renderer is keying off C.pid');
  });
})();

/* ---------------- renderBoard (leaderboard) ---------------- */
(() => {
  const h = harness();
  const meters = { E:50, H:50, S:50, K:50, D:50, G:50 };
  h.S.board = [
    { pid:'MYPID', name:'Mine', meters, coins:20, score:{ overall:70, balance:80 } },
    { pid:'THEIRS', name:'Theirs', meters, coins:20, score:{ overall:60, balance:75 } }
  ];
  h.S.pid = 'MYPID';
  h.renderBoard();

  check('renderBoard keys every row by pid, so a tap opens the right city', () => {
    const html = h.$('leaderboard').innerHTML;
    assert.ok(html.includes("openCity('MYPID')"), 'my own row does not open my city');
    assert.ok(html.includes("openCity('THEIRS')"), 'the other country\'s row does not open their city');
  });

  check('renderBoard no longer shows students a trade ID', () => {
    /* Countries are picked by name on the Trade tab now, so the ID is an
       internal key only. Showing it invites groups to swap it for nothing. */
    assert.ok(!/trade ID/i.test(h.$('leaderboard').innerHTML), 'the leaderboard still prints a trade ID');
  });

  check('renderBoard highlights the row matching S.pid, not C.pid', () => {
    h.C.pid = 'SOME-OTHER-VALUE'; // diverge C.pid from S.pid
    h.renderBoard();
    const html = h.$('leaderboard').innerHTML;
    const mineRow = html.split('<div class="lb"').find(chunk => chunk.includes('MYPID'));
    assert.ok(mineRow && mineRow.includes('border-color:var(--gold)'),
      'my own row lost its highlight once C.pid diverged from S.pid — the renderer is keying off C.pid');
  });
})();

/* ---------------- renderTrade's #aidBox: skip-if-unchanged ----------------
   Fix round 2 (review, Minor): renderTrade() runs from paintGame() on every
   ~2.2s poll, and rebuilds #aidBox from S.board every time — whose displaced
   counts tick down between polls, whether or not the card's own markup
   actually changed. Without a change-guard a tap on a Send button lands on a
   DOM node render just replaced out from under it, with no feedback — the
   same bug 687d830 already fixed for the host console's checkboxes.

   A dedicated harness, not `harness()` above: that one stubs aidCard as
   `() => ''` on purpose (Task 3's pid-vs-pid regression is not about the aid
   card), so it cannot see this guard at all. This one wires in the REAL
   aidCard, extracted the same way renderTrade itself is. */
(() => {
  const $ = makeDom();
  const S = { pid:'ZZZZZ', code:'X', solo:false, role:'trade', skew:0,
    board:[{ pid:'AAAAA', name:'Bakau', displaced:5, strk:'☠️' }], offers:[] };
  const C = E.blankCountry(); C.allies = [];
  const esc = s => String(s == null ? '' : s);
  const sumRes = () => 'x';
  const resInputs = () => '';
  const ACT_ROLES = { trade:['leader','trade'], ally:['leader','def'] };
  const src = extractFn('discussLeft') + '\n' + extractFn('roleCan') + '\n' +
    extractFn('aidCard') + '\n' + extractFn('fillCountryPicker') + '\n' + extractFn('tradeShutFor') + '\n' +
    extractFn('renderTrade');
  const fns = new Function(
    'S', 'C', '$', 'esc', 'sumRes', 'resInputs', 'ENGINE', 'RES', 'METER_KEYS', 'METER_INFO', 'ACT_ROLES', `
    ${src}
    return { renderTrade };
  `)(S, C, $, esc, sumRes, resInputs, E, E.RES, E.METER_KEYS, E.METER_INFO, ACT_ROLES);

  check('renderTrade does not rewrite #aidBox when the rendered markup has not changed', () => {
    fns.renderTrade();
    $('aidBox').innerHTML += '<!--tap-in-flight-->';
    fns.renderTrade();   // same S.board — nothing about the struck countries changed
    assert.ok($('aidBox').innerHTML.includes('tap-in-flight'),
      'aidBox was rewritten even though nothing about the struck countries changed — a tap mid-render would be silently dropped');
  });

  check('renderTrade DOES rewrite #aidBox once the underlying board actually changes', () => {
    $('aidBox').innerHTML += '<!--stale-->';
    S.board[0].displaced = 3;   // two people rehoused — the card's own count moves
    fns.renderTrade();
    assert.ok(!$('aidBox').innerHTML.includes('stale'),
      'aidBox was never rewritten at all — the guard is unconditional, not a real change-check');
  });
})();

if (fails) process.exit(1);
console.log('PASS  client identity — the trade renderers and the leaderboard key off S.pid, not C.pid');
