/* The client half. A minister device must not merely be refused by the server
   — it must not TRY, for the same reason member-mode.test.js exists: a save()
   firing on every step change fills the console with refusals and buries real
   errors.

   loadFn() gives the extracted function ONLY the names passed to it, so every
   helper the function calls has to be injected too, or the call dies with a
   ReferenceError that looks nothing like the bug being tested. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFn, loadConst, extractFn } = require('./helpers');
const E = require('../game_engine.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

const MIN = ['edu', 'def', 'trade', 'infra'];

/* The client's tables, pulled out of the page rather than retyped here — a
   copy in this file would pass while the shipped page was wrong, which is the
   one thing this test exists to catch. */
const ACT_ROLES = loadConst('ACT_ROLES');
const CARDS = loadConst('CARDS');

check('the client and the engine spell the ministries the same way', () => {
  /* loadConst() only matches an object literal, and MINISTRIES is an array —
     so this one is read straight out of the source. */
  const m = /^const MINISTRIES = (\[[^\]]*\]);/m.exec(APP);
  assert.ok(m, 'public/index.html has no top-level MINISTRIES array');
  assert.deepStrictEqual(eval(m[1]), MIN);
});

/* ---------- roleCan mirrors the server's table ---------- */
/* loadFn injects ONLY the names listed, so every global the extracted function
   touches has to be handed to it — ACT_ROLES included, or the call dies with a
   ReferenceError that looks nothing like the bug being tested. */
const roleCanFor = (role) => loadFn('roleCan', { S: { role }, ACT_ROLES });
const ministryFor = (role) => loadFn('myMinistry', { S: { role }, MINISTRIES: MIN });

check('the leader may do everything the client asks about', () => {
  const can = roleCanFor('leader');
  for (const act of ['save', 'trade', 'ally', 'choose', 'commit', 'hall'])
    assert.ok(can(act), `the leader was refused ${act} on the client`);
});

check('a watching device may do nothing', () => {
  const can = roleCanFor('member');
  for (const act of ['save', 'trade', 'ally', 'choose', 'commit', 'hall'])
    assert.ok(!can(act), `a class code was allowed ${act} on the client`);
});

check('Defence owns alliances and Trade owns goods, on the client too', () => {
  assert.ok(roleCanFor('trade')('trade'), 'Trade cannot send goods');
  assert.ok(!roleCanFor('trade')('ally'), 'Trade was allowed an alliance');
  assert.ok(roleCanFor('def')('ally'), 'Defence cannot propose an alliance');
  assert.ok(!roleCanFor('def')('trade'), 'Defence was allowed to send goods');
});

check('no ministry may decide, commit or move the country', () => {
  for (const m of MIN)
    for (const act of ['choose', 'commit', 'hall'])
      assert.ok(!roleCanFor(m)(act), `${m} was allowed ${act} on the client`);
});

check('Education owns programmes, on the client too', () => {
  assert.ok(roleCanFor('edu')('programme'), 'the Education Minister cannot run a programme');
  assert.ok(roleCanFor('leader')('programme'), 'the Leader cannot run a programme');
  for (const m of ['def', 'trade', 'infra'])
    assert.ok(!roleCanFor(m)('programme'), `${m} was allowed to run a programme on the client`);
  assert.ok(!roleCanFor('member')('programme'), 'a class code was allowed to run a programme');
});

/* ---------- the two copies, compared as WHOLE TABLES -----------------------
   Every check above walks a list of act names typed out here by hand, so an
   act that exists on only ONE side is invisible to all of them — which is
   exactly what happened: server.js grew `programme: ['leader','edu']` and the
   client's mirror did not, so roleCan('programme') answered false for
   everyone, and this file stayed green. README says the two copies "cannot
   quietly drift apart"; these two checks are what makes that true, for the
   next act as well as this one.

   server.js is required rather than re-typed, for the same reason the client's
   table is pulled out of the page: a third copy in this file would pass while
   a shipped one was wrong. Requiring it starts no listener — minister-roles
   .test.js has required it since ministries landed. */
const SRV = require('../server.js');

check('the client and the server list exactly the same acts', () => {
  assert.deepStrictEqual(Object.keys(ACT_ROLES).sort(), Object.keys(SRV.ACT_ROLES).sort(),
    'an act exists in one copy of ACT_ROLES and not the other — a button the client thinks nobody may press, or one it offers and the server refuses');
});

check('every act allows the same roles on both copies', () => {
  for (const act of Object.keys(SRV.ACT_ROLES))
    assert.deepStrictEqual(
      [...(ACT_ROLES[act] || [])].sort(), [...SRV.ACT_ROLES[act]].sort(),
      `the two copies disagree about who may ${act}`);
});

/* ---------- RO() fails closed ---------- */
check('RO() is true for everyone but the leader', () => {
  for (const role of ['member', ...MIN, '', undefined])
    assert.ok(loadFn('RO', { S: { role } })(),
      `RO() let role ${JSON.stringify(role)} through as a writer`);
  assert.ok(!loadFn('RO', { S: { role:'leader' } })(), 'RO() locked the leader out');
});

