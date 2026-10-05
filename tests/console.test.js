/* The console is where a teacher does the things only a teacher can do. The
   first block below is source-level: the endpoints are already covered
   server-side, what is pinned here is that the console actually reaches
   them — a grep is the right tool for "does this exist at all", and every
   pattern below has been checked for uniqueness in public/host.html so it
   cannot be satisfied by an unrelated occurrence of the same word.

   The second block is behavioural: renderRoster(), refreshRoster(),
   modCountry(), askRenameCountry(), removeCountry(), reopenCountry(),
   pullIn(), setGroups(), toggleOpenJoin() and filterRoster() are extracted
   straight out of the shipped host.html with loadFn-style Function()
   injection (the same idiom as tests/client-identity.test.js and
   tests/member-mode.test.js) and run against a DOM stub — no grepping the
   source for what these actually do.

   Round 2, after review: the hall's "Allow open joining" leak, the
   host-key-on-paper leak, the un-pinned code chips, the un-confirmed
   askRename chain, hall ordering, the un-confirmed shrink, and the
   under-cursor rebuild are all pinned below — see the comment above each
   block for which review finding it closes. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../game_engine.js');

const H = fs.readFileSync(path.join(__dirname, '..', 'public', 'host.html'), 'utf8');
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

/* ============================================================
   EXISTENCE CHECKS — the console reaches every route it must
   ============================================================ */
check('a teacher can choose which kind of room to open', () => {
  assert.ok(/kind:\s*'class'/.test(H), 'no way to open a classroom room');
  assert.ok(/kind:\s*'hall'/.test(H), 'no way to open a hall room');
  assert.ok(/id="newLabel"/.test(H), 'a classroom room cannot be labelled');
});
check('groups can be provisioned', () => {
  assert.ok(/api\/host\/groups/.test(H), 'the console never provisions groups');
  assert.ok(/function setGroups\(/.test(H), 'setGroups() is missing');
});
check('the roster shows both codes and the homeland', () => {
  assert.ok(/function renderRoster\(/.test(H), 'renderRoster() is missing');
  assert.ok(/viewCode/.test(H), 'the class code is never shown to the teacher');
  assert.ok(/api\/host\/roster/.test(H), 'the roster is never refreshed');
});
check('names can be vetted', () => {
  assert.ok(/askRename/.test(H), 'a teacher cannot bounce a name back');
  assert.ok(/'rename'/.test(H), 'a teacher cannot fix a name directly');
  assert.ok(/'reopen'/.test(H), 'a teacher cannot reopen a committed country');
});
check('the commit gate exists', () => {
  assert.ok(/committed/.test(H), 'the console never counts committed countries');
  assert.ok(/finishBtn/.test(H), 'there is no Finish session control to gate');
});
check('the hall can rescue a stranded country', () => {
  assert.ok(/'pull'/.test(H), 'the console cannot pull a country in by code');
});
check('practice cards are shown as a budget', () => {
  assert.ok(/practiceLeft/.test(H), 'the console never shows how many practice cards remain');
});
check('open joining can be turned back on', () => {
  assert.ok(/openjoin/i.test(H), 'the rollback lever is missing from the console');
});

/* -------- Critical 2 (review): the printable sheet must never carry the
   host key, and must carry the label and room code instead -------- */
check('the header carrying the host key is excluded from print', () => {
  const headerMatch = /<div class="row between wrapf noprint"[^>]*>\s*<div><h1>/.exec(H);
  assert.ok(headerMatch, 'the header holding #hostPills is missing its noprint class');
});
check('a print-only heading exists, and it is not where the host key lives', () => {
  const block = /<div class="printhead">[\s\S]*?<\/div>\s*<\/div>/.exec(H);
  assert.ok(block, 'no print-only heading block was found');
  assert.ok(/id="printLabel"/.test(block[0]) && /id="printRoom"/.test(block[0]),
    'the print-only heading does not carry a label or a room code element');
  assert.ok(!/hostPills|R\.key|host key/.test(block[0]),
    'the print-only heading references the host key — that credential must never be printable');
});

/* The two markup checks above only prove the classes exist on the right
   elements — they say nothing about what @media print actually DOES with
   those classes. Reviewer proved this is a real, invisible-to-those-two-
   checks regression: deleting `.noprint,button{display:none!important}`
   left every one of the (then) 311 assertions green while the host key
   printed anyway. Extract the @media print block itself (brace-matched, not
   regex-bounded, since it nests other rule blocks) and assert on the actual
   rule bodies for the two classes that carry the whole security property. */
function extractMediaPrint() {
  const marker = '@media print{';
  const start = H.indexOf(marker);
  if (start === -1) throw new Error('no @media print block found in public/host.html');
  let i = start + marker.length, depth = 1;
  while (depth > 0 && i < H.length) {
    if (H[i] === '{') depth++;
    else if (H[i] === '}') depth--;
    i++;
  }
  return H.slice(start, i);
}
function ruleBody(selectorRe, cssText) {
  const m = selectorRe.exec(cssText);
  if (!m) return null;
  const braceStart = cssText.indexOf('{', m.index);
  const braceEnd = cssText.indexOf('}', braceStart);
  return cssText.slice(braceStart + 1, braceEnd);
}
check('@media print genuinely hides .noprint content (and buttons), not just carries the class', () => {
  const block = extractMediaPrint();
  const body = ruleBody(/\.noprint\b[^{]*/, block);
  assert.ok(body, 'no CSS rule targeting .noprint was found inside @media print');
  assert.ok(/display:\s*none\s*!important/.test(body),
    '.noprint is not actually hidden with !important under @media print — the host key would print again');
});
check('@media print genuinely shows .printhead, not just carries the class', () => {
  const block = extractMediaPrint();
  const body = ruleBody(/\.printhead\b[^{]*/, block);
  assert.ok(body, 'no CSS rule targeting .printhead was found inside @media print');
  assert.ok(/display:\s*block\s*!important/.test(body),
    '.printhead is not actually shown under @media print — the label and room code would vanish from the sheet');
});
check('the open-joining row and the group-count row both carry noprint', () => {
  assert.ok(/id="groupsRow"[^>]*class="[^"]*noprint|class="[^"]*noprint[^"]*"[^>]*id="groupsRow"/.test(H),
    '#groupsRow (Set / Ready-for-the-hall / #nGroups) is not marked noprint');
  assert.ok(/id="joinRow"[^>]*class="[^"]*noprint|class="[^"]*noprint[^"]*"[^>]*id="joinRow"/.test(H),
    '#joinRow (Allow open joining) is not marked noprint');
});

/* ============================================================
   BEHAVIOURAL CHECKS
   ============================================================ */
function extractFn(name) {
  const re = new RegExp('^(async )?function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find function ' + name + '() in public/host.html');
  return m[0];
}
function extractLet(name) {
  const re = new RegExp('^let ' + name + ' = .*;$', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find "let ' + name + '" in public/host.html');
  return m[0];
}
/* ROLES is a top-level `const [...]` array declaration, not an object
   literal (extractConst()-style helpers everywhere else in this repo match
   `= ({…});`) and not a function — it needs its own matcher. renderRoster()
   (final-branch review fix 3) reads it directly for the ministry icons, same
   as the shipped page does; the harness below has to hand it the same
   const, not a copy retyped in this file, or a change to an icon in
   host.html could pass here while the shipped page shows something else. */
function extractConst(name) {
  const re = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\n\\]);', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find "const ' + name + '" in public/host.html');
  return m[0];
}

/* A minimal stand-in for document.getElementById: enough state (innerHTML,
   textContent, value, disabled, a classList that actually tracks a
   "hidden" toggle) for renderRoster and friends to read and write without
   throwing, and for assertions here to read back what they set. */
function makeDom(){
  const els = new Map();
  return id => {
    if (!els.has(id)) els.set(id, {
      id, innerHTML: '', textContent: '', value: '', disabled: false,
      _hidden: false,
      classList: {
        toggle(cls, force) { if (cls === 'hidden') this._hidden = force === undefined ? !this._hidden : !!force; },
        add(cls) { if (cls === 'hidden') this._hidden = true; },
        remove(cls) { if (cls === 'hidden') this._hidden = false; },
        contains(cls) { return cls === 'hidden' ? this._hidden : false; }
      }
    });
    return els.get(id);
  };
}

/* -------- Critical 2 (review), the other half: refreshRoster() writing the
   LABEL into #printLabel was pinned in round 2, but go() writing the actual
   ROOM CODE into #printRoom was not, though the report claimed both were.
   setInterval is shadowed as a dependency (not left to the real global) so
   go() calling `R.poll = setInterval(tick, 2200)` cannot leave a live timer
   running after this test file exits. -------- */
