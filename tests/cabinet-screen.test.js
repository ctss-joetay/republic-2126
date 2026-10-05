/* Spec C §2. Every assertion here is scoped to ONE row — Spec B shipped a
   check that a decoy string anywhere in six concatenated cards satisfied, and
   this file renders four rows that differ only in wording. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFn, APP } = require('./helpers');
const E = require('../game_engine.js');

/* The server's half of the same sentence, pulled out the same way
   tests/mandate.test.js does — the real shipped mandateBlock(), not a
   retyped copy. Used below to bind the client's banner text to the server's
   refusal text directly, rather than trusting that two files which both
   assert against MANDATE_WHAT literals must therefore agree with each
   other: tests/mandate.test.js pins the SERVER side with strictEqual against
   exact literals, but nothing before this bound the CLIENT side to those
   same literals — every client assertion here is a substring or a prefix/
   suffix regex, any of which a wrong-but-plausible client string can satisfy
   while still disagreeing with the server. */
const SRV_FILE = path.join(__dirname, '..', 'server.js');
const leaderNameFn = loadFn('leaderName', {}, SRV_FILE);
const mandateBlockFn = loadFn('mandateBlock', { leaderName: leaderNameFn, E }, SRV_FILE);

let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };
/* setMandate is the one thing here that has to be awaited — it posts, then
   refreshes, and the order of those two is the whole point. Same shape
   tests/hall-build-screen.test.js uses for hallCommit and buyProgramme. */
const checkAsync = async (name, fn) => { ran++; try { await fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

const src = fs.readFileSync(APP, 'utf8');

/* CAB_ROWS is a top-level const ARRAY, so it is not inside the function
   extractFn pulls out and loadFn cannot see it — the same problem
   hall-build-screen.test.js has with GT, solved the same way. Read the REAL
   shipped array out of the source and inject it, rather than stubbing a
   plausible one: renderCabinet's whole job is to turn exactly this list into
   rows, and a stub would let the shipped order, flags and labels rot
   unnoticed while this file stayed green. */
const CAB_ROWS = (() => {
  const m = /^const CAB_ROWS = (\[[\s\S]*?\n\]);$/m.exec(src);
  if (!m) throw new Error('could not find const CAB_ROWS in public/index.html');
  return eval(m[1]);
})();

/* One row out of the rendered list, by the label that names it. Rows are
   <div class="lb">…</div>; splitting on that boundary is what keeps an
   assertion about Education from being satisfied by Defence's row. */
function rowFor(html, label) {
  const rows = html.split('<div class="lb"').slice(1);
  const hit = rows.filter(r => r.includes(label));
  assert.strictEqual(hit.length, 1, `expected exactly one row containing "${label}", got ${hit.length}`);
  return hit[0];
}

function render(members, mandate, minCodes) {
  let html = '', lead = '', codes = '', codesHidden = true;
  const C = { members, mandate, minCodes: minCodes || { infra:'AAAAA', trade:'BBBBB', edu:'CCCCC', def:'DDDDD' } };
  /* No MANDATE_WHAT here on purpose: renderCabinet does not build the refusal
     sentence — mandateBanner does (Task 5). An inert dep documents a design
     that does not exist and misleads the next reader. */
  loadFn('renderCabinet', {
    C, CAB_ROWS, esc: s => String(s),
    $: id => ({
      set innerHTML(v){ if(id === 'cabList') html = v; else if(id === 'cabCodes') codes = v; },
      set textContent(v){ if(id === 'cabLead') lead = v; },
      classList: { toggle(n, f){ if(id === 'cabCodes' && n === 'hidden') codesHidden = f; } }
    })
  })();
  return { html, lead, codes, codesHidden };
}

const FULL = { leader:'Kai', infra:'Mei', trade:'Arun', edu:'Siti', def:'Wei' };
const OPEN = { build:true, site:true, programme:true, ally:true };

check('a held ministry shows its minister by name and a switch', () => {
  const r = render(FULL, OPEN);
  const row = rowFor(r.html, 'Spend on programmes');
  assert.ok(row.includes('Siti'), 'the Education row does not name Siti');
  assert.ok(/setMandate\('programme'/.test(row), 'the Education row has no switch for its own flag');
  /* The other half of the heading's branch. Without this, an UNCONDITIONAL
     lone-Leader heading would satisfy the alone check below and nothing would
     notice a full cabinet being told nobody is holding anything. */
  assert.ok(!/nobody|no one/i.test(r.lead),
    `a cabinet of four is told nobody is holding these jobs: ${JSON.stringify(r.lead)}`);
});

/* The switch as the Leader actually reads it: one class list and one word,
   pulled out of a SINGLE row. Scoped per row on purpose — the list holds four
   buttons and a joined-blob regex is satisfied by any of them. */
function switchIn(row) {
  const all = row.match(/<button class="([^"]*)"[^>]*>([^<]*)<\/button>/g) || [];
  /* Count first. Without this the assertions below read whichever button comes
     first in the row, so a decoy `<button class="sm p">open</button>` dropped
     into the markup rescues an inverted real one — the same shape of rescue
     Spec B shipped and this file's header warns about. */
  assert.strictEqual(all.length, 1,
    `expected exactly one switch in the row, got ${all.length}: ${JSON.stringify(row)}`);
  const m = /<button class="([^"]*)"[^>]*>([^<]*)<\/button>/.exec(all[0]);
  return { classes: m[1].split(/\s+/).filter(Boolean), label: m[2].trim() };
}