/* ---------- save() posts only what this device owns ---------- */
function bodyPostedBy(role, editingPicks) {
  const C = E.blankCountry();
  C.name = 'Solaria'; C.motto = 'Ad astra';
  C.picks = { edu:['a'], def:['b'], trade:['c'], infra:['d'] };
  C.buildings = { house:2 }; C.industries = { farm:1 };
  const S = { solo:false, code:'QBXND', role };
  /* saveBody() calls myMinistry(), which is a separate top-level function and
     therefore NOT in scope inside the extracted body — it has to be injected
     as a name of its own, already bound to this role. It also reads
     EDITING_PICKS as a free variable (a top-level `let` in the real page),
     so a caller that does not hand one over dies with a ReferenceError
     rather than seeing the "untouched" behaviour — default it to null here,
     exactly as the page does before any card is ever tapped. */
  const saveBody = loadFn('saveBody',
    { S, C, myMinistry: ministryFor(role), EDITING_PICKS: editingPicks ?? null });
  return saveBody();
}

/* Deliberately says nothing about b.picks here: an untouched leader (no
   EDITING_PICKS) posting every ministry's picks wholesale is exactly the
   regression the two checks below exist to catch — this one only pins the
   flat country fields, which the leader posts unconditionally regardless of
   which ministry tab, if any, they last touched. */
check('the leader still posts the whole country (its flat fields)', () => {
  const b = bodyPostedBy('leader');
  assert.strictEqual(b.name, 'Solaria');
  assert.ok(b.members && b.split && b.buildings && b.industries,
    'the leader stopped posting a field of the country it owns outright');
});

check('a ministry posts its own picks and nothing else', () => {
  for (const m of MIN) {
    const b = bodyPostedBy(m);
    assert.strictEqual(b.name, undefined, `${m} posted the country's name`);
    assert.strictEqual(b.members, undefined, `${m} posted the cabinet`);
    assert.strictEqual(b.split, undefined, `${m} posted the budget`);
    assert.strictEqual(b.ready, undefined, `${m} posted ready`);
    assert.ok(b.picks, `${m} posted no picks at all`);
    assert.deepStrictEqual(Object.keys(b.picks), [m],
      `${m} posted another ministry's picks — a stale copy would wipe them`);
  }
});

/* BLOCKER (final-branch review, fix 1): this used to assert the opposite —
   that Infrastructure posts buildings and Trade posts industries — because
   the server's FIELD_OWNER genuinely does grant those two ministries write
   access to those two fields. But renderMinistry() (the only screen a
   minister device ever shows) draws a policy grid and nothing else: no build
   land, no industry picker. So C.buildings/C.industries on an infra or trade
   device are never anything this device changed — only whatever
   applyServer() last mirrored down from the server. Posting them back is a
   stale echo of the Leader's own last save, and it silently reverts
   whatever the Leader most recently built or sited. Measured live before
   this fix: Leader builds a home, Infra Minister taps one policy card,
   Leader's home vanishes from the server, ok:true, nothing on screen. */
check('Infrastructure does not echo buildings, and Trade does not echo industries', () => {
  const infra = bodyPostedBy('infra'), trade = bodyPostedBy('trade');
  assert.strictEqual(infra.buildings, undefined,
    'Infrastructure posted buildings from a screen with no build UI — this reverts whatever the Leader actually built, on every ministry save');
  assert.strictEqual(trade.industries, undefined,
    'Trade & Industry posted industries from a screen with no siting UI — this reverts whatever the Leader actually sited, on every ministry save');
});

/* The behavioural half of the same fix: not just "the field is absent from
   the posted body" (which a source grep could also tell you) but "a real
   infra save, round-tripped through the real server, leaves the Leader's
   buildings exactly as the Leader left them" — the reproduction from the
   review, run for real. */
check('an infra device\'s save, sent to a fresh country with no C.buildings of its own, would carry none to post', () => {
  const C = E.blankCountry(); // exactly what a minister device starts from — see startSolo()/enterPrep()
  C.picks = { edu:[], def:[], trade:[], infra:['mixed'] }; // a policy tap
  const S = { solo:false, code:'QBXND', role:'infra' };
  const saveBody = loadFn('saveBody', { S, C, myMinistry: ministryFor('infra'), EDITING_PICKS: null });
  const b = saveBody();
  assert.deepStrictEqual(Object.keys(b), ['picks'],
    'an infra minister\'s save body carries a field besides picks — buildings would overwrite the Leader\'s with this device\'s stale/blank copy');
});

/* Final-branch review, fix 6: README.md used to claim "minCodes.trade …
   its industries" and "minCodes.infra … and its buildings" — true of the
   server's FIELD_OWNER, false of the app once fix 1 lands, since the
   minister screen has no UI that ever authors either field. Pinned here,
   next to the fix itself, so a future doc edit that reintroduces the false
   claim fails in the same file that proves the app-level fact wrong. */
check('README.md no longer claims the minister screen authors buildings or industries', () => {
  const tradeRow = /\|\s*`minCodes\.trade`[^\n]*\n/.exec(README);
  const infraRow = /\|\s*`minCodes\.infra`[^\n]*\n/.exec(README);
  assert.ok(tradeRow, 'README.md no longer documents minCodes.trade at all');
  assert.ok(infraRow, 'README.md no longer documents minCodes.infra at all');
  assert.ok(!/its industries/i.test(tradeRow[0]),
    'README.md still claims the Trade minister\'s code opens "its industries" — the minister screen has no siting UI');
  assert.ok(!/its buildings/i.test(infraRow[0]),
    'README.md still claims the Infrastructure minister\'s code opens "its buildings" — the minister screen has no build-land UI');
  assert.ok(/no (industry-siting|build-land) UI/.test(tradeRow[0] + infraRow[0]),
    'README.md dropped the claim but does not explain that the server grants the field while the app has no screen for it');
});