(() => {
  const $ = makeDom();
  const R = { room: 'PSKT', key: 'HOSTKEY1' };
  const location = { origin: 'http://localhost:3000' };
  const renderScens = () => {};
  const tick = () => {};
  const setInterval = () => 0;
  /* go() renders the join QR, so it reaches for window.QR. An empty window is
     the interesting case as well as the simplest: a console served where qr.js
     failed to load must still open the room rather than throw on the way in. */
  const window = {};
  /* go() is where new, resumed and restored rooms all converge, so it is where
     the room is remembered for the next reload — see rememberHost() in
     host.html and tests/rejoin.test.js for the storage itself. */
  const remembered = [];
  const rememberHost = (room, key) => remembered.push({ room, key });
  /* The host key is painted by paintHostKey(), masked, into its own element —
     never straight into the pills. tests/host-key-mask.test.js owns the
     masking itself; this only pins that go() goes through it. */
  let keyPainted = 0;
  const paintHostKey = () => keyPainted++;
  const build = new Function('$', 'R', 'location', 'renderScens', 'tick', 'setInterval', 'window', 'rememberHost', 'paintHostKey', `
    ${extractFn('go')}
    return go;
  `);
  const goFn = build($, R, location, renderScens, tick, setInterval, window, rememberHost, paintHostKey);
  goFn();
  check('opening a room does not put the host key straight on the wall', () => {
    assert.strictEqual(keyPainted, 1, 'go() did not go through paintHostKey()');
    assert.ok(!/HOSTKEY1/.test($('hostPills').innerHTML),
      'the host key was painted unmasked onto a projected console');
  });
  check('opening a room remembers it for the next reload', () => {
    assert.deepStrictEqual(remembered, [{ room: 'PSKT', key: 'HOSTKEY1' }],
      'go() did not remember the room — a refresh mid-event would send the game master back to the start screen');
  });
  check('the way out of the room is offered once there is a room to leave', () => {
    assert.strictEqual($('leaveBtn').classList.contains('hidden'), false,
      'the Leave button stayed hidden, so a borrowed laptop keeps the host key with no way to clear it');
  });
  check('go() writes the real room code into the print-only heading', () => {
    assert.strictEqual($('printRoom').textContent, 'Room code: PSKT',
      'go() never wrote the room code into #printRoom — a printed sheet would show "—" instead of the actual room code');
  });
  check('a console with no QR library still opens the room', () => {
    assert.strictEqual($('joinUrl').textContent, 'localhost:3000/play',
      'go() gave up before writing the join address — a missing qr.js took the whole card down');
  });
})();

/* Wires every roster-related function together in one Function() so the
   closures over lastRoster / roomSig / labelFor() work exactly as they do in
   the shipped page — the same idiom tests/client-identity.test.js uses for
   renderBuildTrade/renderTrade/renderBoard, which share state the same way.
   lastRoster and roomSig are extracted from the source too (extractLet), not
   reinvented here, so a change to either declaration in host.html is picked
   up rather than silently diverging from what ships. */
function harness(kind){
  const $ = makeDom();
  const calls = { api: [], alert: [], confirm: [] };
  let confirmResult = true;
  /* A roster comes back on the default reply because that is what the real
     host/country route returns, and modCountry() renders it. Without it the
     unawaited calls below leave a rejected promise floating, which surfaces
     later as an error pointing at whatever ran last. */
  let apiImpl = () => ({ ok: true, roster: [] });
  const R = { room: 'ABCD', key: 'HOSTKEY1', kind };
  const LAND = {}; E.HOMELANDS.forEach(h => LAND[h.key] = h.name);
  const esc = E.esc;
  const location = { origin: 'http://localhost:3000' };
  const api = (...args) => { calls.api.push(args); return Promise.resolve(apiImpl(...args)); };
  const alert = (m) => { calls.alert.push(m); };
  const confirm = (m) => { calls.confirm.push(m); return confirmResult; };
  const tick = () => { calls.tick = (calls.tick || 0) + 1; };

  const src = [
    extractLet('lastRoster'),
    extractFn('labelFor'),
    'function filterRoster(){ renderRoster(lastRoster, R.kind); }', // trivial one-liner, not worth a separate extractor
    extractLet('roomSig'),
    extractConst('ROLES'),
    extractFn('renderRoster'),
    extractFn('refreshRoster'),
    extractFn('toggleOpenJoin'),
    extractFn('modCountry'),
    extractFn('askRenameCountry'),
    extractFn('removeCountry'),
    extractFn('reopenCountry'),
    extractFn('pullIn'),
    extractFn('finishSession'),
    extractFn('setGroups')
  ].join('\n\n');

  const build = new Function('$', 'esc', 'LAND', 'R', 'api', 'confirm', 'alert', 'tick', 'location', `
    ${src}
    return {
      renderRoster, refreshRoster, toggleOpenJoin, modCountry, askRenameCountry,
      removeCountry, reopenCountry, pullIn, finishSession, setGroups, labelFor, filterRoster
    };
  `);
  const fns = build($, esc, LAND, R, api, confirm, alert, tick, location);
  return {
    ...fns, $, calls, R,
    setConfirm: v => { confirmResult = v; },
    setApiImpl: f => { apiImpl = f; }
  };
}

const rosterRow = (over) => Object.assign({
  slot: 1, code: 'AAAAA', viewCode: 'BBBBB', pid: 'P1', homeland: 'delta',
  name: '', ready: false, locked: false, renameAsked: false,
  /* rosterOf() (server.js) hands the console minCodes on every row — see
     final-branch review fix 3. Defaulted here so every existing check above,
     none of which mentions ministry codes, keeps exercising the same shape
     rosterOf() actually sends. */
  minCodes: { edu: 'EEEEE', def: 'DDDDD', trade: 'TTTTT', infra: 'IIIII' }
}, over);

/* -------- renderRoster: classroom keeps slot numbers, and the commit gate -------- */
(() => {
  const h = harness('class');
  const roster = [
    rosterRow({ slot: 1, code: 'AAAAA', viewCode: 'BBBBB' }),                                   // not started
    rosterRow({ slot: 2, code: 'CCCCC', viewCode: 'DDDDD', name: 'Solaria', ready: true, locked: true })
  ];
  h.renderRoster(roster, 'class');
  check('a classroom roster labels an unstarted group by its slot number', () => {
    assert.ok(/class="rank">1</.test(h.$('roster').innerHTML), 'the unnamed group in slot 1 was not labelled "1"');
    assert.ok(h.$('roster').innerHTML.includes('not started'), 'an unnamed group was not marked as not started');
  });
  check('the commit gate is honest: Finish session stays disabled until every group has committed', () => {
    assert.strictEqual(h.$('commitCount').textContent, '1 / 2 committed', 'the committed count is wrong');
    assert.strictEqual(h.$('finishBtn').disabled, true, 'Finish session was enabled while a group had not committed');
  });
  /* Important 1 (review): viewCode's existence-only grep matched twice
     WITHOUT the roster ever rendering it — one hit was blankCountry()'s own
     field declaration inside the byte-locked inlined engine, which can never
     go missing. Only a rendered check proves the class code chip is real. */
  check('both the leader code and the class code actually appear on the roster, as their own visible chips', () => {
    const html = h.$('roster').innerHTML;
    /* Substring-anywhere is not enough: both codes are also embedded in every
       row's onclick="…('AAAAA')" attributes (rename/askRename/reopen/remove
       all take the code as an argument), so html.includes('AAAAA') would
       stay true even if the visible <code class="rc"> chip were deleted
       entirely — proven by mutation below. Anchoring on the chip markup
       itself is what actually pins that a teacher can read the code, not
       just that the string exists somewhere in the page. */
    assert.ok(/<code class="rc">AAAAA<\/code>/.test(html), 'the leader code is not shown as its own visible chip');
    assert.ok(/<code class="cc">BBBBB<\/code>/.test(html), 'the class code is not shown as its own visible chip');
  });
})();

/* -------- final-branch review, fix 3 (BLOCKER): the console must be able to
   show AND search a ministry code. rosterOf() (server.js) already hands the
   console minCodes on every row — the printed slips already carry them — but
   until this fix the roster row rendered only "leader … · class … ·
   homeland", and the search filter matched t.code/t.viewCode only. A lost
   Defence slip on hall day had no front-of-room recovery at all. -------- */
(() => {
  const h = harness('class');
  const roster = [rosterRow({
    slot: 1, code: 'AAAAA', viewCode: 'BBBBB', name: 'Solaria',
    minCodes: { edu: 'PQRST', def: 'KJTQG', trade: 'UVWXY', infra: 'MNBVC' }
  })];
  h.renderRoster(roster, 'class');
  const html = h.$('roster').innerHTML;
  check('all four ministry codes appear on the roster row, as their own visible chips', () => {
    for (const code of ['PQRST', 'KJTQG', 'UVWXY', 'MNBVC'])
      assert.ok(new RegExp('<code class="mc">' + code + '</code>').test(html),
        `ministry code ${code} is not shown as its own visible chip — a lost slip for this ministry has no front-of-room recovery`);
  });
  check('each ministry code is paired with that ministry\'s own name/emoji, the same ones the rest of the app uses', () => {
    /* ROLES (mirrored from game_engine.js) is the app's one source for which
       icon belongs to which ministry — ⚖️ Trade, 🛡️ Defence, and so on.
       Pinning the actual icon next to the actual code (not just "all four
       codes appear somewhere") catches a mismatched pairing, which would
       send a teacher hunting for "the Defence code" next to the Education
       icon. */
    assert.ok(/🛡️\s*<code class="mc">KJTQG<\/code>/.test(html), 'the Defence code is not paired with the Defence icon');
    assert.ok(/⚖️\s*<code class="mc">UVWXY<\/code>/.test(html), 'the Trade code is not paired with the Trade icon');
  });
})();
(() => {
  /* The search box (used in a hall, where the filter row is shown) has to
     find a group by whichever code a student reads out — including a
     ministry one. */
  const h = harness('hall');
  const roster = [
    rosterRow({ code: 'AAAAA', viewCode: 'BBBBB', name: 'Solaria',
      minCodes: { edu: 'EEEEE', def: 'KJTQG', trade: 'TTTTT', infra: 'IIIII' } }),
    rosterRow({ code: 'CCCCC', viewCode: 'DDDDD', name: 'Boreal',
      minCodes: { edu: 'EEEE2', def: 'DDDD2', trade: 'TTTT2', infra: 'IIII2' } })
  ];
  h.renderRoster(roster, 'hall');
  h.$('rosterFilter').value = 'kjtqg';
  h.filterRoster();
  const filtered = h.$('roster').innerHTML;
  check('typing a Defence minCode into the search box finds that group and only that group', () => {
    assert.ok(filtered.includes('Solaria'), 'a search for a live ministry code found nothing — a student reading their ministry code to the teacher gets no hit');
    assert.ok(!filtered.includes('Boreal'), 'the ministry-code search matched a group that did not hold that code');
  });
  check('the search is case-insensitive on a ministry code, same as it is on the leader/class codes', () => {
    assert.strictEqual(h.$('commitCount').textContent, '1 arrived (filtered)', 'a lowercase ministry code typed into the search box did not narrow the roster to one group');
  });
  h.$('rosterFilter').value = '';
  h.filterRoster();
})();
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ name: 'Aurelia', ready: true, locked: true })], 'class');
  check('the commit gate opens once every provisioned group has committed', () => {
    assert.strictEqual(h.$('finishBtn').disabled, false, 'Finish session stayed disabled once every group had committed');
  });
})();
(() => {
  const h = harness('class');
  h.renderRoster([], 'class');
  check('the commit gate never opens on an empty roster — there is nothing to finish', () => {
    assert.strictEqual(h.$('finishBtn').disabled, true, 'Finish session was enabled with zero groups provisioned');
  });
})();