check('a switch offers the OPPOSITE of the current state', () => {
  const open = rowFor(render(FULL, OPEN).html, 'Spend on programmes');
  assert.ok(/setMandate\('programme',\s*false\)/.test(open), 'an open door does not offer to close');
  const shut = rowFor(render(FULL, { ...OPEN, programme:false }).html, 'Spend on programmes');
  assert.ok(/setMandate\('programme',\s*true\)/.test(shut), 'a closed door does not offer to reopen');

  /* The onclick payload above was, until now, the ONLY thing pinned about this
     button. Inverting BOTH the label word and the `p` highlight — so every
     open door read "closed" with nothing lit — left the entire suite green.
     What the Leader actually sees was therefore undefended.

     This pins what SHIPS today: the button LABELS THE CURRENT STATE ("open" on
     an open door) and carries `p` while open, while the opposite goes into the
     onclick. Whether a control should read its state or its action is an open
     question for the browser pass — either answer is fine, but it has to be
     chosen deliberately and this check is what forces that. If the browser
     pass flips the label, flip these two assertions with it. */
  const openSw = switchIn(open);
  assert.strictEqual(openSw.label, 'open',
    `an open door's switch reads ${JSON.stringify(openSw.label)} — the Leader is shown the wrong state`);
  assert.ok(openSw.classes.includes('p'),
    `an open door's switch is not highlighted (classes: ${JSON.stringify(openSw.classes)})`);

  const shutSw = switchIn(shut);
  assert.strictEqual(shutSw.label, 'closed',
    `a closed door's switch reads ${JSON.stringify(shutSw.label)} — the Leader is shown the wrong state`);
  assert.ok(!shutSw.classes.includes('p'),
    `a closed door's switch is still highlighted (classes: ${JSON.stringify(shutSw.classes)}) — ` +
    'nothing on the Cabinet screen marks the door that is shut');
});

check('closing one ministry leaves the other three rows open', () => {
  const r = render(FULL, { ...OPEN, programme:false });
  for (const [label, flag] of [['Build things','build'], ['Open industry','site'], ['Make alliances','ally']]) {
    const row = rowFor(r.html, label);
    assert.ok(new RegExp(`setMandate\\('${flag}',\\s*false\\)`).test(row),
      `${label} lost its open state when Education was closed`);
  }
});

/* Matching the server's gate, which is `!== false`: a country whose mandate
   never arrived, or arrived with junk in it, plays exactly as it always did.
   A client that asked `=== true` instead would draw four closed doors over a
   server that is refusing nothing. */
check('anything that is not literally false reads as open', () => {
  for (const junk of [undefined, {}, { programme:'false' }, { programme:1 }]) {
    const row = rowFor(render(FULL, junk).html, 'Spend on programmes');
    assert.ok(/setMandate\('programme',\s*false\)/.test(row),
      `a mandate of ${JSON.stringify(junk)} drew Education as closed — the server would still allow it`);
  }
});

check('a Leader alone gets no switches, and the codes to fix it', () => {
  const r = render({ leader:'Kai', infra:'', trade:'', edu:'', def:'' }, OPEN);
  assert.ok(!/setMandate/.test(r.html), 'a cabinet with nobody in it still rendered switches');
  for (const label of ['Build things','Open industry','Spend on programmes','Make alliances'])
    assert.ok(rowFor(r.html, label).includes('no one'), `${label} does not say nobody holds it`);
  assert.strictEqual(r.codesHidden, false, 'the codes block stayed hidden for a Leader with no ministers');
  for (const c of ['AAAAA','BBBBB','CCCCC','DDDDD'])
    assert.ok(r.codes.includes(c), `code ${c} is not offered`);
  assert.ok(/four/i.test(r.lead + r.codes), 'nothing says how many jobs one student is doing');
});

/* Each code has to sit against the job it opens, or a Leader reading four
   five-letter strings off a shared iPad hands out the wrong one and the
   student who takes it lands in someone else's ministry.
   Sliced per entry rather than searched over the whole block: the block is one
   string, so `/⚖️[^A-Z]*TTTTT/.test(codes)` is satisfied by a decoy pair
   dropped anywhere in it — the same shape that got through in Spec B. The
   count assertion is what makes the separator load-bearing instead of a
   guess. */