/* ---------- the leader does not wipe four ministries ---------- */
/* The regression this whole feature exists to stop, arriving through the one
   role that owns every field. Measured live against a correct server before
   this was written: four ministers pick their cards, the leader taps Next, and
   all four ministries come back empty with ok:true. */
check('a leader who has edited no ministry sends no picks at all', () => {
  const b = bodyPostedBy('leader');
  assert.strictEqual(b.picks, undefined,
    'a leader posted picks without having touched a card — that body overwrites every ministry');
});

check('a leader who has edited one ministry sends only that one', () => {
  const C = E.blankCountry();
  C.picks = { edu:['a'], def:['b'], trade:['c'], infra:['d'] };
  const S = { solo:false, code:'QBXND', role:'leader' };
  const saveBody = loadFn('saveBody', {
    S, C, myMinistry: ministryFor('leader'), EDITING_PICKS: 'def' });
  const b = saveBody();
  assert.deepStrictEqual(Object.keys(b.picks), ['def'],
    'the leader posted a ministry they were not editing — a stale copy wipes that ministry');
  assert.deepStrictEqual(b.picks.def, ['b']);
});

/* ---------- the minister's screen ---------- */
check('there is a minister screen, separate from the wizard', () => {
  assert.ok(/id="s_min"/.test(APP), 'no #s_min section — a minister lands on the leader\'s wizard');
  assert.ok(/function renderMinistry\(/.test(APP), 'renderMinistry() is missing');
});

check('show() knows about the minister screen', () => {
  /* show() hides every section it lists and reveals one. A section missing
     from that list is a section that never hides — two screens at once. */
  const m = /function show\(id\)\{[^}]*\}/.exec(APP);
  assert.ok(m, 'could not find show()');
  assert.ok(m[0].includes('s_min'), 'show() does not hide the minister screen');
});

check('a minister with no budget is told why, not shown an empty grid', () => {
  assert.ok(/waiting for your Leader/i.test(APP),
    'a minister whose Leader has not set a budget sees nothing explaining it');
});

check('the minister screen names the ministry and the country', () => {
  const fn = /function renderMinistry\(\)[\s\S]*?\n\}/.exec(APP);
  assert.ok(fn, 'could not extract renderMinistry()');
  assert.ok(/ROLES/.test(fn[0]), 'the screen does not use the app\'s own ministry names');
  assert.ok(/C\.name/.test(fn[0]), 'the screen never says which country this is');
});

check('a minister\'s tap is remembered locally until it saves', () => {
  const fn = /function toggleCard\([\s\S]*?\n\}/.exec(APP);
  assert.ok(fn, 'could not extract toggleCard()');
  assert.ok(/LOCAL_PICKS/.test(fn[0]),
    'toggleCard does not set LOCAL_PICKS — a poll between tap and save snaps the card back off');
});

/* ---------- EDITING_PICKS is not sticky ----------
   Task 9's review: as first written, EDITING_PICKS is set by a tap and never
   cleared, so a Leader who edits Education and then moves on pins Education to
   this device's stale snapshot forever — the Education Minister's real work is
   silently overwritten by the next save() the Leader's device makes, on ANY
   later step. The fix derives it from what is actually on screen, which means
   two separate places have to let go of a ministry they are no longer looking
   at: the tab switcher (moving within the Policies step) and paintStep()
   (leaving the Policies step altogether). Both are asserted here so either one
   regressing back to "set once, never cleared" fails loudly. */
check('switching ministry tabs drops EDITING_PICKS — moving to Defence no longer posts Education', () => {
  const fn = /function renderCards\(\)[\s\S]*?\n\}/.exec(APP);
  assert.ok(fn, 'could not extract renderCards()');
  /* Pinned to the exact onclick, not merely the substring "EDITING_PICKS =
     null" anywhere in the function — a reviewer proved that weaker regex
     survives a guard that can never fire (see the paintStep() check below),
     and the same trick works here: dead code containing the same characters
     would still satisfy a bare substring match. */
  assert.ok(/onclick="MIN='\$\{k\}';EDITING_PICKS=null;renderCards\(\)"/.test(fn[0]),
    'the tab switcher no longer clears EDITING_PICKS on every tab click — a Leader who edits Education, then taps the Defence tab, still posts Education on every later save()');
});

check('leaving the Policies step drops EDITING_PICKS — walking away does not pin a ministry forever', () => {
  const fn = /function paintStep\(\)[\s\S]*?\n\}/.exec(APP);
  assert.ok(fn, 'could not extract paintStep()');
  /* Pinned to the guard AND the assignment together. A reviewer demonstrated
     that asserting only "EDITING_PICKS = null appears somewhere in
     paintStep()" survives changing the condition to `if(ST === 999)` —
     unreachable, so the clear never actually fires, yet the substring is
     still there. This regex requires the literal `ST !== 4` test attached to
     the assignment, so that regression fails loudly instead of passing. */
  assert.ok(/if\(ST\s*!==\s*4\)\s*EDITING_PICKS\s*=\s*null;/.test(fn[0]),
    'paintStep() does not clear EDITING_PICKS specifically on leaving step 4 (Policies) — a Leader who taps one Education card and walks on to another step pins Education to a stale snapshot until they reopen Policies');
});

