/* A member device is stopped by the server, but it must also never TRY: a save()
   that fires on every step change would fill the console with refusals and hide
   real errors. These assertions pin the client half. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFn } = require('./helpers');
const E = require('../game_engine.js');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

check('the join screen asks for a country code', () => {
  assert.ok(/id="j_code"/.test(APP), 'there is no country-code field to join with');
  assert.ok(/function doCode\(/.test(APP), 'doCode() — the single-field join — is missing');
});

/* loadFn() gives the extracted function ONLY the names passed here, so every
   helper save() calls has to be injected too. Task 9 split save() into a thin
   post wrapped around saveBody(): it now calls roleCan('save') instead of
   RO(), and calls saveBody() as a free variable — both have to be handed
   over, real extracted functions rather than stubs, or the call dies with a
   ReferenceError that looks nothing like the bug being tested. */
let sent = 0;
const C = E.blankCountry();
C.name = 'Solaria';
const Smember = { solo:false, code:'QBXND', role:'member' };
const roleCanMember = loadFn('roleCan', {
  S: Smember, ACT_ROLES: { save: ['leader', 'edu', 'def', 'trade', 'infra'] }
});
const myMinistryMember = loadFn('myMinistry', { S: Smember, MINISTRIES: ['edu', 'def', 'trade', 'infra'] });
const saveBodyMember = loadFn('saveBody', { S: Smember, C, myMinistry: myMinistryMember, EDITING_PICKS: null });
const save = loadFn('save', {
  api: () => { sent++; return Promise.resolve({}); },
  S: Smember, roleCan: roleCanMember, saveBody: saveBodyMember
});

/* A minimal stand-in for document.getElementById — enough state (innerHTML,
   value, classList that actually tracks membership) for the renderers under
   test to read and write without throwing, and for assertions here to read
   back what they set. Same idiom as tests/client-identity.test.js's makeDom,
   extended to track classList state since the mass-game banner check below
   needs to tell "toggled hidden on" from "toggled hidden off". */
function makeDom(){
  const els = new Map();
  return id => {
    if (!els.has(id)) {
      const classes = new Set();
      els.set(id, {
        id, innerHTML:'', textContent:'', value:'', open:false, dataset:{}, disabled:false,
        classList:{
          toggle(name, force){
            const on = force === undefined ? !classes.has(name) : !!force;
            if (on) classes.add(name); else classes.delete(name);
            return on;
          },
          add(name){ classes.add(name); },
          remove(name){ classes.delete(name); },
          contains(name){ return classes.has(name); }
        }
      });
    }
    return els.get(id);
  };
}

/* renderIdentity closes over $, C, RO, esc and a handful of option lists —
   the content of those lists is irrelevant to the nudge/share blocks under
   test, so they are stubbed to the smallest thing that lets the function run
   (exactly as client-identity.test.js stubs sumRes/flagSVG/resInputs). */
function renderIdentityHarness(role){
  const $ = makeDom();
  const Cid = E.blankCountry();
  Cid.name = 'Solaria';
  const S = { role };
  const renderIdentity = loadFn('renderIdentity', {
    $, C: Cid, RO: () => S.role === 'member',
    esc: s => String(s == null ? '' : s),
    EMBLEMS: ['🦁'], STRIPE_OPTS: [['solid','Single']], EMPOS_OPTS: [['centre','Centre']],
    paintFlag: () => {}
  });
  return { renderIdentity, $, C: Cid };
}

/* A fake document.querySelectorAll: real browsers hand back live elements
   that the disabling loop in paintGame() then mutates in place. This stub
   returns the SAME array every call for a selector containing '#g_trade',
   so the test can inspect el.disabled afterwards — the only thing that
   matters here, since Node has no real DOM and this project takes on zero
   dependencies (no jsdom). */
function makeTradeDocStub(){
  const tradeEls = [{ disabled:false }, { disabled:false }];
  return {
    querySelectorAll(sel){ return sel.includes('#g_trade') ? tradeEls : []; },
    tradeEls
  };
}

/* paintGame() closes over a lot (rendering three other tabs' worth of UI),
   but GTAB='country' keeps this harness to only the branches that matter for
   the banner/lockout check — renderScenario/renderTrade/renderBoard are
   never even referenced at runtime when their tab isn't active, so they do
   not need stubbing (same reasoning client-identity.test.js relies on for
   renderBuildTrade's untouched branches). */
/* Task 11: paintGame()'s banner and #g_trade lockout no longer ask RO() —
   they ask whether this device holds either trade act, because Trade &
   Defence now have real work to do on this tab. A plain 'member' (the class
   code) holds neither, so it is still watch-locked exactly as before.

   #s_game's own .ro class (which dims the scenario choice cards via the CSS
   rule shared with prep) still asks RO() directly — decide() stays
   leader-only, unchanged — so RO() has to be injected here too, alongside
   roleCan(), or a regression back to one shared flag for all three would
   throw a ReferenceError instead of failing the assertions below. */
function paintGameHarness(role){
  const $ = makeDom();
  const Cg = E.blankCountry();
  Cg.name = 'Solaria'; Cg.coins = 10;
  const S = { role, round:1, maxRounds:3, scenario:null, code:'QBXND', board:[] };
  const doc = makeTradeDocStub();
  const roleCan = loadFn('roleCan', {
    S, ACT_ROLES: { trade: ['leader', 'trade'], ally: ['leader', 'def'] }
  });
  /* Spec B: paintGame builds its tab strip from gtLabel(), not GT, because the
     fifth tab is role-shaped. Only the 'country' tab matters here, and keeping
     the stub to one entry also keeps GTAB='country' a tab that still exists —
     which is what stops paintGame resetting it. */
  const paintGame = loadFn('paintGame', {
    $, document: doc,
    gtLabel: () => [['country','🏙️','My country']], GTAB: 'country',
    S, C: Cg, GAME: { rounds:3 },
    renderCity: () => {}, renderMeters: () => {},
    /* Spec D's banner is not what this file is testing — a stub that draws
       nothing keeps this harness pinned to the member-mode save checks it
       was built for. */
    strikeBanner: () => '',
    offersWaiting: () => 0, tradeShutFor: () => 0,
    ENGINE: E, roleCan, RO: () => role !== 'leader'
  });
  return { paintGame, $, S, C: Cg, doc };
}