check('each handed-out code is offered beside its own ministry', () => {
  const codes = { infra:'IIIII', trade:'TTTTT', edu:'EEEEE', def:'DDDDD' };
  const r = render({ leader:'Kai', infra:'', trade:'', edu:'', def:'' }, OPEN, codes);
  const entries = r.codes.split(' &nbsp; ');
  assert.strictEqual(entries.length, CAB_ROWS.length,
    `expected one code entry per ministry, got ${entries.length}`);
  CAB_ROWS.forEach(([role,, ic], i) => {
    assert.ok(entries[i].includes(ic), `the ${role} entry does not name the ministry`);
    assert.ok(entries[i].includes(codes[role]),
      `the ${role} entry offers ${JSON.stringify(entries[i])} instead of ${role}'s own code`);
  });
});

check('the half-empty cabinet renders both kinds of row in one list', () => {
  const r = render({ leader:'Kai', infra:'Mei', trade:'', edu:'Siti', def:'' }, OPEN);
  assert.ok(/setMandate\('build'/.test(rowFor(r.html, 'Build things')), 'Mei got no switch');
  assert.ok(rowFor(r.html, 'Open industry').includes('no one'), 'the empty Trade seat got a switch');
  assert.ok(/setMandate\('programme'/.test(rowFor(r.html, 'Spend on programmes')), 'Siti got no switch');
  assert.ok(rowFor(r.html, 'Make alliances').includes('no one'), 'the empty Defence seat got a switch');
  assert.strictEqual(r.codesHidden, true, 'the hand-out-codes block showed for a group that has ministers');
});

/* Drives the REAL renderHall, in the shape tests/hall-build-screen.test.js
   settled on. Do not assert the Cabinet chip's existence by grepping
   renderHall's source, and do not assert it via gtLabel: Cabinet is a sub-chip
   INSIDE the Leader's fifth tab, never a fifth tab of its own, so
   `gtLabel(...).some(k => k === 'cabinet')` is false for every role including
   the Leader — an assertion that cannot fail. */
function hallPanes(role, sub){
  const els = {};
  const paneStub = () => { const cl = new Set(['pane','hidden']);
    return { innerHTML:'', textContent:'', cl, classList:{
      toggle(n,f){ if(f) cl.add(n); else cl.delete(n); },
      add(n){ cl.add(n); }, remove(n){ cl.delete(n); }, contains(n){ return cl.has(n); } } }; };
  const $ = id => els[id] || (els[id] = paneStub());
  const S = { role, phase:'game' };
  const C = E.blankCountry(); C.members = { ...FULL };
  loadFn('renderHall', {
    S, C, HALL_SUB: sub, $, ENGINE: E, RES: E.RES, esc: s => String(s),
    hallKind: loadFn('hallKind', { S }),
    canBuild: loadFn('canBuild', { S }), canSite: loadFn('canSite', { S }),
    renderPeople: () => {}, renderLand: () => {}, renderTray: () => {},
    renderProgrammes: () => {}, renderCabinet: () => {},
    mandateBanner: () => ''
  })();
  return els;
}

check('the Leader can open the Cabinet pane', () => {
  const els = hallPanes('leader', 'cab');
  assert.ok(els.cabPane && !els.cabPane.cl.has('hidden'),
    'the Leader asked for Cabinet and the pane stayed hidden');
});

/* The Cabinet chip has to be offered, or HALL_SUB can never become 'cab' on a
   real iPad and the pane above is unreachable — and the three Spec B chips are
   not collateral, because adding a fourth by rewriting the array is how one of
   them quietly goes missing. Read out of the switcher renderHall actually
   wrote, never out of its source; and sliced per chip, so a decoy
   `HALL_SUB='prog'` sitting in the Cabinet chip's own markup makes this red
   rather than green. */
const chips = html => html.split('<div class="tab').slice(1);

check('the switcher offers exactly the four sub-tabs, one chip each', () => {
  const c = chips(hallPanes('leader', 'cab').hallSub.innerHTML);
  assert.strictEqual(c.length, 4, `expected four chips in the Leader's switcher, got ${c.length}`);
  for (const k of ['hbuild','hind','prog','cab']) {
    const hit = c.filter(x => x.includes(`HALL_SUB='${k}'`));
    assert.strictEqual(hit.length, 1,
      `expected exactly one chip switching to '${k}', got ${hit.length}`);
  }
});

check('the Cabinet chip is the lit one while the Cabinet is showing', () => {
  const c = chips(hallPanes('leader', 'cab').hallSub.innerHTML);
  const lit = c.filter(x => x.startsWith(' on"'));
  assert.strictEqual(lit.length, 1, `exactly one chip must be lit, ${lit.length} are`);
  assert.ok(lit[0].includes("HALL_SUB='cab'"),
    'the Cabinet screen is showing but another chip is lit');
});

check('opening the Cabinet puts the land and the catalogue away', () => {
  const els = hallPanes('leader', 'cab');
  for (const id of ['hbuildPane','hindPane','progPane'])
    assert.ok(els[id].cl.has('hidden'),
      `#${id} is still on screen underneath the Cabinet — two panes are stacked`);
});

check('a minister never reaches the Cabinet pane, even asking for it by name', () => {
  /* HALL_SUB is the Leader's own switcher state, so a minister should never
     carry 'cab' — but a stale value or a rejoin must not open someone else's
     screen either. */
  for (const role of ['infra','trade','edu','def']) {
    const els = hallPanes(role, 'cab');
    assert.ok(!els.cabPane || els.cabPane.cl.has('hidden'),
      `the ${role} minister was shown the Cabinet pane`);
  }
});

/* An un-hidden #cabPane is an empty card until renderCabinet runs — the same
   defect paintGame had with #g_ministry, one level down. */
check('showing the Cabinet pane also fills it', () => {
  const drawn = [];
  const els = {};
  const paneStub = () => { const cl = new Set(['pane','hidden']);
    return { innerHTML:'', textContent:'', cl, classList:{
      toggle(n,f){ if(f) cl.add(n); else cl.delete(n); },
      add(n){ cl.add(n); }, remove(n){ cl.delete(n); }, contains(n){ return cl.has(n); } } }; };
  const $ = id => els[id] || (els[id] = paneStub());
  const S = { role:'leader', phase:'game' };
  const C = E.blankCountry(); C.members = { ...FULL };
  const mk = sub => loadFn('renderHall', {
    S, C, HALL_SUB: sub, $, ENGINE: E, RES: E.RES, esc: s => String(s),
    hallKind: loadFn('hallKind', { S }),
    canBuild: loadFn('canBuild', { S }), canSite: loadFn('canSite', { S }),
    renderPeople: () => {}, renderLand: () => {}, renderTray: () => {},
    renderProgrammes: () => {}, renderCabinet: () => drawn.push('cab'),
    mandateBanner: () => ''
  })();
  mk('cab');
  assert.deepStrictEqual(drawn, ['cab'],
    'the Cabinet pane was un-hidden and never filled — the Leader gets a blank card');
  mk('hbuild');
  assert.deepStrictEqual(drawn, ['cab'],
    'renderCabinet ran for a sub-tab that is not the Cabinet');
});

/* ---------------- the minister's banner ----------------

   One line at the top of a closed ministry's own tab, before anything is
   tappable. Silence is the normal state — an open ministry must draw NOTHING,
   not an empty div, or the banner stops being read the moment it is always
   there.

   `role` defaults to a MINISTER, because that is who the banner is written
   for. The Leader's own case is a separate check below: mandateBanner
   short-circuits on 'leader' exactly as the server's mandateBlock does, so a
   Leader is never told to go and ask themselves. */
const banner = (flag, mandate, members, role) => loadFn('mandateBanner', {
  S: { role: role || 'edu' },
  C: { mandate, members: members || { leader:'Kai' } },
  esc: s => String(s), MANDATE_WHAT: E.MANDATE_WHAT
})(flag);

check('an open ministry draws no banner at all', () => {
  /* Assert the ABSENCE. A banner that is always there stops being read, and
     that is the failure this check exists to catch. */
  for (const f of E.MANDATE_FLAGS)
    assert.strictEqual(banner(f, OPEN), '', `${f} drew a banner while open`);
});

check('a closed ministry names the Leader and what is closed', () => {
  const html = banner('programme', { ...OPEN, programme:false });
  assert.ok(html.includes('Kai'), 'the banner does not name the Leader');
  assert.ok(html.includes(E.MANDATE_WHAT.programme), 'the banner does not say what is closed');
  assert.ok(/ask/i.test(html), 'the banner does not tell the student to go and ask');
  /* Not just "Kai appears somewhere" — the OPENING clause and the "ask ___"
     clause each fall back independently from the same raw name, so dropping
     the name from either one alone still leaves 'Kai' in the string via the
     other. Pin BOTH positions, not just the opening one: a banner that reads
     "Kai has closed building. Go and ask them." (ask-clause dropped, server
     says "...ask Kai.") is exactly the tab-versus-toast drift this feature
     exists to prevent, and a check that only pins the front half cannot see
     it. */
  assert.ok(/^<div[^>]*>Kai has closed/.test(html),
    `the Leader's name is not the subject of "has closed": "${html}"`);
  assert.ok(/Go and ask Kai\.<\/div>$/.test(html),
    `the Leader's name is missing from the "ask" clause: "${html}"`);
});

check('a Leader is never told to go and ask themselves', () => {
  /* The server's mandateBlock() returns null for role==='leader' BEFORE it
     even reads the flag, so a Leader who has closed Build still builds. If
     the client drew the banner anyway, that Leader would open their own
     🏗️ Build chip, read "Kai has closed building. Go and ask Kai." — an
     instruction to go and negotiate with themselves — and then find the tap
     works regardless. It is the one place client and server could disagree
     about this rule. Every flag, and a name present as well as absent. */
  for (const flag of E.MANDATE_FLAGS) {
    for (const leader of ['Kai', '']) {
      assert.strictEqual(banner(flag, { ...OPEN, [flag]:false }, { leader }, 'leader'), '',
        `the Leader was shown the ${flag} banner (leader name ${JSON.stringify(leader)}) — ` +
        'the server does not bind them, so this line tells them to go and ask themselves');
    }
  }
  /* The same call with a minister's role MUST still draw, or the check above
     is satisfied by a mandateBanner that returns '' for everybody. */
  for (const flag of E.MANDATE_FLAGS)
    assert.ok(banner(flag, { ...OPEN, [flag]:false }, { leader:'Kai' }, 'infra').includes('Kai'),
      `the ${flag} banner went silent for a minister too — nobody is being told anything`);
});

check('a missing or malformed mandate flag reads as open, never as closed', () => {
  /* Same fail-open contract as the server's mandateBlock() — see server.js's
     "!== false and not === false inverted" comment. Absent, half-written or
     malformed mandate data must never lock a minister out; only an explicit
     `false` may. This is the one property none of the checks above exercise,
     since they all pass explicit true/false values. */
  for (const junk of [undefined, {}, { build:'false' }, { build:1 }, { build:null }])
    assert.strictEqual(banner('build', junk), '',
      `a mandate of ${JSON.stringify(junk)} drew a banner — the server would still allow the tap`);
});

check('each flag draws only its own banner', () => {
  /* Looped over all four flags, not just build-vs-programme: 'site' and
     'ally' were previously pinned nowhere in THIS check (site is exercised
     alone elsewhere, ally only via the trade-tab checks below, and neither
     was ever checked against a wrong-flag phrase substitution here). Every
     flag is checked to carry its own phrase and NONE of the other three's —
     a minister sent to argue about the wrong closed door is the exact
     failure this feature exists to prevent. */
  for (const flag of E.MANDATE_FLAGS) {
    const html = banner(flag, { ...OPEN, [flag]:false });
    assert.ok(html.includes(E.MANDATE_WHAT[flag]), `the ${flag} banner does not mention its own phrase`);
    for (const other of E.MANDATE_FLAGS) {
      if (other === flag) continue;
      assert.ok(!html.includes(E.MANDATE_WHAT[other]), `the ${flag} banner also mentions ${other}'s phrase`);
    }
  }
});

check('the banner reads IDENTICALLY to the server refusal for the same door', () => {
  /* MANDATE_WHAT lives in the engine block precisely so the wording cannot
     drift — but nothing before this asserted the two SENTENCES agree, only
     that each side separately contains its own literals. Drive both the
     real mandateBanner (client, public/index.html) and the real
     mandateBlock (server, server.js) from the same team shape, over every
     flag and three leader-name states, and diff the text directly. A
     student reading one thing on their own tab and a different thing in the
     Leader's refusal toast is the exact failure this check exists to catch.

     Run over EVERY role, not only a minister. Silence is part of the same
     contract: the server answers null for role==='leader' and the client must
     answer '' for the same team, or the Leader reads a rule on their own
     screen that the server does not enforce on them. Binding both roles here
     means the two short-circuits move together — neither implementation can
     grow or lose one without this going red. */
  for (const flag of E.MANDATE_FLAGS) {
    for (const role of ['leader', 'infra', 'trade', 'edu', 'def']) {
      for (const leaderName of ['Kai', '', '   ']) {
        const members = { leader: leaderName };
        const html = banner(flag, { ...OPEN, [flag]:false }, members, role);
        /* '' has to stay '' — stripping the wrapper off an empty string would
           turn "drew nothing" into "drew nothing", which is the same answer,
           but being explicit keeps the two silences distinguishable in the
           failure message. */
        const clientText = html === '' ? null
          : html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
        const team = { mandate: { [flag]:false }, members };
        const serverText = mandateBlockFn(team, role, flag);
        assert.strictEqual(clientText, serverText,
          `flag=${flag} role=${role} leader=${JSON.stringify(leaderName)}: ` +
          `client says ${JSON.stringify(clientText)}, server says ${JSON.stringify(serverText)}`);
      }
    }
  }
});

check('a nameless Leader still reads as a sentence', () => {
  const html = banner('build', { ...OPEN, build:false }, { leader:'' });
  assert.ok(/Your Leader has closed building/.test(html), `reads wrong: "${html}"`);
  assert.ok(/ask them/.test(html), `the nameless fallback pronoun is wrong: "${html}"`);
});

check('a Leader name that looks like HTML is escaped, not stringified', () => {
  /* Every check above stubs esc as `String(s)`, which cannot distinguish an
     escaped interpolation from an unescaped one — dropping esc() from either
     the "who" clause or the "ask" clause would leave every check above
     green. Wire the REAL esc() (extracted from the shipped source, no deps
     of its own) in for this one check, and drive a Leader name a student
     could actually type into the join screen. Coverage only: the shipped
     mandateBanner already escapes both positions. */
  const realEsc = loadFn('esc', {});
  const html = loadFn('mandateBanner', {
    S: { role:'infra' },
    C: { mandate:{ build:false }, members:{ leader:'<b>Kai</b>' } },
    esc: realEsc, MANDATE_WHAT: E.MANDATE_WHAT
  })('build');
  assert.ok(!html.includes('<b>Kai</b>'), `the Leader's name reached the page unescaped: "${html}"`);
  assert.ok(html.includes('&lt;b&gt;Kai&lt;/b&gt;'),
    `the Leader's name was not escaped in both the "who" and "ask" clauses: "${html}"`);
});

check('the banner is drawn on each pane that can be closed', () => {
  /* Comments stripped first — a source-text grep is satisfiable by a comment
     carrying the asserted call, which parses to nothing and draws nobody a
     banner. Same idiom tests/hall-build-screen.test.js uses for NO_POINTER.
     Both comment forms: a `//` line comment carrying the exact asserted text
     satisfied the `/\*...\*\/`-only strip this check shipped with — Cmd+/ on
     a call site while debugging emits exactly that, so a debugging edit left
     in place would have shipped a silent regression. This grep is now a
     second line of defence; the behavioural harness below it is the one that
     actually proves a pane receives a banner. */
  const fn = src.slice(src.indexOf('function renderHall'), src.indexOf('function renderCabinet'))
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');
  for (const f of ['build','site','programme'])
    assert.ok(new RegExp(`\\$\\('\\w+Mandate'\\)\\.innerHTML = mandateBanner\\('${f}'\\)`).test(fn),
      `renderHall never draws the ${f} banner into a real element`);
});

/* Behavioural companion to the grep above, in the same shape as
   paintTradeHarness below: drives the REAL renderHall with the REAL
   mandateBanner wired in (not a stub, not a source scrape), so a call site
   hidden behind ANY comment syntax, or one that runs but writes into the
   wrong element, or one that is only reachable via a HALL_SUB the grep
   never checks, shows up here by its actual effect. This is what makes the
   source grep above unnecessary in principle — kept anyway as a second,
   cheaper line of defence, since a grep failure is faster to read than a
   harness failure. HALL_SUB:'prog' is enough to exercise all three panes in
   one call: renderHall sets hbuildMandate and hindMandate on EVERY call
   regardless of which sub-tab is showing (public/index.html:5724-5725, both
   outside the `if(kind)` guard), and progMandate whenever `prog` is true.

   `role` is a parameter and NOT fixed at 'leader', which is what it used to
   be. That pinned the wrong behaviour as correct: with a Leader driving it,
   these checks asserted the banners WERE drawn on the Leader's own panes —
   the exact defect the role short-circuit now fixes. 'edu' is the minister
   role that reaches all three anchors in one call (hbuild/hind are
   unconditional; `prog` is `S.role === 'edu'` for a non-leader), so it is
   what the "banners are drawn" cases use; 'leader' is now the case that
   asserts they are NOT. */
function renderHallHarness(mandate, members, role){
  const els = {};
  const paneStub = () => { const cl = new Set(['hidden']);
    return { innerHTML:'', textContent:'', cl, classList:{
      toggle(n,f){ if(f===undefined){ if(cl.has(n)) cl.delete(n); else cl.add(n); } else if(f) cl.add(n); else cl.delete(n); },
      add(n){ cl.add(n); }, remove(n){ cl.delete(n); }, contains(n){ return cl.has(n); } } }; };
  const $ = id => els[id] || (els[id] = paneStub());
  const S = { role: role || 'edu', phase:'game' };
  const C = E.blankCountry();
  C.homeland = 'delta';
  C.mandate = mandate;
  C.members = members || { leader:'Kai' };
  const mandateBanner = loadFn('mandateBanner', { S, C, esc: s => String(s), MANDATE_WHAT: E.MANDATE_WHAT });
  const renderHall = loadFn('renderHall', {
    S, C, HALL_SUB:'prog', $, ENGINE: E, RES: E.RES, esc: s => String(s),
    hallKind: loadFn('hallKind', { S }),
    canBuild: loadFn('canBuild', { S }), canSite: loadFn('canSite', { S }),
    renderPeople: () => {}, renderLand: () => {}, renderTray: () => {},
    renderProgrammes: () => {}, renderCabinet: () => {},
    mandateBanner
  });
  renderHall();
  return els;
}

check('a real renderHall run draws the build, industry and programme banners into their own elements', () => {
  const els = renderHallHarness({ ...OPEN, build:false, site:false, programme:false });
  assert.ok(els.hbuildMandate && els.hbuildMandate.innerHTML.includes(E.MANDATE_WHAT.build),
    'a real renderHall run never put a banner in #hbuildMandate');
  assert.ok(els.hindMandate && els.hindMandate.innerHTML.includes(E.MANDATE_WHAT.site),
    'a real renderHall run never put a banner in #hindMandate');
  assert.ok(els.progMandate && els.progMandate.innerHTML.includes(E.MANDATE_WHAT.programme),
    'a real renderHall run never put a banner in #progMandate');
});

check('a real renderHall run draws no banner on the Leader\'s own panes', () => {
  /* Same three closed doors as the check above, driven by the Leader who
     closed them. The server lets that Leader build, site and buy anyway
     (mandateBlock short-circuits on role==='leader'), so a banner here is the
     screen contradicting the server on the Leader's own iPad — and it says
     "Go and ask Kai" to Kai. HALL_SUB:'prog' means all three anchors are
     written on this call, so all three are asserted empty rather than merely
     never touched. */
  const els = renderHallHarness({ ...OPEN, build:false, site:false, programme:false },
    { leader:'Kai' }, 'leader');
  for (const id of ['hbuildMandate','hindMandate','progMandate'])
    assert.strictEqual(els[id] && els[id].innerHTML, '',
      `#${id} told the Leader to go and ask themselves — the tap works anyway`);
});

check('a real renderHall run draws no banner anywhere while every door is open', () => {
  const els = renderHallHarness(OPEN);
  assert.strictEqual(els.hbuildMandate && els.hbuildMandate.innerHTML, '', '#hbuildMandate drew a banner while open');
  assert.strictEqual(els.hindMandate && els.hindMandate.innerHTML, '', '#hindMandate drew a banner while open');
  assert.strictEqual(els.progMandate && els.progMandate.innerHTML, '', '#progMandate drew a banner while open');
});

/* Defence has no tab of its own — the alliance checkbox lives on the shared
   trade tab, drawn by paintGame, not renderHall. Driven through the REAL
   paintGame with the REAL mandateBanner wired in (not a stub), so a call site
   that never reaches the trade branch, or one wired to the wrong flag, shows
   up here rather than only in a source-text grep for the function name. */
function paintTradeHarness(mandate, members, role){
  const els = {};
  const paneStub = () => { const cl = new Set(['hidden']);
    return { innerHTML:'', textContent:'', cl, classList:{
      toggle(n,f){ if(f===undefined){ if(cl.has(n)) cl.delete(n); else cl.add(n); } else if(f) cl.add(n); else cl.delete(n); },
      add(n){ cl.add(n); }, remove(n){ cl.delete(n); }, contains(n){ return cl.has(n); } } }; };
  const $ = id => els[id] || (els[id] = paneStub());
  /* 'def' by default: the Trade tab is shared, but Defence is the role this
     banner exists for — they have no tab of their own. The Leader is a
     separate case below, where the banner must NOT appear. */
  const S = { role: role || 'def', round:1, maxRounds:3, scenario:null, code:'QBXND', board:[] };
  const C = { name:'Solaria', coins:10, mandate, members: members || { leader:'Kai' } };
  const mandateBanner = loadFn('mandateBanner', { S, C, esc: s => String(s), MANDATE_WHAT: E.MANDATE_WHAT });
  const paintGame = loadFn('paintGame', {
    $, document: { querySelectorAll: () => [] },
    gtLabel: () => [['trade','🔁','Trade']], GTAB: 'trade',
    S, C, GAME: { rounds:3 }, ENGINE: E, esc: s => String(s),
    renderTrade: () => {}, mandateBanner,
    /* Spec D's banner is not what this file is testing — a stub that draws
       nothing keeps this harness pinned to the trade-tab mandate banner it
       was built for. */
    strikeBanner: () => '', offersWaiting: () => 0, tradeShutFor: () => 0,
    roleCan: () => true, RO: () => false
  });
  paintGame();
  return els;
}

check('a closed alliance door draws its banner on the shared trade tab', () => {
  const els = paintTradeHarness({ ...OPEN, ally:false });
  assert.ok(els.tradeMandate && els.tradeMandate.innerHTML.includes(E.MANDATE_WHAT.ally),
    'closing ally left #g_trade silent — Defence has no pane of its own, so this is the only place a Defence Minister would ever see it');
});

check('the Leader who closed the alliance door sees no banner on the trade tab', () => {
  /* The fourth call site, and the Leader shares this tab with everyone else.
     The server still lets them propose and accept, so a line here would send
     the Leader to negotiate with themselves. */
  const els = paintTradeHarness({ ...OPEN, ally:false }, { leader:'Kai' }, 'leader');
  assert.strictEqual(els.tradeMandate && els.tradeMandate.innerHTML, '',
    'the Leader was told on the trade tab to go and ask themselves about their own alliance door');
});

check('an open alliance door draws no banner on the trade tab', () => {
  const els = paintTradeHarness(OPEN);
  assert.strictEqual(els.tradeMandate && els.tradeMandate.innerHTML, '',
    'the trade tab drew a banner while the alliance door was open');
});

/* ---------------- the write path ----------------

   setMandate is the only thing in this whole feature that WRITES, and until
   now nothing pinned it: emptying its body left the full suite at exit 0.

   The server contract is what makes that worth more than a shrug.
   'POST /api/team/mandate' moves a flag only `if(typeof m[k] === 'boolean')`
   and then answers `{ok:true}` either way — so a body carrying "false", or 0,
   or a missing key, is accepted in full, changes nothing, raises no error and
   produces no toast. The refresh behind it redraws the door exactly as it was
   and the Leader taps a switch that never moves, in front of their group.
   Hence the strict typeof assertion below: `deepStrictEqual` on the body
   already distinguishes false from "false", but naming the type separately is
   what says WHY a string would be a defect rather than a cosmetic difference.

   C is injected holding a full open mandate, and every check asserts it comes
   back untouched: the server is the only thing that holds the mandate, so a
   refusal has to arrive as an unchanged switch rather than one the client has
   to put back. */
const mandateHarness = (flag, value, reply) => {
  const posts = [], order = [];
  const C = { mandate: { build:true, site:true, programme:true, ally:true } };
  const setMandate = loadFn('setMandate', {
    S: { code:'QBXND' }, C,
    api: (m, p, b) => { posts.push([m, p, b]); order.push('post'); return Promise.resolve(reply || { ok:true }); },
    toast: t => order.push('toast:' + t),
    refresh: () => { order.push('refresh'); return Promise.resolve(); },
    renderHall: () => order.push('render')
  });
  return setMandate(flag, value).then(() => ({ posts, order, C }));
};

(async () => {

  /* Driven over every flag, in both directions, in ONE check — and asserting
     the whole `posts` array rather than posts[0].

     Both of those are load-bearing, and neither was in the first draft. A
     mutation run proved it: gutting setMandate and inserting an unconditional
     `api('POST','/api/team/mandate',{code:'QBXND',mandate:{programme:false}})`
     — a hard-coded body carrying exactly the asserted values — turned the
     single-case version of this check green over a function that no longer
     read `flag` or `value` at all. Eight cases cannot be satisfied by one
     hard-coded body, and a whole-array assertion cannot be satisfied by a
     decoy post sitting alongside the real one. */
  const CASES = [];
  for (const flag of E.MANDATE_FLAGS) CASES.push([flag, false], [flag, true]);

  await checkAsync('setMandate posts the one flag the switch was for, and nothing else', async () => {
    for (const [flag, value] of CASES) {
      const { posts } = await mandateHarness(flag, value);
      assert.deepStrictEqual(posts, [['POST', '/api/team/mandate',
        { code:'QBXND', mandate:{ [flag]:value } }]],
        `setMandate(${flag}, ${value}) did not post that flag under the shape the server reads`);
    }
  });

  await checkAsync('closing one door does not restate the other three', async () => {
    /* A body naming all four would make every tap an overwrite of the whole
       mandate, so two Leaders' devices — or one device holding a stale C —
       could reopen a door nobody reopened. The server's per-key loop is what
       makes a one-key body safe; posting one key is what makes it true. */
    const { posts } = await mandateHarness('ally', false);
    assert.deepStrictEqual(Object.keys(posts[0][2].mandate), ['ally'],
      `the body names flags the tap was not about: ${JSON.stringify(posts[0][2].mandate)}`);
  });

  await checkAsync('the posted value is a real boolean, which is all the server will act on', async () => {
    for (const [flag, value] of CASES) {
      const { posts } = await mandateHarness(flag, value);
      /* posts.length first: without it this reads posts[0], and an
         unconditional decoy post inserted ahead of the real one supplies a
         well-typed body for a function that never posted one. */
      assert.strictEqual(posts.length, 1, `setMandate(${flag}) made ${posts.length} requests, not one`);
      const sent = posts[0][2].mandate[flag];
      assert.strictEqual(typeof sent, 'boolean',
        `${flag} was posted as a ${typeof sent} (${JSON.stringify(sent)}) — the server's ` +
        '`typeof m[k] === "boolean"` guard discards it, still answers {ok:true}, and the ' +
        'switch never moves in front of the group');
      assert.strictEqual(sent, value, `${flag} was posted as ${sent}, not the ${value} the switch offered`);
    }
  });

  await checkAsync('setMandate refreshes AFTER the post, then redraws', async () => {
    const { order } = await mandateHarness('programme', false);
    assert.deepStrictEqual(order, ['post', 'refresh', 'render'],
      'the refresh did not follow the post — the switch on screen is the one the tap did not cause');
  });

  await checkAsync('setMandate never moves the flag in C itself', async () => {
    const { C } = await mandateHarness('programme', false);
    assert.deepStrictEqual(C.mandate, { build:true, site:true, programme:true, ally:true },
      'setMandate flipped the flag locally instead of leaving that to the server — a refusal now has to be walked back');
  });

  await checkAsync('a refusal is spoken, and the screen is never refreshed on top of it', async () => {
    const { order } = await mandateHarness('programme', false,
      { error:'Only your Leader can set what the cabinet may do.' });
    assert.deepStrictEqual(order, ['post', 'toast:Only your Leader can set what the cabinet may do.'],
      'a refusal still refreshed or redrew instead of stopping at the toast');
  });

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