/* -------- Important 1 (review): a student-typed name on the roster is a
   new projector sink, with nothing in tests/escaping.test.js watching it
   (that file only reads public/index.html). renderRoster()'s name markup is
   one ternary expression with esc(t.name) called TWICE — once for the
   classroom branch, once for the hall's trailing branch
   (`isClass ? (t.name ? esc(t.name) : …) : esc(t.name)`) — so a classroom-
   only check leaves the hall's own esc() call, which is the one that
   actually renders on the projector aggregating every classroom's names,
   completely unpinned. Round 1 tested only 'class'; this round adds 'hall'
   explicitly, plus the two code chips and the homeland field, all of which
   are separately escaped and separately droppable. homeland is kept as a
   sink here as defence in depth even though POST /api/team/save no longer
   accepts it directly (it is dealt by dealHomeland() when the teacher
   provisions groups) — a hand-edited POST /api/host/import snapshot still
   lands its fields without that route's own validation, so an unrecognised
   value can still reach t.homeland, which falls through
   LAND[t.homeland]||t.homeland to the raw value. */
const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';
const XSS_ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;';
function assertNoRawXSS(html, what) {
  assert.ok(!html.includes('<script>'), `a raw <script> tag from ${what} reached the roster markup`);
  assert.ok(!html.includes('<img src=x onerror=alert(2)>'), `a raw onerror handler from ${what} reached the roster markup`);
  assert.ok(html.includes(XSS_ESCAPED), `${what} was not escaped at all — esc() was not applied`);
}
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ name: XSS, ready: true, locked: true })], 'class');
  check('a student-typed name is escaped on a CLASSROOM roster', () => {
    assertNoRawXSS(h.$('roster').innerHTML, 'a classroom country name');
  });
})();
(() => {
  const h = harness('hall');
  h.renderRoster([rosterRow({ name: XSS, ready: true, locked: true })], 'hall');
  check('a student-typed name is escaped on a HALL roster — the branch that actually renders on the projector', () => {
    assertNoRawXSS(h.$('roster').innerHTML, 'a hall country name');
  });
})();
/* Codes are always server-minted 5-letter alnum in the real product (no
   quotes, so they cannot break an onclick="…('CODE')" attribute the way a
   name or homeland could) — these payloads are chosen to isolate the
   CHIP's own esc() from that separate, pre-existing, out-of-scope
   attribute-interpolation question. No quote characters, so the row's
   onclick attributes stay well-formed either way; only the visible chip
   content is under test here. */
/* t.code is ALSO interpolated raw (unescaped, by design — never quote-
   bearing in real use) into every row's onclick="…('CODE')" attributes, so
   a whole-HTML `!includes(payload)` check is the exact false-positive trap
   review keeps finding: the raw payload legitimately appears there even
   when the chip itself escapes correctly. Anchor on the chip's own markup
   instead, exactly as the "appear as their own visible chips" check above
   does. */
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ code: '<b>HACKED</b>', ready: false })], 'class');
  check('a leader code is escaped in its chip', () => {
    const chip = /<code class="rc">([\s\S]*?)<\/code>/.exec(h.$('roster').innerHTML);
    assert.ok(chip, 'no leader-code chip was rendered at all');
    assert.strictEqual(chip[1], '&lt;b&gt;HACKED&lt;/b&gt;', 'the leader-code chip rendered unescaped markup');
  });
})();
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ viewCode: '<b>HACKED</b>', ready: false })], 'class');
  check('a class code is escaped in its chip', () => {
    const chip = /<code class="cc">([\s\S]*?)<\/code>/.exec(h.$('roster').innerHTML);
    assert.ok(chip, 'no class-code chip was rendered at all');
    assert.strictEqual(chip[1], '&lt;b&gt;HACKED&lt;/b&gt;', 'the class-code chip rendered unescaped markup');
  });
})();
(() => {
  const h = harness('class');
  // an unrecognised homeland key falls through LAND[..]||t.homeland to the
  // raw value. POST /api/team/save no longer accepts 'homeland' directly —
  // it is dealt by dealHomeland() — but a hand-edited POST /api/host/import
  // snapshot still lands its fields without that route's validation, so this
  // stays worth checking as defence in depth. Unlike code/viewCode,
  // t.homeland is not duplicated into any onclick attribute in this row, so
  // a whole-HTML check is not the same trap.
  h.renderRoster([rosterRow({ homeland: '<script>alert(5)</script>' })], 'class');
  check('a student-set homeland value is escaped, not just a known homeland name', () => {
    const html = h.$('roster').innerHTML;
    assert.ok(!html.includes('<script>alert(5)</script>'), 'an unescaped homeland value broke out of the roster row');
    assert.ok(html.includes('&lt;script&gt;alert(5)&lt;/script&gt;'), 'the homeland value was not escaped at all — esc() was not applied');
  });
})();

/* -------- renderRoster: a hall never prints a bare, duplicate-prone slot
   number, and (Important 3, review) is ordered and filterable by name -------- */
(() => {
  const h = harness('hall');
  const roster = [
    rosterRow({ slot: 1, code: 'AAAAA', viewCode: 'BBBBB', name: 'Zenith', ready: true, locked: true }),
    // a different classroom's group 1 — the exact collision three classes of
    // seventeen would produce if the hall renumbered nothing
    rosterRow({ slot: 1, code: 'EEEEE', viewCode: 'FFFFF', name: 'Aurelia', ready: true, locked: true }),
    // never provisioned in THIS room, or provisioned but never arrived — a
    // hall roster must not show an empty placeholder for it
    rosterRow({ slot: 3, code: 'GGGGG', viewCode: 'HHHHH', name: '' }),
    rosterRow({ slot: 4, code: 'JJJJJ', viewCode: 'KKKKK', name: 'Marisol', ready: true, locked: true })
  ];
  h.renderRoster(roster, 'hall');
  const html = h.$('roster').innerHTML;
  check('a hall roster never renders a bare slot number', () => {
    assert.ok(!/class="rank">\d/.test(html),
      'a numeric slot leaked into the hall roster — exactly what two classrooms\' "Group 1" would collide on');
  });
  check('two same-numbered groups from different classrooms are still told apart, by name', () => {
    assert.ok(html.includes('Zenith') && html.includes('Aurelia'),
      'both same-slot countries should be identified by name in the hall');
  });
  check('a hall roster only lists countries that have actually arrived', () => {
    assert.strictEqual(h.$('commitCount').textContent, '3 arrived', 'an empty, unarrived slot was counted or shown');
    assert.ok(!html.includes('not started'), 'an empty slot rendered a "not started" row in a hall');
  });
  check('Finish session is not a hall control', () => {
    assert.strictEqual(h.$('finishBtn').disabled, true, 'Finish session was enabled in a hall room, which has nothing to finish');
  });
  check('a hall of many groups is sorted by name, not by the slot numbers rosterOf() still returns', () => {
    // fixture order was Zenith, Aurelia, (empty), Marisol — alphabetical is
    // Aurelia, Marisol, Zenith; a slot-order roster would put Zenith first
    const iA = html.indexOf('Aurelia'), iM = html.indexOf('Marisol'), iZ = html.indexOf('Zenith');
    assert.ok(iA !== -1 && iA < iM && iM < iZ,
      'the hall roster is not sorted alphabetically by name — a teacher scanning fifty groups needs a stable, findable order');
  });
  check('the filter box narrows a hall roster to a matching name', () => {
    h.$('rosterFilter').value = 'aure';
    h.filterRoster();
    const filtered = h.$('roster').innerHTML;
    assert.ok(filtered.includes('Aurelia'), 'the matching country was filtered out');
    assert.ok(!filtered.includes('Zenith') && !filtered.includes('Marisol'),
      'the filter box did not actually narrow the hall roster');
    h.$('rosterFilter').value = '';
    h.filterRoster();
  });
  check('the filter box is shown in a hall, and "How many groups?" is not', () => {
    assert.strictEqual(h.$('filterRow').classList.contains('hidden'), false, 'the filter box never appeared in the hall');
    assert.strictEqual(h.$('groupsRow').classList.contains('hidden'), true, '"How many groups?" was shown in a hall, which cannot provision groups');
  });
  /* Final-review finding 2: name moderation belongs to the classroom, before
     anything is projected. Pressing ↩️ blanks team.name, and board()'s name
     filter then drops the country from the projected leaderboard mid-game —
     hiding the button is not the security boundary (the server refuses the
     action outright now too), but a button that is still there and merely
     errors on tap is still the wrong console for a teacher glancing at a
     roster of 300. */
  check('the ask-to-rename (↩️) control does not render on a hall roster at all', () => {
    assert.ok(!/askRenameCountry/.test(html),
      'the ask-to-rename button rendered on a hall roster — pressing it can vanish a country from the projected leaderboard mid-game');
  });
})();
/* The mirror case: review found the check above never actually tested a
   classroom at all (it asserted on the hall harness twice, under a name
   that promised both). Forcing the filter box visible in a classroom used
   to pass every assertion in the file. */