/* ---------- bump()'s local clear must actually get posted ----------
   Final-branch review, fix 5: dropping a ministry's budget below what it has
   already spent clears C.picks[k] locally and toasts "That ministry lost a
   card" — but bump() never touched EDITING_PICKS, so saveBody() (the leader
   branch) posts no picks at all unless SOME tab happens to be the one last
   opened. The very next picks-mirror then puts the "lost" card straight back
   onto the grid (~2.5s later, on the next poll) — worse than doing nothing,
   because the ministry is now silently locked out of adding any new card
   (ENGINE.spent still counts the phantom pick against the cap) until someone
   notices and reopens that ministry's tab by hand.

   Run the REAL bump() in one shared Function() scope (the same idiom
   editingWindowHarness() below uses for toggleCard()/save()/saveBody()) so a
   reassignment inside bump() is actually visible afterward — three
   independent loadFn() calls would each shadow EDITING_PICKS as a local
   parameter and never let the others see it change. */
function bumpHarness(saveImpl){
  const S = { role:'leader', solo:false, code:'QBXND' };
  const C = E.blankCountry();
  C.split = { edu:4, def:6, trade:6, infra:6 };
  C.picks = { edu:['free'], def:[], trade:[], infra:[] }; // 'free' costs 4 — spent(edu) === cap(edu)
  const GAME = { minMinistry:0, maxMinistry:24, pointPool:24 };
  /* bump() now calls save() and tears its own EDITING_PICKS pin down through
     TAP_SAVES exactly as toggleCard() does — see the second wave of fix 5
     below. Both have to be injected, or the extracted body dies with a
     ReferenceError before either of the checks immediately below (which
     only look at the synchronous half, before any save resolves) ever run. */
  const save = saveImpl || (() => Promise.resolve());
  const body = extractFn('bump') +
    '\nreturn { bump, getEditingPicks: () => EDITING_PICKS, getTapSaves: () => TAP_SAVES };';
  const make = new Function('S', 'C', 'GAME', 'ENGINE', 'toast', 'renderSplit', 'save', 'EDITING_PICKS', 'TAP_SAVES', body);
  const h = make(S, C, GAME, E, () => {}, () => {}, save, null, {});
  return { h, S, C };
}
check('dropping a ministry\'s budget below its spend sets EDITING_PICKS — the clear reaches the next save()', () => {
  const { h, C } = bumpHarness();
  h.bump('edu', -1); // split.edu: 4 -> 3, but spent(edu) is still 4 -> the ministry "lost a card" branch fires
  assert.deepStrictEqual(C.picks.edu, [], 'bump() did not actually clear the overspent ministry\'s picks');
  assert.strictEqual(h.getEditingPicks(), 'edu',
    'bump() cleared picks.edu locally but left EDITING_PICKS untouched — saveBody() (leader branch) posts no picks at all unless a tab happens to already be pinned, so the server\'s stale copy of picks.edu snaps the "lost" card straight back onto the grid on the next poll, and the ministry is locked out of adding a replacement until someone notices');
});
check('bump() leaves EDITING_PICKS alone when nothing was actually lost', () => {
  const { h, C } = bumpHarness();
  C.split.edu = 6; C.picks.edu = ['free']; // spent(edu)=4, well under the new cap of 6
  h.bump('edu', -1); // split.edu: 6 -> 5, still >= spent — no card lost
  assert.deepStrictEqual(C.picks.edu, ['free'], 'a bump with no overspend touched picks it should not have');
  assert.strictEqual(h.getEditingPicks(), null,
    'bump() pinned EDITING_PICKS even though nothing was cleared — this would post an empty picks.edu over a real, unrelated edit on the very next save()');
});

/* ---------- bump()'s pin must not survive into a step it never touches ----------
   Second pass on fix 5, from the coordinator's own review of the first pass:
   setting EDITING_PICKS=k with no teardown just relocates the "cleared only by
   a view change" bug toggleCard() already had to solve. bump() only ever runs
   on the Points step (ST 3); paintStep()'s only clear is `if(ST !== 4)`, which
   does nothing for a pin set on ST 3 — it is already "not 4". So the pin rides
   straight through the step into Policies (ST 4), where MIN defaults to 'edu'
   and the Leader lands on the exact tab already pinned, never touching it.

   Reproduced here as the coordinator described it: bump Education down (fires
   its own save — awaited below, exactly as a real network round trip would
   resolve before the next poll arrives), then a poll comes back carrying the
   Education Minister's real, budget-fitting pick. If the pin is still up, the
   leader-picks merge in applyServer() forces C.picks.edu back to this device's
   local (now empty) copy, masking the Minister's save in the UI — and the very
   next saveBody() posts that empty copy over it for real. Runs bump(), save(),
   saveBody() and applyServer() together in one Function() scope (the same
   idiom editingWindowHarness() below uses) so a reassignment inside bump() is
   actually visible to saveBody() and applyServer() afterward. */