(async () => {
  await save();
  check('a member device never posts a save', () => {
    assert.strictEqual(sent, 0, 'a watching device wrote to the server');
  });

  let sent2 = 0;
  const Sleader = { solo:false, code:'LMRTK', role:'leader' };
  const roleCanLeader = loadFn('roleCan', {
    S: Sleader, ACT_ROLES: { save: ['leader', 'edu', 'def', 'trade', 'infra'] }
  });
  const myMinistryLeader = loadFn('myMinistry', { S: Sleader, MINISTRIES: ['edu', 'def', 'trade', 'infra'] });
  const saveBodyLeader = loadFn('saveBody', { S: Sleader, C, myMinistry: myMinistryLeader, EDITING_PICKS: null });
  const save2 = loadFn('save', {
    api: () => { sent2++; return Promise.resolve({}); },
    S: Sleader, roleCan: roleCanLeader, saveBody: saveBodyLeader
  });
  await save2();
  check('a leader device still saves', () => {
    assert.strictEqual(sent2, 1, 'the leader stopped saving too');
  });

  /* These two used to grep the whole file for the strings 'renameAsked' and
     'viewCode' — both of which occur in blankCountry()'s field comments
     regardless of whether anything ever renders them, so the checks pinned
     nothing. They now run the real renderIdentity() through loadFn against
     a DOM stub, exactly the way tests/client-identity.test.js exercises
     renderBuildTrade/renderTrade/renderBoard, and read the actual output. */
  check('the rename nudge is rendered for both a leader and a member', () => {
    for (const role of ['leader', 'member']) {
      const h = renderIdentityHarness(role);
      h.C.renameAsked = true;
      h.renderIdentity();
      assert.ok(/asked you to choose a different name/i.test(h.$('p2Notice').innerHTML),
        `the ${role} device did not render the nudge while C.renameAsked was true`);
    }
  });

  check('the rename nudge disappears once the name is no longer in question', () => {
    const h = renderIdentityHarness('leader');
    h.C.renameAsked = false;
    h.renderIdentity();
    assert.ok(!/asked you to choose a different name/i.test(h.$('p2Notice').innerHTML),
      'the nudge rendered even though C.renameAsked was false');
  });

  check('the class code is shown to the leader to read out, and not to a member', () => {
    const leader = renderIdentityHarness('leader');
    leader.C.viewCode = 'QBXND';
    leader.renderIdentity();
    assert.ok(leader.$('p2Notice').innerHTML.includes('QBXND'),
      'the leader was never shown the class code to give their group');

    const member = renderIdentityHarness('member');
    member.C.viewCode = 'QBXND';
    member.renderIdentity();
    assert.ok(!member.$('p2Notice').innerHTML.includes('QBXND'),
      'a member device was shown the class code — it should only ever be read out by the leader');
  });

  /* -------- mass game: member stays a watcher past prep -------- */
  /* Member mode used to stop at prep — RO() gated save()/goReady()/
     renderIdentity() and nothing else. Once the room moved to the mass game,
     decide()/sendOffer()/respond() had no RO() gate at all, so a member
     device could tap Accept on a trade or pick a scenario option and only
     the server's bare refusal stopped it. These pin the same never-TRY
     contract save() already had, now extended to the three mass-game write
     paths, exactly as goReady() does with its own RO() guard. */
  let decideCalls = 0;
  const decideMember = loadFn('decide', {
    S: { solo:false, code:'QBXND', role:'member' }, C,
    RO: () => true,
    api: () => { decideCalls++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await decideMember('anything');
  check('a member device never posts a scenario decision', () => {
    assert.strictEqual(decideCalls, 0, 'a watching device chose a scenario option');
  });

  let decideCalls2 = 0;
  const decideLeader = loadFn('decide', {
    S: { solo:false, code:'LMRTK', role:'leader' }, C,
    RO: () => false,
    api: () => { decideCalls2++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await decideLeader('anything');
  check('a leader device still posts a scenario decision', () => {
    assert.strictEqual(decideCalls2, 1, 'the leader stopped choosing scenario options');
  });

  /* Task 11: sendOffer()/respond() no longer gate on RO() — the offer decides
     (ally vs. goods), via roleCan(). A plain 'member' (the class code) holds
     neither the 'ally' nor the 'trade' act, so it is refused exactly as it
     was refused by RO() before. */
  const roleCanFor = (role) => loadFn('roleCan', {
    S: { role }, ACT_ROLES: { trade: ['leader', 'trade'], ally: ['leader', 'def'] }
  });

  let offerCalls = 0;
  const $tradeM = makeDom();
  const sendOfferMember = loadFn('sendOffer', {
    $: $tradeM, S: { solo:false, code:'QBXND', role:'member' },
    roleCan: roleCanFor('member'),
    api: () => { offerCalls++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await sendOfferMember();
  check('a member device never posts a trade offer', () => {
    assert.strictEqual(offerCalls, 0, 'a watching device sent a trade offer');
  });

  let offerCalls2 = 0;
  const $tradeL = makeDom();
  $tradeL('t_to').value = 'THEIRS';   // a country chosen from the list
  const sendOfferLeader = loadFn('sendOffer', {
    $: $tradeL, S: { solo:false, code:'LMRTK', role:'leader' },
    roleCan: roleCanFor('leader'),
    api: () => { offerCalls2++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await sendOfferLeader();
  check('a leader device still posts a trade offer', () => {
    assert.strictEqual(offerCalls2, 1, 'the leader stopped sending trade offers');
  });

  let respondCalls = 0;
  const respondMember = loadFn('respond', {
    S: { solo:false, code:'QBXND', role:'member', offers:[{ id:'o1', ally:false }] },
    roleCan: roleCanFor('member'),
    api: () => { respondCalls++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await respondMember('o1', true);
  check('a member device never responds to a trade offer', () => {
    assert.strictEqual(respondCalls, 0, 'a watching device accepted or declined a trade offer');
  });

  let respondCalls2 = 0;
  const respondLeader = loadFn('respond', {
    S: { solo:false, code:'LMRTK', role:'leader', offers:[{ id:'o1', ally:false }] },
    roleCan: roleCanFor('leader'),
    api: () => { respondCalls2++; return Promise.resolve({}); },
    toast: () => {}, refresh: async () => {}
  });
  await respondLeader('o1', true);
  check('a leader device still responds to a trade offer', () => {
    assert.strictEqual(respondCalls2, 1, 'the leader stopped responding to trade offers');
  });

  /* The watching banner used to live only inside #s_prep and vanish the
     moment the mass game began — exactly the phase a member spends the rest
     of the lesson in. paintGame() now carries it across, and locks the trade
     panel's real form controls the same way paintStep() locks prep's. */
  check('the watching banner appears in the mass game for a member, and not for a leader', () => {
    const member = paintGameHarness('member');
    member.paintGame();
    assert.ok(!member.$('roBanner').classList.contains('hidden'),
      'a member device did not see the watching banner once the mass game began');
    assert.ok(/watching/i.test(member.$('roBanner').textContent),
      'the watching banner has no watching copy');
    assert.ok(member.$('s_game').classList.contains('ro'),
      '#s_game did not gain the .ro class that hides the scenario cards for a member');

    const leader = paintGameHarness('leader');
    leader.paintGame();
    assert.ok(leader.$('roBanner').classList.contains('hidden'),
      'the leader device was shown the watching banner it should be driving past');
    assert.ok(!leader.$('s_game').classList.contains('ro'),
      "#s_game gained the .ro class for the leader, who should be able to act");
  });

  check('the trade panel is disabled for a member in the mass game, and left alone for a leader', () => {
    const member = paintGameHarness('member');
    member.paintGame();
    assert.ok(member.doc.tradeEls.every(el => el.disabled === true),
      'trade controls were not disabled for a watching member in the mass game');

    const leader = paintGameHarness('leader');
    leader.paintGame();
    assert.ok(leader.doc.tradeEls.every(el => el.disabled === false),
      'trade controls were disabled for the leader too');
  });

  /* -------- Task 12: committing, and getting to the hall -------- */

  check('committing goes through a confirmation, not a bare button', () => {
    assert.ok(/function doCommit\(/.test(APP), 'doCommit() is missing');
    assert.ok(/confirm\(/.test(APP), 'a country can be locked without confirming');
    assert.ok(/api\/team\/commit/.test(APP), 'the app never calls the commit endpoint');
  });
  check('a committed group is given a way into the hall', () => {
    assert.ok(/function doJoinHall\(/.test(APP), 'doJoinHall() is missing');
    assert.ok(/api\/team\/join-hall/.test(APP), 'the app never calls the handover endpoint');
    assert.ok(/id="hallCode"/.test(APP), 'there is no field to type the hall room code into');
  });
  /* doCommit() — extract the real function and run it against fakes, exactly
     as save()/decide()/sendOffer()/respond() are exercised above. A member
     device is stopped on the client so it never even TRIES; the server
     refuses too (Task 6), but that refusal must never be the only thing
     standing between a watching device and a locked country. */
  function commitHarness(role, confirmResult){
    if (confirmResult === undefined) confirmResult = true;
    const calls = { api:0, confirm:0, save:0, renderCommitted:0 };
    const Cc = E.blankCountry(); Cc.name = 'Solaria';
    const S = { role, code:'LMRTK' };
    const doCommit = loadFn('doCommit', {
      RO: () => role === 'member',
      confirm: () => { calls.confirm++; return confirmResult; },
      save: async () => { calls.save++; },
      api: () => { calls.api++; return Promise.resolve({ ok:true, team:{} }); },
      toast: () => {},
      renderCommitted: () => { calls.renderCommitted++; },
      S, C: Cc
    });
    return { doCommit, calls, C: Cc };
  }

  const memberCommit = commitHarness('member');
  await memberCommit.doCommit();
  check('a member device never posts a commit', () => {
    assert.strictEqual(memberCommit.calls.api, 0, 'a watching device committed the country');
    assert.strictEqual(memberCommit.calls.confirm, 0, 'a watching device was even asked to confirm a commit');
    assert.strictEqual(memberCommit.C.locked, false, 'a watching device locked the country locally');
  });

  const leaderCommit = commitHarness('leader');
  await leaderCommit.doCommit();
  check('a leader device commits, locks the country and reaches the committed pane', () => {
    assert.strictEqual(leaderCommit.calls.api, 1, 'the leader stopped committing the country');
    assert.strictEqual(leaderCommit.C.locked, true, 'the country was not marked locked after a successful commit');
    assert.strictEqual(leaderCommit.calls.renderCommitted, 1, 'the leader was not sent to the committed pane after committing');
  });

  const declinedCommit = commitHarness('leader', false);
  await declinedCommit.doCommit();
  check('declining the confirmation leaves the country untouched', () => {
    assert.strictEqual(declinedCommit.calls.api, 0, 'the commit endpoint was called even though the confirmation was declined');
    assert.strictEqual(declinedCommit.C.locked, false, 'the country was locked locally despite a declined confirmation');
  });

  /* doJoinHall() — same idiom. Also pins that a hall room code (4 letters) and
     a country code (5 letters) cannot be confused: the field only accepts 4. */
  function joinHallHarness(role, roomValue){
    const calls = { api:0, toast:[], refresh:0 };
    const $ = makeDom();
    $('hallCode').value = roomValue;
    const S = { role, code:'LMRTK', room:null };
    const doJoinHall = loadFn('doJoinHall', {
      RO: () => role === 'member',
      $, S,
      api: () => { calls.api++; return Promise.resolve({ ok:true, room:'ABCD' }); },
      toast: (m) => { calls.toast.push(m); },
      refresh: () => { calls.refresh++; }
    });
    return { doJoinHall, calls, S };
  }

  const memberHall = joinHallHarness('member', 'ABCD');
  await memberHall.doJoinHall();
  check('a member device never posts a hall handover', () => {
    assert.strictEqual(memberHall.calls.api, 0, 'a watching device moved its country into the hall');
  });

  const shortHall = joinHallHarness('leader', 'ABCDE'); // 5 letters — a country code, not a room code
  await shortHall.doJoinHall();
  check('a 5-letter country code typed into the hall field is refused, and the app says why', () => {
    assert.strictEqual(shortHall.calls.api, 0, 'a 5-letter code was sent to the hall endpoint as if it were a room code');
    assert.ok(shortHall.calls.toast.some(m => /4 letters/i.test(m)),
      'nothing told the group the hall code is 4 letters, not their 5-letter country code');
  });

  const leaderHall = joinHallHarness('leader', 'abcd');
  await leaderHall.doJoinHall();
  check('a leader device joins the hall with a valid 4-letter room code', () => {
    assert.strictEqual(leaderHall.calls.api, 1, 'a valid room code was never sent');
    assert.strictEqual(leaderHall.S.room, 'ABCD', 'the room the server handed back was not kept');
  });

  /* practiceChoose() — the same never-TRY contract, extended to the one new
     write path a member could otherwise reach from the practice-card panel. */
  function practiceChooseHarness(role){
    const calls = { api:0, refresh:0 };
    const practiceChoose = loadFn('practiceChoose', {
      RO: () => role === 'member',
      api: () => { calls.api++; return Promise.resolve({ ok:true, applied:{ fx:{}, coin:0 } }); },
      toast: () => {}, refresh: () => { calls.refresh++; }, S: { code:'LMRTK' }
    });
    return { practiceChoose, calls };
  }
  const memberPractice = practiceChooseHarness('member');
  await memberPractice.practiceChoose('a');
  check('a member device never posts a practice choice', () => {
    assert.strictEqual(memberPractice.calls.api, 0, 'a watching device played a practice card');
  });
  const leaderPractice = practiceChooseHarness('leader');
  await leaderPractice.practiceChoose('a');
  check('a leader device still posts a practice choice', () => {
    assert.strictEqual(leaderPractice.calls.api, 1, 'the leader stopped being able to play a practice card');
  });

  /* enterPrep() — a reload with an already-committed leader code must land on
     the committed pane, not step 0 with everything disabled. */
  function enterPrepHarness(locked, role){
    const calls = { show:0, paintStep:0, renderCommitted:0 };
    const $ = makeDom();
    const Cep = E.blankCountry(); Cep.name = 'Solaria'; Cep.locked = locked;
    const enterPrep = loadFn('enterPrep', {
      show: () => { calls.show++; }, $,
      C: Cep, RO: () => role === 'member',
      /* enterPrep() now checks myMinistry() first — see Task 10. None of these
         fixtures drive a ministry role, so it is always empty and the wizard
         path below still runs; renderMinistry() is injected only so a future
         regression that DID call it would fail loudly instead of throwing a
         ReferenceError that looks nothing like the bug being tested. */
      myMinistry: () => '', renderMinistry: () => { calls.renderMinistry = (calls.renderMinistry||0)+1; },
      renderCommitted: () => { calls.renderCommitted++; },
      paintStep: () => { calls.paintStep++; },
      ST: 0
    });
    return { enterPrep, calls, $ };
  }

  check('a reload with a committed leader code lands on the committed pane, not step 0', () => {
    const h = enterPrepHarness(true, 'leader');
    h.enterPrep();
    assert.strictEqual(h.calls.renderCommitted, 1, 'a locked country reopened by its leader did not reach the committed pane');
    assert.strictEqual(h.calls.paintStep, 0, 'a locked country still ran the ordinary step flow instead of stopping at commit');
  });
  check('an uncommitted country still runs the ordinary step flow', () => {
    const h = enterPrepHarness(false, 'leader');
    h.enterPrep();
    assert.strictEqual(h.calls.paintStep, 1, 'an unlocked country never reached the step flow');
    assert.strictEqual(h.calls.renderCommitted, 0, 'an unlocked country was sent to the committed pane');
  });
  check('a watching member is never routed to the leader-only committed pane, even if the country is locked', () => {
    const h = enterPrepHarness(true, 'member');
    h.enterPrep();
    assert.strictEqual(h.calls.paintStep, 1, 'a member device was blocked from the ordinary step flow it is meant to browse read-only');
    assert.strictEqual(h.calls.renderCommitted, 0, 'a member device was sent to the leader-only committed pane');
  });

  /* applyServer() — a reopened country (or a played practice card) has to
     reach a leader's own device mid-prep, where the general "the server is
     behind, do not overwrite local edits" rule would otherwise leave
     C.locked/C.chosen stuck at their old value until the mass game begins. */
  function applyServerHarness(role, startLocked){
    const S = { role };
    const Cas = E.blankCountry();
    Cas.name = 'Local Edit In Progress'; Cas.locked = startLocked; Cas.chosen = null;
    /* applyServer now also spots trades that closed between two polls and
       plays a delivery on the city canvas. The real newlyAccepted goes in, so
       an offer list in these fixtures is handled exactly as it is in the app;
       playTrade is stubbed, because there is no canvas here and the animation
       is not what this harness is testing. Every call below records what it
       was asked to play, so a future edit that starts animating other
       countries' deals fails here rather than in a hall. */
    const played = [];
    /* Task 9 added a ministry mirror-exception and a leader picks-merge
       exception to applyServer(), each reading myMinistry()/LOCAL_PICKS/
       EDITING_PICKS as free variables — both have to be injected or the
       call dies with a ReferenceError. NOTE, corrected after a Critical
       review caught the original comment here overclaiming: the LEADER
       branch is NOT inert by default. Its guard tests r.team.picks, not
       EDITING_PICKS, and r.team.picks is a real, always-present object on
       every /api/state response (blankCountry() always defines all four
       keys) — so for role:'leader' during prep it fires on every single
       poll this harness sends, whether or not EDITING_PICKS is set. That is
       exactly how the Critical got past this suite the first time: every
       fixture below omitted `picks`, so the branch's own body (spreading
       r.team.picks) produced {} unnoticed and every check still happened to
       read the right values off C — see the `picks` key added to every
       `team:{…}` fixture below, and the three dedicated coverage checks
       right after this harness, for the fix that actually pins this. Only
       the MINISTRY branch is genuinely gated on a value Task 10 sets
       (LOCAL_PICKS, still null here), so myMinistry() returning '' keeps
       that one branch — and only that one — inert. */
    const applyServer = loadFn('applyServer', {
      S, C: Cas, RO: () => role === 'member',
      renderBuildings: () => {}, ST: 5,
      newlyAccepted: loadFn('newlyAccepted'),
      playTrade: (o) => played.push(o),
      myMinistry: () => '', LOCAL_PICKS: null, EDITING_PICKS: null
    });
    return { applyServer, S, C: Cas, played };
  }

  check('a reopen reaches a leader mid-prep without overwriting local edits', () => {
    const h = applyServerHarness('leader', true);
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, name:'Server Copy Must Not Win', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.locked, false,
      'C.locked never updated for the leader mid-prep — a reopen would never reach this device');
    assert.strictEqual(h.C.name, 'Local Edit In Progress',
      'the leader\'s in-progress edits were overwritten even though the country is still mid-prep');
  });

  check('a practice choice reaches a leader mid-prep so a played card does not stay clickable', () => {
    const h = applyServerHarness('leader', false);
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:'floods', kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:{ scenario:'floods', choice:'a', label:'Build levees', fx:{}, coin:0 }, stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.deepStrictEqual(h.C.chosen, { scenario:'floods', choice:'a', label:'Build levees', fx:{}, coin:0 },
      'C.chosen never updated for the leader mid-prep — a played practice card would still show its choice buttons');
  });

  check('a member device still mirrors the server fully during prep, unaffected by the locked/chosen fix', () => {
    const h = applyServerHarness('member', false);
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:true, chosen:null, name:'Leader Renamed It', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.name, 'Leader Renamed It', 'a member device stopped mirroring the leader\'s edits during prep');
  });

  /* Task 16's fix for the acceptance report's Step 4 critical defect:
     renameAsked (and, only on the leading edge of a fresh ask, the
     server-blanked name) is now a fifth prep-phase exception, for the same
     reason as locked/chosen — it is a flag the leader never types into a
     form, so mirroring it every poll clobbers nothing, and without it a
     still-building (or just-reopened) leader had no way to ever learn a
     rename was asked of them at all. */
  check('a fresh rename ask reaches a leader mid-prep: renameAsked flips true and the server-blanked name is adopted', () => {
    const h = applyServerHarness('leader', false);
    assert.strictEqual(h.C.renameAsked, false, 'harness precondition: renameAsked should start false');
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, renameAsked:true, name:'', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.renameAsked, true,
      'C.renameAsked never updated for the leader mid-prep — the nudge could never reach this device (the exact Step 4 defect)');
    assert.strictEqual(h.C.name, '',
      'the server-blanked name was not adopted on the leading edge of a fresh ask — the group would not be forced to retype');
  });

  /* This is the regression the fix could plausibly cause, and the report
     explicitly calls out pinning it: once renameAsked is ALREADY true (the
     leader has already been notified and may be mid-retype on the Identity
     pane), every later poll must leave C.name alone. The server still
     echoes back name:'' each poll because the leader has not yet saved a
     genuinely different name — continuing to copy that across every ~2.5s
     tick would stomp the group's in-progress keystrokes back to blank. */
  check('in-progress edits are NOT clobbered by later polls while renameAsked stays true', () => {
    const h = applyServerHarness('leader', false);
    h.C.renameAsked = true;       // the ask already landed on an earlier poll
    h.C.name = 'Draft Retyped Name'; // the group has started typing a new one
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, renameAsked:true, name:'', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.renameAsked, true, 'renameAsked should still read true — the group has not saved a new name yet');
    assert.strictEqual(h.C.name, 'Draft Retyped Name',
      'a later poll while renameAsked stayed true overwrote the group\'s in-progress retype with the stale blank — this is the clobbering regression the fix must not introduce');
  });

  check('renameAsked clears on the leader\'s device once the server clears it', () => {
    const h = applyServerHarness('leader', false);
    h.C.renameAsked = true;
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, renameAsked:false, name:'Verdana', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.renameAsked, false,
      'C.renameAsked stayed true on the leader\'s device even though the server had cleared it after a genuine rename');
  });

  check('a member device mirrors renameAsked too, unaffected by the leader-only edge logic', () => {
    const h = applyServerHarness('member', false);
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, renameAsked:true, name:'', stock:{ W:0,M:0,F:0 }, picks:{edu:[],def:[],trade:[],infra:[]} } });
    assert.strictEqual(h.C.renameAsked, true, 'a member device stopped mirroring renameAsked during prep');
  });

  /* -------- Critical fix regression coverage: applyServer()'s picks-merge
     ordering -------- */
  /* A Critical review of Task 9 found that inserting the two new picks
     blocks "immediately after" the wholesale-mirror `if` — as the task brief
     literally instructed, without noticing what that line was part of — put
     them BETWEEN the wholesale-copy `if` and its `else if(r.team){...}`. That
     else-if is the only place C.stock/C.locked/C.chosen/C.viewCode/
     C.renameAsked are mirrored for a still-building device. Because `else`
     binds to the NEAREST preceding `if`, it silently rebound from the
     wholesale-copy `if` to the leader picks-merge `if` immediately above it.
     r.team.picks is always a truthy object — blankCountry() always defines
     all four keys — so for role:'leader' during prep that picks-merge `if`
     is true on every single poll, and the else-if attached to it never ran:
     a still-building leader stopped ever learning about a reopen, a rename
     ask, a played practice card, or a completed trade. This is Step 4 of the
     2026-07-31 acceptance report's critical defect, reintroduced.

     applyServerHarness() above could not have caught this: every one of its
     fixtures omitted `picks`, so the leader picks-merge `if`'s own guard
     (`r.team.picks`) read undefined/falsy and the branch never fired either
     way — masking the ordering bug rather than exercising it. Fixed there by
     adding `picks` to every fixture; pinned properly here with a harness that
     matches the real /api/state payload shape and controls
     EDITING_PICKS/LOCAL_PICKS/myMinistry directly, the way the two picks
     branches actually need to be exercised. */
  function applyServerPicksHarness(role, opts){
    opts = opts || {};
    const S = { role };
    const Cas = E.blankCountry();
    Cas.name = 'Local Edit In Progress';
    Cas.picks = { edu:['a'], def:['b'], trade:['c'], infra:['d'] };
    const applyServer = loadFn('applyServer', {
      S, C: Cas, RO: () => role !== 'leader',
      renderBuildings: () => {}, ST: 5,
      newlyAccepted: loadFn('newlyAccepted'), playTrade: () => {},
      myMinistry: () => opts.ministry || '',
      LOCAL_PICKS: opts.localPicks !== undefined ? opts.localPicks : null,
      EDITING_PICKS: opts.editingPicks !== undefined ? opts.editingPicks : null
    });
    return { applyServer, S, C: Cas };
  }
  const SERVER_PICKS = { edu:['freshEdu'], def:['freshDef'], trade:['freshTrade'], infra:['freshInfra'] };

  check('(a) a leader mid-edit keeps that one ministry local, and takes the other three from the server', () => {
    const h = applyServerPicksHarness('leader', { editingPicks:'def' });
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, name:'Server Copy', stock:{ W:0,M:0,F:0 }, picks: SERVER_PICKS } });
    assert.deepStrictEqual(h.C.picks.def, ['b'],
      'the ministry the leader is actively editing was overwritten by the stale server copy');
    assert.deepStrictEqual(h.C.picks.edu, ['freshEdu'], 'a ministry not being edited was not taken from the server');
    assert.deepStrictEqual(h.C.picks.trade, ['freshTrade'], 'a ministry not being edited was not taken from the server');
    assert.deepStrictEqual(h.C.picks.infra, ['freshInfra'], 'a ministry not being edited was not taken from the server');
  });

  check('(b) a ministry device keeps its own just-tapped card through a poll landing mid-save', () => {
    const h = applyServerPicksHarness('edu', { ministry:'edu', localPicks:['justTapped'] });
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, name:'Server Copy', stock:{ W:0,M:0,F:0 }, picks: SERVER_PICKS } });
    assert.deepStrictEqual(h.C.picks.edu, ['justTapped'],
      'the wholesale mirror snapped the card the student just tapped back off the grid');
    assert.deepStrictEqual(h.C.picks.def, ['freshDef'], 'another ministry was not mirrored from the server');
  });

  /* (c) THE REGRESSION TEST for the Critical. An untouched leader
     (EDITING_PICKS:null) is the common case — every poll before Task 10
     wires toggleCard() to ever set it — so this is the scenario that was
     silently broken. Fails against the pre-fix ordering (the picks blocks
     sitting between the wholesale `if` and its `else if`); passes once both
     blocks run as independent statements after that chain. */
  check('(c) an untouched leader mid-prep still mirrors locked, renameAsked, chosen, stock and viewCode', () => {
    const h = applyServerPicksHarness('leader', { editingPicks:null });
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:'floods', kind:'class',
      board:[], feed:[], offers:[],
      team:{
        locked:true,
        chosen:{ scenario:'floods', choice:'a', label:'Build levees', fx:{}, coin:0 },
        renameAsked:true, name:'', viewCode:'QBXND', stock:{ W:0,M:2,F:0 },
        picks: SERVER_PICKS
      } });
    assert.strictEqual(h.C.locked, true,
      'C.locked was never mirrored for an untouched leader mid-prep — a reopen would never reach this device (Step 4 defect)');
    assert.strictEqual(h.C.renameAsked, true,
      'C.renameAsked was never mirrored for an untouched leader mid-prep — the rename nudge could never reach this device (Step 4 defect)');
    assert.deepStrictEqual(h.C.chosen,
      { scenario:'floods', choice:'a', label:'Build levees', fx:{}, coin:0 },
      'C.chosen was never mirrored for an untouched leader mid-prep — a played practice card would still show its choice buttons');
    assert.strictEqual(h.C.stock.M, 2,
      'C.stock was never mirrored for an untouched leader mid-prep — goods received in a prep trade would never appear');
    assert.strictEqual(h.C.viewCode, 'QBXND',
      'C.viewCode was never mirrored for an untouched leader mid-prep — a reloaded leader would have no class code to read out');
  });

  /* (d) MINOR fix pinned: the leader merge spreads C.picks BEFORE
     r.team.picks (`{ ...C.picks, ...r.team.picks }`), not r.team.picks alone.
     An old save file predating ministries (or one saved before the fourth
     ministry existed) can arrive missing a key — the merge must fall back to
     the local copy for that key rather than leave C.picks[missingKey]
     undefined, which would throw the next time toggleCard() calls
     .indexOf() on it. */
  check('(d) a leader merge fills a ministry key missing from the server copy from the local copy, not undefined', () => {
    const h = applyServerPicksHarness('leader', { editingPicks:null });
    const incompletePicks = { edu:['freshEdu'], def:['freshDef'], trade:['freshTrade'] }; // no infra key
    h.applyServer({ phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
      board:[], feed:[], offers:[],
      team:{ locked:false, chosen:null, name:'Server Copy', stock:{ W:0,M:0,F:0 }, picks: incompletePicks } });
    assert.notStrictEqual(h.C.picks.infra, undefined,
      'a ministry key missing from an old save file left C.picks.infra undefined — the next toggleCard() call would throw');
    assert.deepStrictEqual(h.C.picks.infra, ['d'],
      'a ministry key missing from the server copy was not filled in from the local copy');
  });

  /* refresh() — the reopen transition has to fire from a poll, not only from
     enterPrep() at load, or a group sitting on the committed pane when the
     teacher reopens them is stranded looking at "nothing more to do". */
  function refreshHarness(role, initialLocked, teamLocked, st){
    const calls = { enterGame:0, enterFinal:0, paintGame:0, enterPrep:0, renderPractice:0, toast:[] };
    const S = { role, solo:false, code:'LMRTK', phase:'prep', round:0, scenario:null };
    const Cr = E.blankCountry(); Cr.locked = initialLocked;
    const refresh = loadFn('refresh', {
      S, C: Cr,
      api: () => Promise.resolve({ error:null, phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
        board:[], feed:[], offers:[], team:{ locked:teamLocked, chosen:null, stock:{W:0,M:0,F:0} } }),
      applyServer: (r) => { S.phase = r.phase; S.round = r.round; S.scenario = r.scenario;
        S.kind = r.kind; Cr.locked = !!r.team.locked; },
      renderPractice: () => { calls.renderPractice++; },
      /* refresh() now also repaints the minister screen during prep — see
         Task 10. None of these fixtures drive a ministry role, so myMinistry()
         is always empty and renderMinistry() is never reached; both still
         have to be injected or the extracted body dies with a ReferenceError
         on the free names, exactly like every other helper here. */
      myMinistry: () => '', renderMinistry: () => { calls.renderMinistry = (calls.renderMinistry||0)+1; },
      /* refresh() also repaints the Leader's own Policies view now — see
         final-branch review fix 4. `st` defaults to 0 for every existing
         fixture below (none of them puts anyone on step 4), so ST !== 4 and
         renderCards() is never actually reached there — but ST is a free
         variable refresh() reads unconditionally in that comparison, and
         omitting it dies with a ReferenceError before any branch runs.
         Parameterised (not hardcoded) so the role-scoping checks further
         down can drive ST to 4 directly and prove renderCards() fires for a
         Leader there and nobody else — a bare `ST: 0` everywhere would leave
         the `S.role === 'leader'` half of that condition provably untested:
         a coordinator review found the sabotage
         `S.phase==='prep' && (S.role==='leader'||true) && ST===4` left the
         whole suite (1026/1026) green with only ST fixed at 0. */
      ST: st || 0, renderCards: () => { calls.renderCards = (calls.renderCards||0)+1; },
      enterGame: () => { calls.enterGame++; }, enterFinal: () => { calls.enterFinal++; },
      paintGame: () => { calls.paintGame++; }, enterPrep: () => { calls.enterPrep++; },
      toast: (m) => { calls.toast.push(m); },
      RO: () => role === 'member', GTAB: 'country'
    });
    return { refresh, calls, S, C: Cr };
  }

  const reopened = refreshHarness('leader', true, false);
  await reopened.refresh();
  check('a poll that finds a reopened country bounces its leader off the committed pane', () => {
    assert.strictEqual(reopened.calls.enterPrep, 1,
      'refresh() did not re-enter the step flow when the teacher reopened a committed country');
    assert.ok(reopened.calls.toast.some(m => /reopen/i.test(m)), 'nothing told the group they had been reopened');
  });

  const stillLocked = refreshHarness('leader', true, true);
  await stillLocked.refresh();
  check('a poll changes nothing while a committed country stays committed', () => {
    assert.strictEqual(stillLocked.calls.enterPrep, 0, 'refresh() re-entered the step flow even though nothing was reopened');
  });

  const memberStillLocked = refreshHarness('member', true, false);
  await memberStillLocked.refresh();
  check('a member device is never bounced off a pane it never shows in the first place', () => {
    assert.strictEqual(memberStillLocked.calls.enterPrep, 0,
      'refresh() tried to re-enter prep for a member device, which never shows the committed pane at all');
  });

  const freshPoll = refreshHarness('leader', false, false);
  await freshPoll.refresh();
  check('every prep-phase poll repaints the practice-card panel', () => {
    assert.strictEqual(freshPoll.calls.renderPractice, 1, 'a prep-phase poll never repainted the practice card panel');
  });

  /* Final-branch review, second pass: fix 4's `S.role === 'leader'` half was
     unpinned — every existing refresh() fixture in this file left ST at 0,
     so a sabotage widening the role check (e.g. `S.role==='leader'||true`)
     never reached the `ST===4` branch at all and the full suite stayed
     green. Driving ST to 4 directly (refreshHarness's new 4th argument)
     closes that: one poll on the Policies step for a Leader, one for a
     role that owns no country-wide UI at all. */
  const leaderOnPolicies = refreshHarness('leader', false, false, 4);
  await leaderOnPolicies.refresh();
  check('a Leader sitting on the Policies step (ST 4) gets renderCards() on every poll', () => {
    assert.strictEqual(leaderOnPolicies.calls.renderCards, 1,
      'refresh() did not repaint the Leader\'s own Policies view on a poll landing on ST 4 — fix 4 regressed');
  });

  const memberOnPolicies = refreshHarness('member', false, false, 4);
  await memberOnPolicies.refresh();
  check('a member device on ST 4 never gets renderCards() — that repaint is the Leader\'s alone', () => {
    assert.strictEqual(memberOnPolicies.calls.renderCards, undefined,
      'refresh() called renderCards() for a non-leader role on ST 4 — the S.role===\'leader\' guard is not actually scoping this repaint to the Leader');
  });

  /* refresh()'s own rename-nudge toast — "the nudge is visible where the
     group is, not only on the Identity pane they may have left" (they were
     on Launch in the acceptance report's Step 4). This exercises refresh()'s
     wasRenameAsked-vs-post-applyServer() comparison directly; applyServer()'s
     own mirroring (including that it must not clobber an in-progress retype)
     is pinned separately above via applyServerHarness. The stub here mirrors
     renameAsked unconditionally, same as the real applyServer(), which is
     all refresh()'s own before/after diff needs to be exercised honestly. */
  function refreshRenameHarness(role, startRenameAsked, teamRenameAsked){
    const calls = { toast: [] };
    const S = { role, solo:false, code:'LMRTK', phase:'prep', round:0, scenario:null };
    const Cr = E.blankCountry(); Cr.locked = false; Cr.renameAsked = startRenameAsked;
    const refresh = loadFn('refresh', {
      S, C: Cr,
      api: () => Promise.resolve({ error:null, phase:'prep', round:0, maxRounds:3, scenario:null, kind:'class',
        board:[], feed:[], offers:[],
        team:{ locked:false, chosen:null, stock:{W:0,M:0,F:0}, renameAsked:teamRenameAsked, name:'' } }),
      applyServer: (r) => { S.phase = r.phase; S.round = r.round; S.scenario = r.scenario;
        S.kind = r.kind; Cr.locked = !!r.team.locked; Cr.renameAsked = !!r.team.renameAsked; },
      renderPractice: () => {},
      myMinistry: () => '', renderMinistry: () => {},
      ST: 0, renderCards: () => {},
      enterGame: () => {}, enterFinal: () => {},
      paintGame: () => {}, enterPrep: () => {},
      toast: (m) => { calls.toast.push(m); },
      RO: () => role === 'member', GTAB: 'country'
    });
    return { refresh, calls, S, C: Cr };
  }

  const freshAskPoll = refreshRenameHarness('leader', false, true);
  await freshAskPoll.refresh();
  check('a poll landing a fresh rename ask toasts the leader immediately, wherever they are standing', () => {
    assert.ok(freshAskPoll.calls.toast.some(m => /different name/i.test(m)),
      'refresh() did not toast the leader when renameAsked transitioned to true — a leader off the Identity pane would never learn about the ask');
  });

  const alreadyAskedPoll = refreshRenameHarness('leader', true, true);
  await alreadyAskedPoll.refresh();
  check('a poll does not re-toast the rename nudge while it was already pending before this poll', () => {
    assert.strictEqual(alreadyAskedPoll.calls.toast.length, 0,
      'refresh() toasted again even though the rename ask was not new this poll — this would fire on every ~2.5s tick while the group is retyping');
  });

  const clearedPoll = refreshRenameHarness('leader', true, false);
  await clearedPoll.refresh();
  check('a poll that finds the rename request cleared does not toast anything', () => {
    assert.strictEqual(clearedPoll.calls.toast.length, 0,
      'refresh() toasted on a renameAsked transition from true to false, which is not a fresh ask');
  });

  const memberAskPoll = refreshRenameHarness('member', false, true);
  await memberAskPoll.refresh();
  check('a member device is not sent the leader-only rename toast — it cannot retype the name or commit', () => {
    assert.strictEqual(memberAskPoll.calls.toast.length, 0,
      'a member device was toasted the rename nudge meant for the leader');
  });

  /* renderPractice() — the pane must be offered to a COMMITTED country, because
     that is the only state the drill is ever dealt in: the server refuses it
     until every group in the room has committed, and writable() carries a
     matching exception (allowCommitted) so a committed country may answer that
     one card. This test used to assert the opposite, and was right to when the
     old practice cards ran before commit; keeping that rule after the drill
     moved after commit is what made the card unreachable on every phone while
     the suite stayed green. Still scoped to a classroom: a hall's cards are the
     real mass game, never a rehearsal. */
  function renderPracticeHarness(opts){
    const $ = makeDom();
    const Cp = E.blankCountry(); Cp.locked = !!opts.locked; Cp.chosen = opts.chosen || null;
    /* The card now arrives from the server on S.card rather than being looked
       up in a deck this device carries — so the fixture is a card, not a deck.
       DRILL is still passed because renderPractice falls back to it for the
       offline solo path, which this harness never takes. */
    const card = { key:'floods', icon:'🌊', title:'Flood season', story:'Rain will not stop.',
      choices:[{ key:'a', icon:'🧱', label:'Build levees' }] };
    const S = { kind: opts.kind, solo:false,
                scenario: opts.roomHasScenario ? 'floods' : null,
                card: opts.roomHasScenario ? card : null };
    const renderPractice = loadFn('renderPractice', {
      $, DRILL: E.DRILL, S, C: Cp, esc: s => String(s == null ? '' : s), RO: () => false
    });
    return { renderPractice, $, S, C: Cp };
  }

  check('a committed country in a classroom is still shown the drill — that is when it runs', () => {
    const h = renderPracticeHarness({ kind:'class', locked:true, roomHasScenario:true });
    h.renderPractice();
    assert.ok(!h.$('p_practice').classList.contains('hidden'),
      'the drill was hidden from a committed country — the only state the server ever deals it in, so no phone in the room could see it');
    assert.ok(/practiceChoose\('a'\)/.test(h.$('practiceBody').innerHTML),
      'the drill offered a committed country no way to choose');
  });
  check('an open card in a classroom is offered as a practice card before commit', () => {
    const h = renderPracticeHarness({ kind:'class', locked:false, roomHasScenario:true });
    h.renderPractice();
    assert.ok(!h.$('p_practice').classList.contains('hidden'),
      'an open scenario never appeared as a practice card in a classroom');
    assert.ok(/practiceChoose\('a'\)/.test(h.$('practiceBody').innerHTML),
      'the practice card never offered a way to actually choose');
  });
  check('a hall room never labels its scenario card as practice, even mid-prep', () => {
    const h = renderPracticeHarness({ kind:'hall', key: HALL_PASS, locked:false, roomHasScenario:true });
    h.renderPractice();
    assert.ok(h.$('p_practice').classList.contains('hidden'),
      'a hall country\'s real scenario card was shown as a disposable rehearsal');
  });
  check('a decided practice card shows the choice made, not the buttons again', () => {
    const h = renderPracticeHarness({ kind:'class', locked:false, roomHasScenario:true,
      chosen:{ scenario:'floods', choice:'a', label:'Build levees', fx:{}, coin:0 } });
    h.renderPractice();
    assert.ok(/Build levees/.test(h.$('practiceBody').innerHTML),
      'a decided practice card did not show what the group chose');
    assert.ok(!/practiceChoose/.test(h.$('practiceBody').innerHTML),
      'a decided practice card still offered clickable choice buttons');
  });

  process.exit(fails ? 1 : 0);
})();