(() => {
  const c = harness('class');
  c.renderRoster([rosterRow({ slot: 1, name: 'Aurelia' })], 'class');
  check('the filter box is NOT shown in a classroom, and "How many groups?" is', () => {
    assert.strictEqual(c.$('filterRow').classList.contains('hidden'), true, 'the filter box appeared in a classroom, which has no need to hunt for one of a handful of named groups');
    assert.strictEqual(c.$('groupsRow').classList.contains('hidden'), false, '"How many groups?" was hidden in a classroom, which is the only place it can be used');
  });
  check('the ask-to-rename (↩️) control does render on a classroom roster — this is the one place it belongs', () => {
    assert.ok(/askRenameCountry/.test(c.$('roster').innerHTML),
      'the ask-to-rename button disappeared from a classroom roster, which is the only place name moderation belongs');
  });
})();

/* -------- Critical 1 (review): the classroom-only rollback lever must not
   render in a hall — a hall console is projected in front of the whole
   cohort with its room code on screen, and one press used to re-open the
   exact country-minting hole Tasks 4/12 closed -------- */
(() => {
  const hallH = harness('hall');
  hallH.renderRoster([rosterRow({ name: 'Aurelia', locked: true })], 'hall');
  check('"Allow open joining" is hidden on a hall console', () => {
    assert.strictEqual(hallH.$('joinRow').classList.contains('hidden'), true,
      'the open-joining control rendered in a hall console — this is exactly the leak review flagged');
  });
  const classH = harness('class');
  classH.renderRoster([rosterRow({ name: 'Aurelia' })], 'class');
  check('"Allow open joining" is shown on a classroom console', () => {
    assert.strictEqual(classH.$('joinRow').classList.contains('hidden'), false,
      'the rollback lever disappeared from the one place it belongs');
  });
})();

/* -------- Important 2 (review): askRename also clears the name and unlocks
   the country (server.js: name='', locked=false) — that must be confirmed
   too, and named BEFORE the name is cleared, not after -------- */
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ slot: 1, code: 'LLLLL', viewCode: 'MMMMM', name: 'Solaria', ready: true, locked: true })], 'class');
  h.setConfirm(false);
  h.askRenameCountry('LLLLL');
  check('declining the confirmation leaves a committed country\'s name alone', () => {
    assert.strictEqual(h.calls.api.length, 0, 'askRename reached the server even though the confirmation was declined');
    assert.strictEqual(h.calls.confirm.length, 1, 'askRename was never confirmed at all');
    assert.ok(/Solaria/.test(h.calls.confirm[0]),
      'the confirmation named "Group 1" or nothing instead of the country\'s actual name — it must be captured before the name is cleared');
    /* The naming half only proves WHO; this proves the teacher is also told
       WHAT — that confirming clears the name and reopens the country, not
       merely "asks" in some reversible, no-consequence sense. */
    assert.ok(/clears its name/i.test(h.calls.confirm[0]) && /reopens it/i.test(h.calls.confirm[0]),
      'the confirmation does not warn that askRename clears the name and reopens the country — a teacher would tap it thinking it only sends a message');
  });
  h.setConfirm(true);
  h.askRenameCountry('LLLLL');
  check('confirming askRename reaches the server with the askRename action', () => {
    assert.strictEqual(h.calls.api.length, 1, 'askRename never reached the server after the teacher confirmed it');
    assert.strictEqual(h.calls.api[0][2].act, 'askRename', 'the wrong action was posted to host/country');
  });
})();

/* -------- the bin has to be REACHABLE on a group that has built something.
   It used to be drawn only on nameless rows, so clearing a real group meant
   ↩️ (which empties the name) and then the bin — and the server's refusal
   pointed at 🔓 instead, which unlocks but keeps the name, so the route it
   named never worked. -------- */
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ slot: 1, code: 'BBBBB', viewCode: 'CCCCC', name: 'Solaria', locked: true })], 'class');
  check('a committed classroom group can be removed without emptying it first', () => {
    assert.ok(/removeCountry\('BBBBB'\)/.test(h.$('roster').innerHTML),
      'no bin on a built classroom group — the only way to clear one is still ↩️ then the bin');
  });
})();
(() => {
  const h = harness('hall');
  h.renderRoster([rosterRow({ slot: 1, code: 'HHHHH', viewCode: 'IIIII', name: 'Solaria', locked: true })], 'hall');
  check('a hall roster offers no bin on a country that is playing', () => {
    assert.ok(!/removeCountry\('HHHHH'\)/.test(h.$('roster').innerHTML),
      'a hall console offers to delete a country off the projected leaderboard');
  });
})();
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ slot: 2, code: 'DDDDD', viewCode: 'EEEEE', name: 'Solaria', locked: true })], 'class');
  h.setConfirm(false);
  h.removeCountry('DDDDD');
  check('removing a built country warns that the country goes too', () => {
    assert.strictEqual(h.calls.api.length, 0, 'a built country was deleted despite the teacher cancelling');
    assert.ok(/Solaria/.test(h.calls.confirm[0]), 'the question does not name the country being deleted');
    assert.ok(/cannot be undone/i.test(h.calls.confirm[0]) && /codes/i.test(h.calls.confirm[0]),
      'the question does not say the country and its codes are gone for good');
  });
})();

/* -------- removeCountry: a destructive control, guarded by confirm() -------- */
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ slot: 5, code: 'ZZZZZ', viewCode: 'YYYYY' })], 'class');
  h.setConfirm(false);
  h.removeCountry('ZZZZZ');
  check('declining the confirmation leaves the group in place', () => {
    assert.strictEqual(h.calls.api.length, 0, 'remove reached the server even though the confirmation was declined');
    assert.strictEqual(h.calls.confirm.length, 1, 'remove was never confirmed at all');
    assert.ok(/Group 5/.test(h.calls.confirm[0]), 'the confirmation did not name which group was about to be removed');
  });
  h.setConfirm(true);
  h.removeCountry('ZZZZZ');
  check('confirming the removal reaches the server with the remove action', () => {
    assert.strictEqual(h.calls.api.length, 1, 'remove never reached the server after the teacher confirmed it');
    assert.strictEqual(h.calls.api[0][2].act, 'remove', 'the wrong action was posted to host/country');
    assert.strictEqual(h.calls.api[0][2].code, 'ZZZZZ', 'the wrong group was targeted');
  });
})();

/* -------- reopenCountry: also destructive (unlocks a committed country),
   and (review) must not claim a hall country is "about to join the hall" -------- */
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ code: 'QQQQQ', viewCode: 'RRRRR', name: 'Marisol', locked: true })], 'class');
  h.setConfirm(false);
  h.reopenCountry('QQQQQ');
  check('declining the confirmation leaves a committed country locked', () => {
    assert.strictEqual(h.calls.api.length, 0, 'reopen reached the server even though the confirmation was declined');
    assert.ok(/Marisol/.test(h.calls.confirm[0]), 'the confirmation did not name which country was about to be reopened');
    assert.ok(/join the hall/i.test(h.calls.confirm[0]), 'a classroom reopen should still mention joining the hall');
  });
  h.setConfirm(true);
  h.reopenCountry('QQQQQ');
  check('confirming the reopen reaches the server with the reopen action', () => {
    assert.strictEqual(h.calls.api.length, 1, 'reopen never reached the server after the teacher confirmed it');
    assert.strictEqual(h.calls.api[0][2].act, 'reopen', 'the wrong action was posted to host/country');
  });
})();
(() => {
  const h = harness('hall');
  h.renderRoster([rosterRow({ code: 'QQQQQ', viewCode: 'RRRRR', name: 'Marisol', locked: true })], 'hall');
  h.reopenCountry('QQQQQ');
  check('reopening a country already in the hall does not claim it is "about to join the hall"', () => {
    assert.ok(!/join the hall/i.test(h.calls.confirm[0]),
      'the reopen confirmation told a hall teacher the country was about to join the hall, when it is already there');
  });
})();

/* -------- pullIn: a leader code is exactly 5 letters, and gets upper-cased -------- */
(() => {
  const h = harness('hall');
  h.$('pullCode').value = 'abcd';
  h.pullIn();
  check('a leader code that is not 5 letters is refused before it reaches the server', () => {
    assert.strictEqual(h.calls.api.length, 0, 'a malformed code was sent to host/country anyway');
    assert.ok(h.calls.alert.some(m => /5 letters/i.test(m)), 'nothing told the teacher a leader code is 5 letters');
  });
})();
(() => {
  const h = harness('hall');
  h.$('pullCode').value = 'zzzzz';
  h.pullIn();
  check('a 5-letter code is sent, upper-cased, to bring a stranded country in', () => {
    assert.strictEqual(h.calls.api.length, 1, 'a valid leader code was never sent to host/country');
    assert.strictEqual(h.calls.api[0][2].act, 'pull', 'the wrong action was sent for a rescue pull');
    assert.strictEqual(h.calls.api[0][2].code, 'ZZZZZ', 'the leader code was not upper-cased before it was sent');
  });
})();

/* -------- Important 4 (review): a deliberately smaller group count is more
   destructive than remove or reopen (it can delete many code pairs at once)
   and had no confirmation at all -------- */