function bumpStepMaskHarness(){
  const S = { role:'leader', solo:false, code:'QBXND', phase:'prep', offers:[], board:[] };
  const C = E.blankCountry();
  C.split = { edu:4, def:6, trade:6, infra:6 };
  C.picks = { edu:['free'], def:[], trade:[], infra:[] };
  const posted = [];
  const api = (method, path, body) => Promise.resolve().then(() => { posted.push(body); return { ok:true }; });
  const body = extractFn('bump') + '\n' + extractFn('save') + '\n' + extractFn('saveBody') + '\n' + extractFn('applyServer') +
    '\nreturn { bump, save, saveBody, applyServer, getEditingPicks: () => EDITING_PICKS };';
  const make = new Function('S', 'C', 'GAME', 'ENGINE', 'toast', 'renderSplit', 'api', 'roleCan', 'MIN', 'myMinistry', 'RO',
    'ST', 'renderBuildings', 'newlyAccepted', 'playTrade', 'LOCAL_PICKS', 'EDITING_PICKS', 'TAP_SAVES', body);
  const h = make(S, C, { minMinistry:0, maxMinistry:24, pointPool:24 }, E, () => {}, () => {}, api, () => true, 'edu',
    () => '', () => false, 4, () => {}, () => [], () => {}, null, null, {});
  return { h, S, C, posted };
}
/* Invoked from inside the main async IIFE below (after settle() exists) —
   see the block that calls bumpStepMaskHarness(). */

/* ---------- the protection window closes once the save it covers lands ----------
   Reviewer finding on the first pass: clearing EDITING_PICKS/LOCAL_PICKS only
   on a view change (a different tab, a different step) shrinks the original
   "set once, never cleared" bug from permanent to one-shot — it does not
   remove it. A Leader who taps a card and then sits on the SAME tab still has
   a live save() in flight; if the Minister's own edit lands on the server
   before that save resolves, the Leader's save silently overwrites it, and
   nothing on either screen shows anything went wrong (the Minister's device
   restores its own picks locally via LOCAL_PICKS, which was never cleared
   either, so the deleted card just sits there ticked).
   toggleCard() now awaits its own save() and clears whichever flag it set —
   but only once every save it is covering (TAP_SAVES) has landed, so a
   second rapid tap is not torn down early either. These two checks run the
   REAL toggleCard(), save() and saveBody() together in one shared scope (not
   three separate loadFn() calls) specifically so a reassignment inside
   toggleCard() is visible to saveBody() afterwards — three independent
   `new Function()` calls would each shadow EDITING_PICKS/LOCAL_PICKS as a
   local parameter and never let the others see it change. */