(() => {
  const h = harness('class');
  h.renderRoster(Array.from({ length: 17 }, (_, i) => rosterRow({ slot: i + 1, code: 'A' + String(i).padStart(4,'0'), viewCode: 'B' + String(i).padStart(4,'0') })), 'class');
  h.$('nGroups').value = '6';
  h.setConfirm(false);
  h.setGroups();
  check('shrinking the group count is confirmed, naming how many groups will be removed', () => {
    assert.strictEqual(h.calls.api.length, 0, 'setGroups reached the server even though shrinking was declined');
    assert.strictEqual(h.calls.confirm.length, 1, 'setGroups never asked for confirmation when shrinking 17 groups to 6');
    assert.ok(/11/.test(h.calls.confirm[0]), 'the confirmation does not say how many groups (11) would be removed');
  });
  h.setConfirm(true);
  h.setGroups();
  check('confirming a shrink reaches the server with the new count', () => {
    assert.strictEqual(h.calls.api.length, 1, 'setGroups never reached the server after the teacher confirmed the shrink');
    assert.strictEqual(h.calls.api[0][2].n, 6, 'the wrong group count was sent');
  });
})();
(() => {
  const h = harness('class');
  h.renderRoster([rosterRow({ slot: 1 }), rosterRow({ slot: 2, code:'CCCCC', viewCode:'DDDDD' })], 'class');
  h.$('nGroups').value = '6'; // growing, not shrinking
  h.setGroups();
  check('growing the group count needs no confirmation', () => {
    assert.strictEqual(h.calls.confirm.length, 0, 'setGroups asked for confirmation even though the group count only grew');
    assert.strictEqual(h.calls.api.length, 1, 'growing the group count never reached the server');
  });
})();

/* -------- Important 5 (review): the roster is rebuilt every ~2.2s poll in a
   hall; rebuilding it when nothing actually changed churns the buttons
   under a teacher's cursor mid-click -------- */
(() => {
  const h = harness('hall');
  const roster = [rosterRow({ code: 'NNNNN', viewCode: 'OOOOO', name: 'Aurelia', locked: true })];
  h.renderRoster(roster, 'hall');
  h.$('roster').innerHTML = 'SENTINEL-DO-NOT-REBUILD';
  // a fresh array, same content — exactly what a re-poll with nothing new hands back
  h.renderRoster(roster.map(t => Object.assign({}, t)), 'hall');
  check('renderRoster does not rebuild the roster markup when nothing has changed', () => {
    assert.strictEqual(h.$('roster').innerHTML, 'SENTINEL-DO-NOT-REBUILD',
      'the roster was rebuilt even though the visible list was identical — this is the under-cursor churn review flagged');
  });
  const grown = roster.concat([rosterRow({ code: 'PPPPP', viewCode: 'QQQQQ', name: 'Borealis', locked: true })]);
  h.renderRoster(grown, 'hall');
  check('renderRoster still rebuilds once the roster actually changes', () => {
    assert.notStrictEqual(h.$('roster').innerHTML, 'SENTINEL-DO-NOT-REBUILD',
      'a real change to the roster (a new arrival) was swallowed by the unchanged-signature skip');
    assert.ok(h.$('roster').innerHTML.includes('Borealis'), 'the newly arrived country never rendered');
  });
})();

/* -------- go() must reset the signature the skip above relies on. Without
   this, Resume-ing one room and then Restore-ing a DIFFERENT room in the
   same page load — both perfectly ordinary console actions — could leave
   the first room's stale roster on screen if the second room's roster
   happens to serialise identically (e.g. both freshly provisioned with the
   same count, all slots still "not started"). -------- */
(() => {
  const $ = makeDom();
  const R = { room: 'PSKT', key: 'HOSTKEY1', kind: 'class' };
  const LAND = {}; E.HOMELANDS.forEach(h => LAND[h.key] = h.name);
  const esc = E.esc;
  const location = { origin: 'http://localhost:3000' };
  const renderScens = () => {};
  const tick = () => {};
  const setInterval = () => 0;
  const src = [
    extractLet('lastRoster'),
    extractFn('labelFor'),
    extractLet('roomSig'),
    extractConst('ROLES'),
    extractFn('renderRoster'),
    extractFn('go')
  ].join('\n\n');
  const window = {};   // go() reaches for window.QR to draw the join code
  const rememberHost = () => {};   // storage is pinned in tests/rejoin.test.js
  const paintHostKey = () => {};   // masking is pinned in tests/host-key-mask.test.js
  const build = new Function('$', 'esc', 'LAND', 'R', 'location', 'renderScens', 'tick', 'setInterval', 'window', 'rememberHost', 'paintHostKey', `
    ${src}
    return { renderRoster, go };
  `);
  const fns = build($, esc, LAND, R, location, renderScens, tick, setInterval, window, rememberHost, paintHostKey);

  const roster = [rosterRow({ code: 'NNNNN', viewCode: 'OOOOO', name: '' })]; // "not started" — the shape a fresh room shares
  fns.renderRoster(roster, 'class');
  $('roster').innerHTML = 'SENTINEL-STALE-ROOM';
  fns.go(); // a fresh Resume/Restore into a DIFFERENT room, in the same page load
  fns.renderRoster(roster.map(t => Object.assign({}, t)), 'class'); // that different room's roster happens to serialise identically
  check('go() resets the roster signature, so a freshly loaded room is never skipped as "unchanged"', () => {
    assert.notStrictEqual($('roster').innerHTML, 'SENTINEL-STALE-ROOM',
      'go() left the previous room\'s stale roster signature in place — a same-shaped new room was silently skipped, leaving the old room\'s rows on screen');
  });
})();

/* -------- Task 11: renderStrikePicker's two guard conditions, and that it
   actually draws a checkbox per country and calls out who is still
   recovering. The server enforces both conditions again on its own (a
   classroom is refused outright; the phase must be 'game') — this only
   pins that the console does not show a game master a button that cannot
   work. STRIKE_KINDS is a single-line `const […];`, not the multi-line
   array shape extractConst() matches, so it gets its own tiny extractor
   rather than a stretched regex that could silently match something else. */
function extractConstLine(name) {
  const re = new RegExp('^const ' + name + ' = .*;$', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find "const ' + name + '" in public/host.html');
  return m[0];
}
function strikeHarness(overrides){
  const $ = makeDom();
  const esc = E.esc;
  const R = Object.assign({ room: 'ABCD', key: 'HOSTKEY1' }, (overrides && overrides.R) || {});
  const calls = { api: [], alert: [], confirm: [], tick: 0 };
  let apiImpl = () => ({});
  let confirmResult = true;
  const api = (...args) => { calls.api.push(args); return Promise.resolve(apiImpl(...args)); };
  const alert = (m) => { calls.alert.push(m); };
  /* throwStrike() confirms first, same as throwScen/resetDeck (see harness()
     above) — the fix that added it. */
  const confirm = (m) => { calls.confirm.push(m); return confirmResult; };
  const tick = () => { calls.tick++; };
  const src = [
    extractConstLine('STRIKE_KINDS'),
    extractLet('STRIKE_KIND'),
    extractConstLine('STRIKE_SELECTED'),
    extractFn('toggleStrikePid'),
    extractFn('renderStrikePicker'),
    extractFn('throwStrike')
  ].join('\n\n');
  const build = new Function('$', 'esc', 'R', 'api', 'alert', 'confirm', 'tick', `
    ${src}
    return { renderStrikePicker, toggleStrikePid, throwStrike, selected: STRIKE_SELECTED };
  `);
  return {
    ...build($, esc, R, api, alert, confirm, tick), $, R, calls,
    setApiImpl: f => { apiImpl = f; }, setConfirm: v => { confirmResult = v; }
  };
}
(() => {
  const h = strikeHarness();
  const { renderStrikePicker } = h;

  const board = [
    { pid: 'P1', name: 'Alpha', displaced: 0, strk: '' },
    { pid: 'P2', name: 'Beta', displaced: 40, strk: '🌊' }
  ];

  check('the strike card stays hidden in a classroom, even mid-game', () => {
    renderStrikePicker({ kind: 'class', phase: 'game', board });
    assert.strictEqual(h.$('strikeCard').classList.contains('hidden'), true,
      'a classroom saw the strike control, which the server refuses outright');
  });
  check('the strike card stays hidden in a hall outside the mass game', () => {
    renderStrikePicker({ kind: 'hall', phase: 'prep', board });
    assert.strictEqual(h.$('strikeCard').classList.contains('hidden'), true,
      'the strike control showed in prep, before the server would accept a throw');
  });
  check('the strike card shows in a hall during the mass game, with a checkbox per country', () => {
    renderStrikePicker({ kind: 'hall', phase: 'game', board });
    assert.strictEqual(h.$('strikeCard').classList.contains('hidden'), false,
      'the one case the server actually allows never shows the control');
    const who = h.$('strikeWho').innerHTML;
    assert.ok(who.includes('value="P1"') && who.includes('value="P2"'),
      'not every country in the hall got a checkbox');
    assert.ok(/Alpha/.test(who) && /Beta/.test(who), 'a country name went missing from the picker');
  });
  check('a country still displaced is called out before another strike lands', () => {
    renderStrikePicker({ kind: 'hall', phase: 'game', board });
    assert.ok(/Beta \(40\)/.test(h.$('strikeNow').textContent),
      'a country still recovering from the last strike is not flagged before the next one');
  });
  check('renderStrikePicker never draws a strike title or story of its own', () => {
    /* Belt-and-braces alongside tests/scenario-secrecy.test.js's page-wide
       sweep: this asserts it at the one function actually responsible,
       against the STRIKES source of truth, so a copy-paste of a title into
       this function specifically fails here even if some other page escaped
       the wider sweep. */
    const { STRIKES } = require('../hall-scenarios.js');
    renderStrikePicker({ kind: 'hall', phase: 'game', board });
    const drawn = h.$('strikeKinds').innerHTML + h.$('strikeWho').innerHTML + h.$('strikeNow').textContent;
    for (const s of STRIKES) {
      assert.ok(!drawn.includes(s.title), `the picker drew the strike title "${s.title}"`);
      assert.ok(!drawn.includes(s.line), `the picker drew the strike line "${s.line}"`);
    }
  });
})();

/* -------- Fix round 1 (Important): a poll landing between a game master
   ticking a box and pressing Launch used to silently empty the selection —
   renderStrikePicker rebuilds #strikeWho's checkboxes from the live board
   on every tick(), and a freshly-built <input> remembers nothing. The DOM
   stub's innerHTML is opaque text with no live `checked` property (that is
   exactly why the earlier block never caught this), so this pins the fix at
   the level that actually matters: whether the rebuilt markup carries the
   literal `checked` attribute for a pid still in the selection set, across
   a second, unrelated render — the same thing tick()'s 2.2s poll does. -------- */
(() => {
  const h = strikeHarness();
  const board = [
    { pid: 'P1', name: 'Alpha', displaced: 0, strk: '' },
    { pid: 'P2', name: 'Beta', displaced: 40, strk: '🌊' }
  ];
  const d = { kind: 'hall', phase: 'game', board };
  /* \s*checked\b, not [^>]*checked: the checkbox's own onchange attribute
     reads `this.checked`, which [^>]*checked would match unconditionally
     inside every row's tag regardless of whether the conditional `checked`
     attribute is actually present — a false positive that would have made
     this check pass no matter what renderStrikePicker did. Anchoring on
     "immediately after value=…, only whitespace before the word checked"
     matches only the real attribute, which the template places right after
     value="…" (see renderStrikePicker's `${STRIKE_SELECTED.has(r.pid)?'checked':''}`). */
  const checkedFor = (pid) => new RegExp(`value="${pid}"\\s*checked\\b`).test(h.$('strikeWho').innerHTML);

  h.toggleStrikePid('P2', true);
  h.renderStrikePicker(d);
  check('a ticked country is checked on the render right after it was ticked', () => {
    assert.ok(h.selected.has('P2'), 'toggleStrikePid did not record the tick');
    assert.ok(checkedFor('P2'), 'the freshly-built checkbox for a ticked country is not marked checked');
    assert.ok(!checkedFor('P1'), 'a country nobody ticked came back checked');
  });

  h.renderStrikePicker(d);   // a second render with nothing new ticked — what a 2.2s poll does
  check('the tick survives an unrelated second re-render — the regression this closes', () => {
    assert.ok(checkedFor('P2'),
      'a poll landing between ticking a box and pressing Launch silently cleared the selection');
    assert.ok(!checkedFor('P1'), 'a country nobody ticked came back checked after the second render');
  });

  h.toggleStrikePid('P2', false);
  h.renderStrikePicker(d);
  check('unticking a box actually clears it, not just visually', () => {
    assert.ok(!h.selected.has('P2'), 'toggleStrikePid(false) did not remove the pid from the selection');
    assert.ok(!checkedFor('P2'), 'an unticked country still rendered checked');
  });
})();

/* -------- Two async-dependent checks, run sequentially in one IIFE so
   ordering (and the final process.exit) does not depend on microtask
   interleaving between separate top-level IIFEs. -------- */
(async () => {
  /* Critical 2 (review), behavioural half: refreshRoster() must never put
     the host key anywhere printable, and must feed the print-only heading
     with the room's real label. */
  const rr = harness('class');
  rr.setApiImpl((method, p) => {
    if (p === '/api/host/roster') return { ok:true, kind:'class', label:'3E — Period 4', openJoin:true, practiceLeft:2, roster:[] };
    return { ok:true };
  });
  await rr.refreshRoster();
  check('refreshRoster feeds the room label to the print-only heading', () => {
    assert.strictEqual(rr.$('printLabel').textContent, '3E — Period 4', 'the print-only heading never received the room label');
  });
  check('refreshRoster keeps the open-joining button label in sync with the server', () => {
    assert.strictEqual(rr.$('openJoinBtn').textContent, 'Stop open joining',
      'the open-joining button did not reflect an already-open room — a teacher pressing it twice silently turns it back off unlabelled');
  });

  /* finishSession: a checklist, not an action. */
  const h = harness('class');
  await h.finishSession();
  check('Finish session records a feed line, then shows the handover instructions — nothing else', () => {
    assert.strictEqual(h.calls.api.length, 1, 'Finish session never told the server anything');
    assert.strictEqual(h.calls.api[0][1], '/api/host/act', 'Finish session posted to the wrong route');
    assert.strictEqual(h.calls.api[0][2].act, 'finish', 'the wrong action was posted for Finish session');
    assert.strictEqual(h.calls.alert.length, 1, 'Finish session did not show the handover instructions');
    assert.ok(/leader code/i.test(h.calls.alert[0]) && /hall room code/i.test(h.calls.alert[0]),
      'the handover instructions do not tell the class how to get into the hall');
  });

  /* -------- restoreBackup(): re-review follow-up. host/import's
     cold-recovery carve-out (final-review "NEW-2") needs an admin key for a
     room that is no longer live — but the console's own Restore-from-file
     button used to never send one at all, so a teacher whose room was
     genuinely lost hit a dead end even though the API-level safety net
     existed. Fixed to try with no key first (the common case — a still-open
     room needs nothing extra and must never see a prompt), and only on a
     refusal that specifically names the admin key, prompt once and retry
     with it. Extracted straight out of host.html, the same loadFn idiom as
     every other function in this file — every case below is proven by
     mutation, not by grepping the source for the word "prompt". */
  /* Restore now lives inside the start dialog, so restoreBackup() has two
     more collaborators than it used to: closeStart() to dismiss the dialog
     once a room is adopted, and dlgErr() to put a refusal on a line the
     teacher can read without losing what they typed. Both are stubbed and
     recorded here rather than being allowed to throw. */
  function restoreHarness(){
    const calls = { api: [], alert: [], prompt: [], go: 0, dlgErr: [], closeStart: 0 };
    let apiImpl = () => ({ ok:true, room:'RSTR', hostKey:'restoredkey1', count:1 });
    let promptResult = 'unused-default-key';
    const api = (...args) => { calls.api.push(args); return Promise.resolve(apiImpl(...args)); };
    const alert = (m) => { calls.alert.push(m); };
    const prompt = (m) => { calls.prompt.push(m); return promptResult; };
    const go = () => { calls.go++; };
    const dlgErr = (m) => { calls.dlgErr.push(m); };
    const closeStart = () => { calls.closeStart++; };
    const R = { room:'', key:'' };
    const src = extractFn('restoreBackup');
    const build = new Function('api', 'alert', 'prompt', 'go', 'R', 'dlgErr', 'closeStart', `
      ${src}
      return { restoreBackup };
    `);
    const fns = build(api, alert, prompt, go, R, dlgErr, closeStart);
    return {
      ...fns, calls, R,
      setApiImpl: f => { apiImpl = f; },
      setPromptResult: v => { promptResult = v; }
    };
  }
  const mockInput = (content) => ({ files:[{ text: async () => content }], value:'C:\\fakepath\\backup.json' });
  const NEEDS_KEY = { error:'Room RSTR is no longer open. Restoring a closed room needs the admin key — ask whoever runs the server.' };

  {
    const h = restoreHarness();
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('restoring a still-open room never prompts for anything', () => {
      assert.strictEqual(h.calls.prompt.length, 0, 'restoreBackup prompted even though the very first attempt succeeded');
      assert.strictEqual(h.calls.api.length, 1, 'restoreBackup made more than one attempt when the first one succeeded');
      assert.strictEqual(h.calls.api[0][2].key, undefined, 'a key was sent on an attempt that never needed one');
      assert.strictEqual(h.R.room, 'RSTR', 'the room was not adopted after a successful restore');
      assert.strictEqual(h.calls.go, 1, 'go() was not called after a successful restore');
    });
  }
  {
    const h = restoreHarness();
    let call = 0;
    h.setApiImpl((method, path, body) => {
      call++;
      if(call === 1){
        assert.strictEqual(body.key, undefined, 'the first attempt must not send a key at all');
        return NEEDS_KEY;
      }
      return { ok:true, room:'RSTR', hostKey:'restoredkey1', count:1 };
    });
    h.setPromptResult('the-real-admin-key');
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('a "needs the admin key" refusal prompts exactly once, in plain language', () => {
      assert.strictEqual(h.calls.prompt.length, 1, 'restoreBackup did not prompt exactly once for the admin key');
      assert.ok(!/carve-out|cold import|adminOk/i.test(h.calls.prompt[0]),
        'the prompt uses internal jargon instead of plain language a teacher can act on');
      assert.ok(/closed/i.test(h.calls.prompt[0]) && /admin key/i.test(h.calls.prompt[0]),
        'the prompt does not plainly say the room is closed and that the admin key is needed');
    });
    check('the retry carries the typed admin key, and the room is adopted once it succeeds', () => {
      assert.strictEqual(h.calls.api.length, 2, 'restoreBackup did not retry after the admin-key refusal');
      assert.strictEqual(h.calls.api[1][2].key, 'the-real-admin-key', 'the retry did not carry the admin key the teacher typed');
      assert.strictEqual(h.R.room, 'RSTR', 'the room was not adopted after the retry succeeded');
      assert.strictEqual(h.calls.go, 1, 'go() was not called once the retry succeeded');
    });
  }
  {
    const h = restoreHarness();
    h.setApiImpl(() => NEEDS_KEY);
    h.setPromptResult(null); // Cancel
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('cancelling the admin-key prompt makes no retry and adopts nothing', () => {
      assert.strictEqual(h.calls.api.length, 1, 'restoreBackup retried even though the teacher cancelled the prompt');
      assert.strictEqual(h.calls.alert.length, 0, 'cancelling the prompt still alerted something');
      assert.strictEqual(h.R.room, '', 'the console adopted a room even though the teacher cancelled the admin-key prompt');
      assert.strictEqual(h.calls.go, 0, 'go() ran even though the teacher cancelled the admin-key prompt');
    });
  }
  {
    const h = restoreHarness();
    h.setApiImpl(() => NEEDS_KEY);
    h.setPromptResult('the-wrong-key');
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('a refusal that survives the retry (a wrong admin key) surfaces a message and leaves the console un-adopted', () => {
      assert.strictEqual(h.calls.api.length, 2, 'restoreBackup did not even attempt the retry');
      assert.strictEqual(h.calls.dlgErr.length, 1, 'a refusal after the retry was never surfaced to the teacher');
      assert.ok(/admin key/i.test(h.calls.dlgErr[0]), 'the surfaced message does not mention the admin key');
      assert.strictEqual(h.calls.closeStart, 0, 'the dialog closed over a refusal, hiding the message it had just written there');
      assert.strictEqual(h.R.room, '', 'the console adopted a room despite the retry itself being refused — a half-adopted state');
      assert.strictEqual(h.calls.go, 0, 'go() ran despite the retry being refused');
    });
  }
  {
    const h = restoreHarness();
    h.setApiImpl(() => ({ error:'Group Gamma has already moved to the hall. Restoring would create a second copy, so nothing was changed.' }));
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('an ordinary refusal unrelated to the admin key never triggers a prompt', () => {
      assert.strictEqual(h.calls.prompt.length, 0, 'an unrelated refusal (a code clash) still triggered the admin-key prompt');
      assert.strictEqual(h.calls.api.length, 1, 'an unrelated refusal caused a pointless retry');
      assert.strictEqual(h.calls.dlgErr.length, 1, 'the clash refusal was never surfaced to the teacher');
      assert.ok(/Gamma/.test(h.calls.dlgErr[0]), 'the actual clash message was replaced or lost');
    });
  }
  {
    const h = restoreHarness();
    let call = 0;
    h.setApiImpl((method, path, body) => {
      call++;
      return call === 1 ? NEEDS_KEY : { ok:true, room:'RSTR', hostKey:'restoredkey1', count:1 };
    });
    h.setPromptResult('super-secret-admin-key');
    await h.restoreBackup(mockInput(JSON.stringify({ code:'RSTR' })));
    check('the admin key travels only as a POST body value — never a URL, never anywhere else', () => {
      for(const call of h.calls.api){
        assert.ok(!String(call[1]).includes('super-secret-admin-key'), 'the admin key leaked into the request path');
      }
      assert.strictEqual(h.calls.alert.filter(m => String(m).includes('super-secret-admin-key')).length, 0,
        'the admin key leaked into an alert shown on screen');
      assert.strictEqual(h.calls.dlgErr.filter(m => String(m).includes('super-secret-admin-key')).length, 0,
        'the admin key leaked into the dialog error line, which stays on screen until the dialog is closed');
    });
  }

  /* -------- resumeRoom(): Resume used to switch screens on nothing but a
     four-character code, so a mistyped host key landed the teacher on a
     console that refused every button without ever saying why — and a code
     that was too short made the button do nothing at all. It now asks
     /api/host/roster first (the cheapest route that actually checks the
     key) and shows the room's own refusal. Extracted from host.html, same
     idiom as everything else in this file. -------- */
  function resumeHarness(){
    const calls = { api: [], dlgErr: [], closeStart: 0, go: 0 };
    let apiImpl = () => ({ ok:true, kind:'class', label:'3E', roster:[] });
    const $ = makeDom();
    const api = (...args) => { calls.api.push(args); return Promise.resolve(apiImpl(...args)); };
    const dlgErr = (m) => { calls.dlgErr.push(m); };
    const closeStart = () => { calls.closeStart++; };
    const go = () => { calls.go++; };
    const R = { room:'', key:'', kind:undefined };
    const build = new Function('$', 'api', 'dlgErr', 'closeStart', 'go', 'R', `
      ${extractFn('resumeRoom')}
      return { resumeRoom };
    `);
    const fns = build($, api, dlgErr, closeStart, go, R);
    return { ...fns, $, calls, R, setApiImpl: f => { apiImpl = f; } };
  }
  const typeResume = (h, code, key) => { h.$('reRoom').value = code; h.$('reKey').value = key; };

  {
    const h = resumeHarness();
    typeResume(h, 'AB', 'hostkey1');
    await h.resumeRoom();
    check('a room code that is too short says so instead of the button doing nothing', () => {
      assert.strictEqual(h.calls.api.length, 0, 'a half-typed code was sent to the server');
      assert.strictEqual(h.calls.dlgErr.length, 1, 'a half-typed code left the teacher with no explanation at all');
      assert.strictEqual(h.calls.go, 0, 'the console switched screens on a half-typed code');
    });
  }
  {
    const h = resumeHarness();
    typeResume(h, 'abcd', '');
    await h.resumeRoom();
    check('a missing host key is named, and says where to find it', () => {
      assert.strictEqual(h.calls.api.length, 0, 'a keyless resume was sent to the server');
      assert.ok(/host key/i.test(h.calls.dlgErr[0]), 'the message never names the host key');
      assert.strictEqual(h.calls.go, 0, 'the console switched screens without a host key');
    });
  }
  {
    const h = resumeHarness();
    h.setApiImpl(() => ({ error:'Not the host.' }));
    typeResume(h, 'abcd', 'wrong-key');
    await h.resumeRoom();
    check('a wrong host key is refused in the dialog, not on a dead console', () => {
      assert.strictEqual(h.calls.dlgErr.pop(), 'Not the host.', "the server's own refusal was replaced or swallowed");
      assert.strictEqual(h.calls.go, 0, 'the console switched screens despite the key being refused');
      assert.strictEqual(h.calls.closeStart, 0, 'the dialog closed over a refusal, hiding the message it had just written there');
      assert.strictEqual(h.R.room, '', 'a room was adopted despite the key being refused');
    });
  }
  {
    const h = resumeHarness();
    h.setApiImpl(() => ({ ok:true, kind:'hall', label:'Hall', roster:[] }));
    typeResume(h, ' abcd ', ' hostkey1 ');
    await h.resumeRoom();
    check('a good code and key adopt the room, upper-cased and trimmed, and close the dialog', () => {
      assert.deepStrictEqual(h.calls.api[0][2], { room:'ABCD', hostKey:'hostkey1' },
        'the typed code and key did not reach /api/host/roster trimmed and upper-cased');
      assert.strictEqual(h.R.room, 'ABCD', 'the room was not adopted after a successful resume');
      assert.strictEqual(h.R.key, 'hostkey1', 'the host key was not adopted after a successful resume');
      assert.strictEqual(h.R.kind, 'hall', 'the room kind from the server was not adopted — a hall would render as a classroom until the first poll');
      assert.strictEqual(h.calls.closeStart, 1, 'the dialog stayed open over the live console');
      assert.strictEqual(h.calls.go, 1, 'go() never ran after a successful resume');
    });
  }

  /* -------- the hall deck on the console. Throwing a card interrupts every
     country in the room, so it asks first; once thrown the card leaves the
     list, and only the reset brings it back. The server is the authority on
     what is still in the deck (tests/scenario-secrecy.test.js) — what is
     pinned here is that the console asks before dealing, never deals when the
     game master says no, and shows the reset only when there is something to
     reset. -------- */
  function deckHarness(kind){
    const calls = { api: [], act: [], confirm: [] };
    let confirmResult = true;
    let apiImpl = () => ({ cards: [], used: 0 });
    const $ = makeDom();
    const R = { room:'HALL', key:'HOSTKEY1', kind };
    const esc = E.esc;
    const api = (...args) => { calls.api.push(args); return Promise.resolve(apiImpl(...args)); };
    const act = (...args) => { calls.act.push(args); return Promise.resolve(); };
    const confirm = (m) => { calls.confirm.push(m); return confirmResult; };
    const src = [extractLet('DECK'), extractFn('renderScens'),
                 extractFn('throwScen'), extractFn('resetDeck')].join('\n\n');
    const build = new Function('$', 'esc', 'R', 'api', 'act', 'confirm', `
      ${src}
      return { renderScens, throwScen, resetDeck, deck: () => DECK };
    `);
    const fns = build($, esc, R, api, act, confirm);
    return { ...fns, $, calls, R,
             setConfirm: v => { confirmResult = v; },
             setApiImpl: f => { apiImpl = f; } };
  }
  const CARDS = [{ key:'haze', icon:'🌫️', title:'The Haze Returns' },
                 { key:'water', icon:'💧', title:'The Water Runs Low' }];
  const settle = () => new Promise(r => setTimeout(r, 0));

  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: CARDS, used: 0 }));
    h.renderScens(); await settle();
    check('an untouched hall deck shows every card and no reset button', () => {
      assert.ok(h.$('scenList').innerHTML.includes('The Haze Returns'), 'the deck was not drawn');
      assert.strictEqual(h.$('deckResetBtn').classList.contains('hidden'), true,
        'the reset button is on a projected screen before anything has been thrown');
    });
  }
  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: [CARDS[1]], used: 1 }));
    h.renderScens(); await settle();
    check('once a card has been thrown the reset appears, and the card is gone', () => {
      assert.strictEqual(h.$('deckResetBtn').classList.contains('hidden'), false,
        'nothing offers a way back to the full deck');
      assert.ok(!h.$('scenList').innerHTML.includes('The Haze Returns'), 'a thrown card is still listed');
      assert.ok(h.$('scenList').innerHTML.includes('The Water Runs Low'), 'an unplayed card vanished too');
    });
  }
  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: [], used: 2 }));
    h.renderScens(); await settle();
    check('an emptied deck says so rather than showing nothing at all', () => {
      assert.ok(/thrown/i.test(h.$('scenList').innerHTML), 'an empty deck renders as a blank panel');
      assert.strictEqual(h.$('deckResetBtn').classList.contains('hidden'), false,
        'the only way out of an empty deck is hidden');
    });
  }
  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: CARDS, used: 0 }));
    h.renderScens(); await settle();
    h.setConfirm(false);
    await h.throwScen('haze');
    check('cancelling the confirmation deals nothing', () => {
      assert.strictEqual(h.calls.confirm.length, 1, 'a card was dealt without asking');
      assert.ok(/Haze/.test(h.calls.confirm[0]), 'the question does not name the card being thrown');
      assert.strictEqual(h.calls.act.length, 0, 'the card went out even though the game master said no');
    });
  }
  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: CARDS, used: 0 }));
    h.renderScens(); await settle();
    h.setConfirm(true);
    await h.throwScen('haze');
    check('confirming deals that card, then refreshes the list', () => {
      assert.deepStrictEqual(h.calls.act[0], ['scenario', null, 'haze'],
        'the confirmed card did not reach act() as a scenario throw');
      assert.ok(h.calls.api.length >= 2, 'the list was not re-fetched, so the thrown card stays on screen');
    });
  }
  {
    const h = deckHarness('hall');
    h.setApiImpl(() => ({ cards: [CARDS[1]], used: 1 }));
    h.renderScens(); await settle();
    h.setConfirm(false);
    await h.resetDeck();
    check('the deck reset asks before wiping the record of what has been played', () => {
      assert.strictEqual(h.calls.confirm.length, 1, 'one click on a projected screen reset the deck');
      assert.strictEqual(h.calls.act.length, 0, 'the deck was reset despite the game master cancelling');
    });
    h.setConfirm(true);
    await h.resetDeck();
    check('confirming the reset asks the server for the deck back', () => {
      assert.deepStrictEqual(h.calls.act[0], ['deckreset'], 'the reset never reached the server');
    });
  }
  {
    const h = deckHarness('class');
    h.renderScens();
    check('a classroom shows its drill and never the deck reset', () => {
      assert.ok(h.$('scenList').innerHTML.includes('drillBtn'), 'the classroom lost its drill button');
      assert.strictEqual(h.$('deckResetBtn').classList.contains('hidden'), true,
        'a classroom is offering to reset a deck it does not have');
      assert.strictEqual(h.calls.api.length, 0, 'a classroom asked the server for a hall deck');
    });
  }

  /* -------- the join card. A room code is the biggest type on a projected
     screen, so it has to be a code that typing actually gets you somewhere
     with: /api/join refuses a classroom's code once open joining is off (which
     setting the group count does automatically), while a hall's code is what
     every arriving country types and is never gated. -------- */
  function joinHarness(){
    const $ = makeDom();
    const build = new Function('$', `
      ${extractFn('renderJoinCard')}
      return { renderJoinCard };
    `);
    return { ...build($), $ };
  }
  const codeHidden = h => h.$('roomCodeBox').classList.contains('hidden');

  {
    const h = joinHarness();
    const r = h.renderJoinCard({ kind:'class', openJoin:false, slots:3 });
    check('a classroom with open joining off hides the code nobody can use', () => {
      assert.strictEqual(codeHidden(h), true,
        'the room code is still the largest thing on screen while /api/join refuses it');
      assert.strictEqual(r.codeWorks, false);
      assert.ok(/leader or class code/i.test(h.$('joinHow').textContent),
        'nothing on the card tells the class what to type instead');
    });
  }
  {
    /* A room now opens closed AND unprovisioned, so this is the very first
       thing a teacher sees. Telling them to hand out codes here would be
       telling them to hand out codes that do not exist yet. */
    const h = joinHarness();
    h.renderJoinCard({ kind:'class', openJoin:false, slots:0 });
    check('a fresh classroom points at Set rather than at codes nobody has yet', () => {
      assert.strictEqual(codeHidden(h), true, 'a code that cannot be used is on screen');
      assert.ok(/set the number of groups/i.test(h.$('joinHow').textContent),
        'the first screen of a new room does not say what to do next');
    });
  }
  {
    const h = joinHarness();
    const r = h.renderJoinCard({ kind:'class', openJoin:true });
    check('a classroom with open joining on shows the code again', () => {
      assert.strictEqual(codeHidden(h), false, 'the latecomer path is hidden while it actually works');
      assert.strictEqual(r.codeWorks, true);
    });
  }
  {
    const h = joinHarness();
    const r = h.renderJoinCard({ kind:'hall', openJoin:false });
    check('a hall always shows its code, open joining or not', () => {
      /* The regression this guards: gating on phase or on openJoin alone would
         hide the code a hall projects, because join-hall never checks it. */
      assert.strictEqual(codeHidden(h), false,
        'the hall room code is hidden — arriving countries have nothing to type');
      assert.strictEqual(r.codeWorks, true);
      assert.ok(/leader code first/i.test(h.$('joinHow').textContent),
        'the hall card does not say the leader code comes first');
    });
  }
  {
    const h = joinHarness();
    h.renderJoinCard({ kind:'hall', openJoin:undefined });
    check('a missing openJoin never hides a hall code', () => {
      assert.strictEqual(codeHidden(h), false, 'an absent field hid the hall code');
    });
  }

  /* -------- Fix round 1: the other half of the same regression —
     throwStrike() clears STRIKE_SELECTED (the set renderStrikePicker's
     checked= now reads from) on a successful throw, not by reaching into
     the DOM. This has to be awaited, unlike the render-survives-a-poll
     checks above, so it lives in this file's one async IIFE rather than
     risking microtask interleaving with a second unawaited one. -------- */
  {
    const board = [{ pid: 'P1', name: 'Alpha', displaced: 0, strk: '' }];
    const d = { kind: 'hall', phase: 'game', board };
    const h = strikeHarness();
    h.setApiImpl(() => ({ ok: true }));   // a successful throw
    h.toggleStrikePid('P1', true);
    h.renderStrikePicker(d);
    await h.throwStrike();
    check('a successful throw clears the selection, so the next render shows no boxes ticked', () => {
      assert.strictEqual(h.selected.size, 0, 'STRIKE_SELECTED was not cleared after a successful throw');
      assert.strictEqual(h.calls.tick, 1, 'throwStrike did not refresh the console after throwing');
      h.renderStrikePicker(d);
      assert.ok(!/value="P1"\s*checked\b/.test(h.$('strikeWho').innerHTML),
        'a country ticked before the throw came back checked on the very next render');
    });
  }
  {
    const board = [{ pid: 'P1', name: 'Alpha', displaced: 0, strk: '' }];
    const d = { kind: 'hall', phase: 'game', board };
    const h = strikeHarness();
    h.setApiImpl(() => ({ error: 'No such kind of strike.' }));   // a refusal
    h.toggleStrikePid('P1', true);
    h.renderStrikePicker(d);
    await h.throwStrike();
    check('a refused throw leaves the selection alone, so nothing has to be re-ticked', () => {
      assert.ok(h.selected.has('P1'), 'a server refusal cleared the selection anyway — the tick would have to be redone');
      assert.strictEqual(h.calls.tick, 0, 'throwStrike refreshed the console even though the server refused');
    });
  }

  /* -------- Fix round 2 (review, Minor): throwScen and resetDeck both
     confirm() before acting; the one IRREVERSIBLE action on this console —
     striking countries in front of the room — did not. A misclick used to
     have no way back. -------- */
  {
    const board = [{ pid: 'P1', name: 'Alpha', displaced: 0, strk: '' }];
    const d = { kind: 'hall', phase: 'game', board };
    const h = strikeHarness();
    h.setApiImpl(() => ({ ok: true }));
    h.setConfirm(false);   // the game master declines
    h.toggleStrikePid('P1', true);
    h.renderStrikePicker(d);
    await h.throwStrike();
    check('declining the confirm never reaches the server, and leaves the selection untouched', () => {
      assert.strictEqual(h.calls.confirm.length, 1, 'throwStrike did not ask for confirmation at all');
      assert.strictEqual(h.calls.api.length, 0, 'a declined confirm still struck the country');
      assert.ok(h.selected.has('P1'), 'a declined confirm cleared the selection anyway');
    });
  }
  {
    const board = [{ pid: 'P1', name: 'Alpha', displaced: 0, strk: '' }];
    const d = { kind: 'hall', phase: 'game', board };
    const h = strikeHarness();
    h.setApiImpl(() => ({ ok: true }));
    h.toggleStrikePid('P1', true);
    h.renderStrikePicker(d);
    await h.throwStrike();   // confirmResult defaults to true
    check('confirming proceeds exactly as before — the throw still reaches the server', () => {
      assert.strictEqual(h.calls.confirm.length, 1, 'a confirmed throw did not ask for confirmation');
      assert.strictEqual(h.calls.api.length, 1, 'confirming the throw never reached the server');
    });
  }

  process.exit(fails ? 1 : 0);
})().catch(e => {
  /* Without this the IIFE's own failure surfaces as whatever unrelated
     rejection happens to be pending when the process winds down — which is a
     long way from the line that actually broke. */
  console.error('FAIL  the console test block itself threw —', e && e.stack || e);
  process.exit(1);
});