function editingWindowHarness(role){
  const S = { role, solo:false, code:'QBXND' };
  const C = E.blankCountry();
  C.split = { edu:6, def:6, trade:6, infra:6 };
  C.picks = { edu:[], def:[], trade:[], infra:[] };
  const posted = [];
  const api = (method, path, body) => Promise.resolve().then(() => { posted.push(body); return { ok:true }; });
  const body = extractFn('toggleCard') + '\n' + extractFn('save') + '\n' + extractFn('saveBody') +
    '\nreturn { toggleCard, save, saveBody, ' +
    'getEditingPicks: () => EDITING_PICKS, getLocalPicks: () => LOCAL_PICKS, getTapSaves: () => TAP_SAVES };';
  const make = new Function('S', 'C', 'MIN', 'myMinistry', 'CARDS', 'ENGINE', 'toast', 'roleCan', 'api',
    'renderMinistry', 'renderCards', 'LOCAL_PICKS', 'EDITING_PICKS', 'TAP_SAVES', body);
  const h = make(S, C, role === 'leader' ? 'edu' : role,
    () => (MIN.includes(role) ? role : ''), CARDS, E, () => {}, () => true, api,
    () => {}, () => {}, null, null, {});
  return { h, S, C, posted };
}
/* toggleCard() fires save().then(...) without returning the promise, so the
   caller cannot await toggleCard() itself — only wait for its microtasks
   (the stub api() above, save()'s own await, and the .then() callback) to
   have all had a turn. A macrotask tick guarantees every microtask queued
   before it has drained, which a fixed number of chained Promise.resolve()s
   would not robustly guarantee as the call chain's depth changes. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  {
    const { h, C } = editingWindowHarness('leader');
    h.toggleCard('free'); // MIN='edu' inside the harness — see editingWindowHarness()
    await settle();
    check('a Leader\'s save landing clears EDITING_PICKS — a later save() posts no picks', () => {
      assert.strictEqual(h.getEditingPicks(), null,
        'EDITING_PICKS is still set once the tap\'s save has landed — the Leader\'s next save (e.g. pressing Next while still on this tab) will post a stale copy over the Minister\'s next real edit');
      const b = h.saveBody();
      assert.strictEqual(b.picks, undefined,
        'a later saveBody() still posted picks after the tap\'s save had already landed');
    });
  }
  {
    const { h } = editingWindowHarness('edu');
    h.toggleCard('free');
    await settle();
    check('a Minister\'s save landing clears LOCAL_PICKS — a poll is free to mirror the ministry again', () => {
      assert.strictEqual(h.getLocalPicks(), null,
        'LOCAL_PICKS is still set once the tap\'s save has landed — a card removed by this same Minister on another device, or corrected by a teacher, would be silently restored on every poll forever');
    });
  }
  {
    const { h, C } = bumpStepMaskHarness();
    h.bump('edu', -1); // ST 3 (Points): split.edu 4 -> 3, spent still 4 -> picks.edu cleared, EDITING_PICKS='edu', save() fired
    await settle(); // the bump's own save lands — a real network round trip finishing before the next poll, exactly as it would in the room
    // ...the group moves on to ST 4 (Policies) — nothing runs here on purpose:
    // this reproduction is specifically that NEITHER stepping the wizard NOR
    // any tab click is what has to clear the pin, because MIN defaults to
    // 'edu' and the Leader may never touch the tab at all.
    const skillsPick = 'skills'; // a real, cheaper Education card — what the Minister actually chose to fit the new 3-pt budget
    const pollFromServer = { phase:'prep', round:0, maxRounds:3, scenario:null, card:null, kind:'class',
      decideAt:0, now:Date.now(), board:[], offers:[], feed:[],
      team:{ ...E.blankCountry(), split:{ edu:3, def:6, trade:6, infra:6 },
        picks:{ edu:[skillsPick], def:[], trade:[], infra:[] } } };
    h.applyServer(pollFromServer);
    check('a poll landing after a bump-and-step does not mask the Minister\'s new pick in C', () => {
      assert.deepStrictEqual(C.picks.edu, [skillsPick],
        `applyServer() left C.picks.edu as ${JSON.stringify(C.picks.edu)} instead of adopting the Minister's real pick ${JSON.stringify([skillsPick])} — bump()'s EDITING_PICKS pin from the Points step is still up on the Policies step, so the leader-picks merge forced C.picks.edu back to this device's own stale (emptied-by-the-bump) copy`);
    });
    check('...and the next save does not then wipe that pick off the server for real', () => {
      const b = h.saveBody();
      assert.strictEqual(b.picks, undefined,
        `saveBody() still posted picks (${JSON.stringify(b && b.picks)}) after the bump's own save had already landed — the next Next press would overwrite the Minister's real pick with this stale copy`);
    });
  }

  check('a tap on a committed country is refused, not saved, and says why', () => {
    const C = E.blankCountry();
    C.locked = true;
    C.split = { edu:6, def:6, trade:6, infra:6 };
    C.picks = { edu:['free'], def:[], trade:[], infra:[] };
    const toasts = [];
    let saveCalls = 0;
    const toggleCard = loadFn('toggleCard', {
      S: { role:'edu' }, C, MIN:'edu', myMinistry: () => 'edu', CARDS, ENGINE: E,
      toast: (m) => toasts.push(m),
      LOCAL_PICKS: null, EDITING_PICKS: null, TAP_SAVES: {},
      save: () => { saveCalls++; return Promise.resolve(); },
      renderMinistry: () => {}, renderCards: () => {}
    });
    /* 'biling' is not already picked — if the locked guard failed, this call
       would push it onto C.picks.edu and call save(). */
    toggleCard('biling');
    assert.deepStrictEqual(C.picks.edu, ['free'],
      'a tap on a committed country changed C.picks — the grid looked live when nothing was going to save');
    assert.strictEqual(saveCalls, 0, 'a tap on a committed country called save() — the server would have refused it anyway, but only after a network round trip');
    assert.ok(toasts.some(m => /committed/i.test(m)),
      'a tap on a committed country produced no toast — nothing told the student why nothing happened');
  });

  /* ---------- the page still parses ---------- */
  check('public/index.html has no unbalanced script block', () => {
    const opens = (APP.match(/<script/g) || []).length;
    const closes = (APP.match(/<\/script>/g) || []).length;
    assert.strictEqual(opens, closes, 'a <script> tag was left open');
  });

  /* ---------- the hall ---------- */
  /* Task 9 made RO() fail closed, which locked every ministry out of everything.
     These are the call sites that have to be opened again, and no others — a
     ministry that can still commit the country means a call site was opened by
     reflex rather than by decision. */
  const sourceOf = (name) => {
    const re = new RegExp('^(async )?function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = re.exec(APP);
    assert.ok(m, 'could not find ' + name + '()');
    return m[0];
  };

  check('sending an offer asks about the offer, not about being the leader', () => {
    const src = sourceOf('sendOffer');
    assert.ok(/roleCan\(/.test(src), 'sendOffer() still gates on RO() alone');
    assert.ok(/ally/.test(src), 'sendOffer() does not distinguish an alliance from goods');
  });

  check('answering an offer asks what kind of offer it is', () => {
    const src = sourceOf('respond');
    assert.ok(/roleCan\(/.test(src), 'respond() still gates on RO() alone');
  });

  check('building asks Infrastructure and siting asks Trade', () => {
    const src = sourceOf('lgApply');
    /* Task 4 moved the role-specific question out of lgApply's own body and
       into LG_KIND[kind].can — canBuild for 'build'/'hbuild', canSite for
       'ind'/'hind' (they mirror server.js's FIELD_OWNER table, not
       ACT_ROLES). This can only confirm lgApply() itself still asks a
       PER-KIND question — `LG_KIND[kind].can()` reads a different function
       for a different kind, unlike a single roleCan('leader') would — not
       that the table wires the right role to the right kind. That wiring is
       pinned structurally by tests/build-grid.test.js's "LG_KIND wires each
       land kind to its own role check and its own writer" check, which reads
       the real LG_KIND text and fails if the rows are swapped. */
    assert.ok(/roleCan\(|myMinistry\(|canBuild\(|canSite\(|LG_KIND\[kind\]\.can\(\)/.test(src),
      'lgApply() gates both building and siting on one leader-only check');
  });

  check('deciding, committing and the hall stay the leader\'s', () => {
    for (const fn of ['decide', 'doCommit', 'doJoinHall', 'goReady', 'practiceChoose']) {
      const src = sourceOf(fn);
      assert.ok(/RO\(\)/.test(src),
        `${fn}() no longer gates on RO() — a ministry may now do it`);
    }
  });

  /* ---------- the hall, behaviourally ----------
     The four source-grep checks above can only tell "roleCan( appears
     somewhere in this function" from "roleCan( is absent" — they cannot tell
     right from wrong. A reviewer sabotaged a scratch copy four ways, each one
     keeping every literal token those checks look for, and 1004/1004 stayed
     green for three of the four (the fourth — swapping lgApply's roles — was
     already caught by tests/build-grid.test.js's behavioural check). These
     three run the REAL functions and assert the actual behaviour a swap
     would invert, closing that gap for the other three. A minimal DOM stub
     — enough state for $() to be read and written without throwing, nothing
     more — since none of these three touch anything a browser would supply
     beyond that. */
  function makeDom(){
    const els = new Map();
    return id => {
      if (!els.has(id)) {
        const classes = new Set();
        els.set(id, {
          id, innerHTML:'', textContent:'', value:'', checked:false, open:false,
          dataset:{}, disabled:false, style:{},
          classList:{
            toggle(name, force){
              const on = force === undefined ? !classes.has(name) : !!force;
              if (on) classes.add(name); else classes.delete(name);
              return on;
            },
            add(name){ classes.add(name); }, remove(name){ classes.delete(name); },
            contains(name){ return classes.has(name); }
          }
        });
      }
      return els.get(id);
    };
  }

  {
    /* Catches the sabotage `roleCan(wantsAlly ? 'trade' : 'ally')` — Trade
       owns goods, not alliances. A Defence Minister who has NOT ticked the
       alliance box is asking to send goods, which is refused before the
       network is ever touched. */
    const $ = makeDom();
    let apiCalls = 0;
    const sendOfferDef = loadFn('sendOffer', {
      $, S: { solo:false, code:'QBXND', role:'def' },
      roleCan: roleCanFor('def'),
      api: () => { apiCalls++; return Promise.resolve({}); },
      toast: () => {}, refresh: async () => {}
    });
    await sendOfferDef();
    check('a Defence Minister with the alliance box unticked cannot send goods', () => {
      assert.strictEqual(apiCalls, 0,
        'a Defence Minister sending an un-ticked (goods) offer reached the network — Trade owns goods, not Defence');
    });
  }

  {
    /* Catches the sabotage `roleCan(offer.ally ? 'trade' : 'ally')` on the
       answering side — the same swap as sendOffer's, applied to respond()
       instead. Not one of the three the coordinator named, but the same
       reviewer sabotage table lists it as passing 1004/1004 before this fix,
       and confirming "all four now fail" needs a check for all four, not
       three. An alliance offer answered by a Trade device must be refused
       before the network is touched. */
    const $ = makeDom();
    let apiCalls = 0;
    const respondTrade = loadFn('respond', {
      S: { solo:false, code:'QBXND', role:'trade', offers:[{ id:'o1', ally:true }] },
      roleCan: roleCanFor('trade'),
      api: () => { apiCalls++; return Promise.resolve({}); },
      toast: () => {}, refresh: async () => {}
    });
    await respondTrade('o1', true);
    check('a Trade Minister cannot answer an alliance offer', () => {
      assert.strictEqual(apiCalls, 0,
        'a Trade Minister answering an alliance offer reached the network — alliances are Defence\'s to answer');
    });
  }

  {
    /* Catches the sabotage that swaps which half of renderTrade() shows for
       which role (Step 4 fully inverted). A Defence Minister must see the
       alliance proposal and no goods rows — the opposite of the Leader's and
       Trade's view. */
    const $ = makeDom();
    const S = { role:'def', pid:'MYPID', code:'QBXND', solo:false, board:[], offers:[] };
    const renderTradeDef = loadFn('renderTrade', {
      $, S, roleCan: roleCanFor('def'), discussLeft: () => 0,
      esc: s => String(s == null ? '' : s), sumRes: () => 'x', resInputs: () => '',
      /* Spec D's aid card is not what this test is testing — a stub that
         draws nothing keeps this harness pinned to the goods/alliance-row
         split it was built for. C is otherwise unused by renderTrade(). */
      C: { allies: [] }, aidCard: () => '',
      fillCountryPicker: () => {}, tradeShutFor: () => 0
    });
    renderTradeDef();
    check('a Defence Minister sees the alliance card and no goods card', () => {
      assert.ok($('goodsCard').classList.contains('hidden'),
        'a Defence Minister was shown the goods card — Trade owns goods, not Defence');
      assert.ok(!$('allyCard').classList.contains('hidden'),
        'a Defence Minister was not shown the alliance card — alliances are Defence\'s to propose');
    });
  }

  {
    /* Catches the sabotage `||` in place of `&&` in paintGame()'s trade-shaped
       flag, which locks Trade and Defence back out of #g_trade — Task 11
       undone. Also pins the split from Important 1's fix: #s_game's own .ro
       class (which dims the scenario cards) must stay driven by RO() even
       for a role #g_trade leaves enabled, or Trade/Defence get live,
       tappable scenario cards that decide() still refuses. */
    const $ = makeDom();
    const S = { role:'trade', round:1, maxRounds:3, scenario:null, code:'QBXND', board:[] };
    const C = E.blankCountry(); C.name = 'Solaria'; C.coins = 10;
    const tradeEls = [{ disabled:false }, { disabled:false }];
    const doc = { querySelectorAll(sel){ return sel.includes('#g_trade') ? tradeEls : []; } };
    /* Spec B: the tab strip comes from gtLabel(), which appends a fifth
       role-shaped tab. Only the 'country' branch is under test here, and a
       one-entry stub also keeps GTAB='country' a tab that still exists. */
    const paintGameTrade = loadFn('paintGame', {
      $, document: doc,
      gtLabel: () => [['country','🏙️','My country']], GTAB: 'country',
      S, C, GAME: { rounds:3 },
      renderCity: () => {}, renderMeters: () => {},
      /* Spec D's banner is not what this file is testing — a stub that draws
         nothing keeps this harness pinned to the trade-lockout checks it was
         built for. */
      strikeBanner: () => '',
      offersWaiting: () => 0, tradeShutFor: () => 0,
      ENGINE: E, roleCan: roleCanFor('trade'), RO: () => S.role !== 'leader'
    });
    paintGameTrade();
    check('a Trade Minister is not locked out of #g_trade', () => {
      assert.ok(tradeEls.every(el => el.disabled === false),
        'a Trade Minister\'s trade controls were disabled — Task 11 undone');
    });
    check('a Trade Minister still gets dimmed, un-decidable scenario cards', () => {
      assert.ok($('s_game').classList.contains('ro'),
        '#s_game lost its .ro class for a Trade Minister — the scenario cards would be bright and tappable, and decide() still refuses the tap');
    });
  }

  {
    /* Final-branch review, fix 4: refresh() redraws the minister screen on
       every poll (myMinistry() branch) but, before this fix, did nothing for
       a Leader sitting on the Policies step (ST===4) — a stale grid and
       stale spent/cap tabs while a minister's real edit sits unrendered on
       this device. Runs the REAL refresh(), applyServer() and renderCards()
       together (not three separate loadFn() calls, so a fix inside refresh()
       reaching for the real renderCards() is actually exercised) against a
       stubbed api() that hands back a Defence Minister's freshly-saved pick
       — exactly what a poll mid-prep looks like. */
    const $ = makeDom();
    const S = { role:'leader', phase:'prep', code:'QBXND', solo:false, offers:[], board:[] };
    const C = E.blankCountry();
    C.split = { edu:6, def:6, trade:6, infra:6 };
    C.picks = { edu:[], def:[], trade:[], infra:[] };
    let ST = 4; // the Leader is standing on the Policies pane — see STEPS/paintStep() in the real page
    const defPick = E.CARDS.def[0].key; // 'ns', cost 4 — whatever another device just saved
    const serverTeam = { ...E.blankCountry(),
      split:{ edu:6, def:6, trade:6, infra:6 },
      picks:{ edu:[], def:[defPick], trade:[], infra:[] } };
    const apiReply = {
      phase:'prep', round:1, maxRounds:3, scenario:null, card:null, kind:'class',
      decideAt:0, now:Date.now(), board:[], offers:[], feed:[], team: serverTeam
    };
    const body = extractFn('applyServer') + '\n' + extractFn('refresh') + '\n' + extractFn('renderCards') +
      '\nreturn { refresh, getST: () => ST };';
    const make = new Function('$', 'S', 'C', 'MIN', 'ROLES', 'CARDS', 'ENGINE', 'MINISTRIES',
      'myMinistry', 'RO', 'api', 'ST', 'EDITING_PICKS', 'LOCAL_PICKS',
      'newlyAccepted', 'playTrade', 'renderBuildings', 'renderPractice', 'renderMinistry',
      'toast', 'enterGame', 'enterFinal', 'paintGame', 'enterPrep', body);
    const h = make($, S, C, 'edu', E.ROLES, CARDS, E, MIN,
      () => '', () => S.role !== 'leader', async () => apiReply, ST, null, null,
      () => [], () => {}, () => {}, () => {}, () => {},
      () => {}, () => {}, () => {}, () => {}, () => {});
    const defCost = E.CARDS.def[0].cost; // 4 — the exact number the stale tab must stop showing
    await h.refresh();
    check('a Leader sitting on the Policies step sees another ministry\'s save land on the next poll', () => {
      assert.deepStrictEqual(C.picks.def, [defPick],
        'applyServer() did not even mirror the Defence Minister\'s pick into C — the fixture itself is broken, not the fix under test');
      const minTabsHtml = $('minTabs').innerHTML;
      assert.ok(minTabsHtml.includes(`<b>${defCost}/6</b>`),
        `refresh() mirrored the new pick into C but never repainted the Leader's own Policies view — #minTabs still reads the pre-poll spend (0/6) instead of ${defCost}/6, so a tap on a card that looks unselected would really be deselecting it`);
    });
  }

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
