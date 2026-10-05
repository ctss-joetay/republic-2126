/* The admin panel is the most dangerous control in the app — it can delete
   every country in the cohort. Two servers are needed because ADMIN_KEY is
   read once at boot and the fail-closed behaviour can only be observed on a
   server that never had it set: one server starts with no ADMIN_KEY (BASE),
   one starts with a real one (BASE2).

   A second block, needing no network at all, extracts render(), armWipe(),
   delSelected(), wipe() and load() straight out of the shipped
   public/admin.html with the same loadFn-style Function() injection
   tests/console.test.js uses, and runs them against a DOM stub — anchored on
   rendered markup and the exact arguments posted to the server, not a
   whole-page includes(). */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupServer } = require('./helpers');
const E = require('../game_engine.js');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';

const ROOT = path.join(__dirname, '..');
const PORT  = 3327;
const PORT2 = 3333;   // not PORT+1 (3328) — that port is already board-privacy.test.js's
const KEY  = 'a-very-long-admin-key-1234';
const BASE  = `http://127.0.0.1:${PORT}`;      // no ADMIN_KEY
const BASE2 = `http://127.0.0.1:${PORT2}`;     // ADMIN_KEY set
const DATA_A = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-a-'));
const DATA_B = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-b-'));

const mk = base => ({
  post: (p, body) => fetch(base + p, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body) }).then(r => r.json()),
  get:  (p) => fetch(base + p).then(r => r.json()),
  /* raw Response, not the decoded JSON body — for header inspection
     (Cache-Control) and for timing the escalating-lockout delay, where the
     wall-clock cost of the request itself is the thing under test. */
  postRes: (p, body) => fetch(base + p, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body) })
});
const { post } = mk(BASE);
const { post: post2, get: get2, postRes: postRes2 } = mk(BASE2);
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };

let fails = 0, ran = 0;
const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

/* ============================================================
   BEHAVIOURAL — public/admin.html, no server needed
   ============================================================ */
const H = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp('^(async )?function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find function ' + name + '() in public/admin.html');
  return m[0];
}
function extractLet(name) {
  const re = new RegExp('^let ' + name + ' = .*;$', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find "let ' + name + '" in public/admin.html');
  return m[0];
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractConst(name) {
  const re = new RegExp('^const ' + escapeRe(name) + ' = .*;$', 'm');
  const m = re.exec(H);
  if (!m) throw new Error('could not find "const ' + name + '" in public/admin.html');
  return m[0];
}

/* A minimal stand-in for document: getElementById gives back the same
   idiom as console.test.js's makeDom (innerHTML/textContent/value/disabled
   plus a classList that tracks a "hidden" toggle), and querySelectorAll
   answers only the one selector the panel actually uses — '.pick:checked' —
   backed by a plain array the test seeds directly, since there is no real
   DOM here to parse checkboxes back out of rendered innerHTML. */
function domStub() {
  const els = new Map();
  const checkboxes = [];
  function elem(id) {
    if (!els.has(id)) els.set(id, {
      id, innerHTML: '', textContent: '', value: '', disabled: false,
      classList: {
        _hidden: false,
        toggle(cls, force) { if (cls === 'hidden') this._hidden = force === undefined ? !this._hidden : !!force; },
        add(cls) { if (cls === 'hidden') this._hidden = true; },
        remove(cls) { if (cls === 'hidden') this._hidden = false; },
        contains(cls) { return cls === 'hidden' ? this._hidden : false; }
      }
    });
    return els.get(id);
  }
  const document = {
    getElementById: elem,
    querySelectorAll(sel) { return sel === '.pick:checked' ? checkboxes.filter(c => c.checked) : []; }
  };
  return { document, elem, checkboxes };
}

/* Wires load/render/armWipe/delSelected/wipe together in one Function() so
   the closures over KEY and $ work exactly as they do in the shipped page.
   `post`, `confirm` and `alert` are injected mocks — the real `post` talks
   to fetch(), which has no place in a unit test. */
function buildAdminPanel({ document, post, confirm, alert }) {
  const src = [
    extractLet('KEY'),
    extractConst('$'),
    extractConst('esc'),
    extractConst('ago'),
    extractConst('picked'),
    extractFn('render'),
    extractFn('load'),
    extractFn('armWipe'),
    extractFn('delSelected'),
    extractFn('wipe')
  ].join('\n\n');
  const build = new Function('document', 'post', 'confirm', 'alert', `
    ${src}
    return { render, load, armWipe, delSelected, wipe, $ };
  `);
  return build(document, post, confirm, alert);
}

/* -------- render(): what is at stake must actually be ON THE PAGE, not
   merely somewhere in the JSON the panel already has -------- */
(() => {
  const { document, elem } = domStub();
  const panel = buildAdminPanel({ document, post: async () => ({}), confirm: () => true, alert: () => {} });
  const rooms = [
    { code: 'ABCD', kind: 'class', label: '3E', countries: 5, committed: 2, slots: 8, phase: 'prep', round: 0, touched: Date.now() - 60000 },
    { code: 'WXYZ', kind: 'hall', label: '', countries: 34, committed: 34, slots: 34, phase: 'game', round: 3, touched: Date.now() - 60000 }
  ];
  panel.render(rooms);
  const html = elem('rooms').innerHTML;
  check('every room in the list carries a checkbox tagged with its own room code', () => {
    assert.ok(html.includes('value="ABCD"'), 'ABCD has no selectable checkbox — delSelected could never target it');
    assert.ok(html.includes('value="WXYZ"'), 'WXYZ has no selectable checkbox — delSelected could never target it');
  });
  /* A room whose slots are already provisioned (paper leader codes printed
     and handed out) but whose countries haven't named themselves yet reads
     as "0 countries" under a count-only display — indistinguishable from a
     room nobody has touched, and it sorts to the top of the delete list
     alongside actual junk. slots pins that the provisioned total is shown
     too, not just how many have committed so far. */
  check('the row shows what is at stake: country count, how many slots are provisioned, and committed count', () => {
    assert.ok(/5 countries of 8 provisioned · 2 committed/.test(html), 'ABCD does not show "N countries of M provisioned · committed"');
    assert.ok(/34 countries of 34 provisioned · 34 committed/.test(html), 'WXYZ does not show its provisioned/committed counts — "34 countries" is exactly what should stop a teacher wiping a live hall room');
  });
  check('the total room count is shown', () => {
    assert.strictEqual(elem('count').textContent, '2 total', 'the total room count is wrong or missing');
  });

  /* -------- C1 (and its own follow-up finding): every interpolated field in
     the row must be escaped, not just the one (label) an earlier version of
     this test happened to check, and not just the five that touch strings.
     round was the original hole: admin/list echoes r.round verbatim, and
     POST /api/host/import accepts an arbitrary snapshot — including its
     round — from anyone, unauthenticated, for any room code not already
     live. countries, slots and committed are `.length` of an array
     server-side today, so they are not exploitable through the current
     admin/list — but render() has no way to know that, esc() costs nothing
     to apply, and the stated principle here is belt and braces (round got
     both esc() AND a server-side Number() coercion). Testing all eight
     fields at once, each with its own unique payload, is what stops the
     next edit from fixing some and leaving a neighbour two words away —
     this test named "all of them" once already while only checking five. */
  const hostile = [{
    code: 'AB<i>CODE</i>', kind: 'class<i>KIND</i>', label: '3E <script>alert(1)</script>',
    countries: '1<i>COUNTRIES</i>', slots: '1<i>SLOTS</i>', committed: '0<i>COMMITTED</i>',
    phase: 'prep<i>PHASE</i>', round: '3<img src=x onerror=alert(1)>',
    touched: Date.now()
  }];
  panel.render(hostile);
  const hostileHtml = elem('rooms').innerHTML;
  check('every interpolated field in the room row is escaped before it reaches the page — code, kind, label, phase, round, countries, slots and committed, all eight of them', () => {
    assert.ok(!hostileHtml.includes('<i>CODE</i>'), 'the room code reached the page unescaped');
    assert.ok(!hostileHtml.includes('<i>KIND</i>'), 'the room kind reached the page unescaped');
    assert.ok(!hostileHtml.includes('<script>alert(1)</script>'), 'a raw <script> tag from a room label reached the admin panel');
    assert.ok(!hostileHtml.includes('<i>PHASE</i>'), 'the room phase reached the page unescaped');
    assert.ok(!hostileHtml.includes('<img src=x onerror=alert(1)>'),
      'the room ROUND reached the page unescaped — this is the stored XSS an anonymous, unauthenticated POST /api/host/import can plant, firing the moment a teacher opens /admin and reaches the wipe button and the live admin key, both in the same script scope');
    assert.ok(!hostileHtml.includes('<i>COUNTRIES</i>'), 'the room countries field reached the page unescaped');
    assert.ok(!hostileHtml.includes('<i>SLOTS</i>'), 'the room slots field reached the page unescaped');
    assert.ok(!hostileHtml.includes('<i>COMMITTED</i>'), 'the room committed field reached the page unescaped');
    assert.ok(hostileHtml.includes('AB&lt;i&gt;CODE&lt;/i&gt;'), 'the room code was not escaped at all');
    assert.ok(hostileHtml.includes('class&lt;i&gt;KIND&lt;/i&gt;'), 'the room kind was not escaped at all');
    assert.ok(hostileHtml.includes('3E &lt;script&gt;alert(1)&lt;/script&gt;'), 'the room label was not escaped at all');
    assert.ok(hostileHtml.includes('prep&lt;i&gt;PHASE&lt;/i&gt;'), 'the room phase was not escaped at all');
    assert.ok(hostileHtml.includes('3&lt;img src=x onerror=alert(1)&gt;'), 'the room round was not escaped at all');
    assert.ok(hostileHtml.includes('1&lt;i&gt;COUNTRIES&lt;/i&gt;'), 'the room countries field was not escaped at all');
    assert.ok(hostileHtml.includes('1&lt;i&gt;SLOTS&lt;/i&gt;'), 'the room slots field was not escaped at all');
    assert.ok(hostileHtml.includes('0&lt;i&gt;COMMITTED&lt;/i&gt;'), 'the room committed field was not escaped at all');
  });
})();

/* -------- armWipe(): the button only arms on the exact word DELETE -------- */
(() => {
  const { document, elem } = domStub();
  const panel = buildAdminPanel({ document, post: async () => ({}), confirm: () => true, alert: () => {} });
  elem('confirm').value = 'delete';
  panel.armWipe();
  check('the wipe button stays disabled on a near-miss ("delete", lowercase)', () => {
    assert.strictEqual(elem('wipeBtn').disabled, true, 'the wipe button armed on a lowercase "delete"');
  });
  elem('confirm').value = 'DELETE';
  panel.armWipe();
  check('the wipe button arms once DELETE is typed exactly', () => {
    assert.strictEqual(elem('wipeBtn').disabled, false, 'the wipe button never armed on the exact word DELETE');
  });
})();

async function runPanelAsyncChecks() {
  /* -------- delSelected(): confirmed, and only the ticked rooms are sent -------- */
  {
    const { document, checkboxes } = domStub();
    const calls = [];
    let confirmResult = false;
    const panel = buildAdminPanel({
      document,
      post: async (p, body) => { calls.push(['post', p, body]); return p === '/api/admin/list' ? { ok: true, rooms: [] } : { ok: true }; },
      confirm: (m) => { calls.push(['confirm', m]); return confirmResult; },
      alert: (m) => { calls.push(['alert', m]); }
    });
    checkboxes.push({ value: 'ABCD', checked: true }, { value: 'WXYZ', checked: false });
    await panel.delSelected();
    check('declining the confirmation leaves every room in place', () => {
      assert.ok(!calls.some(c => c[0] === 'post' && c[1] === '/api/admin/delete'),
        'delSelected reached /api/admin/delete even though the confirmation was declined');
    });
    confirmResult = true;
    await panel.delSelected();
    check('confirming delSelected posts only the ticked room codes to /api/admin/delete', () => {
      const del = calls.find(c => c[0] === 'post' && c[1] === '/api/admin/delete');
      assert.ok(del, 'delSelected never reached /api/admin/delete after the teacher confirmed');
      assert.deepStrictEqual(del[2].rooms, ['ABCD'], 'delSelected sent the wrong set of rooms — it must send only the ticked one, not the unticked WXYZ');
    });
  }

  /* -------- wipe(): confirmed, and the literal word DELETE is sent -------- */
  {
    const { document } = domStub();
    const calls = [];
    let confirmResult = false;
    const panel = buildAdminPanel({
      document,
      post: async (p, body) => { calls.push(['post', p, body]); return p === '/api/admin/list' ? { ok: true, rooms: [] } : { ok: true }; },
      confirm: (m) => { calls.push(['confirm', m]); return confirmResult; },
      alert: (m) => { calls.push(['alert', m]); }
    });
    await panel.wipe();
    check('declining the final wipe confirmation reaches the server not at all', () => {
      assert.ok(!calls.some(c => c[0] === 'post' && c[1] === '/api/admin/wipe'),
        'wipe reached /api/admin/wipe even though the final confirmation was declined');
    });
    confirmResult = true;
    await panel.wipe();
    check('confirming wipe sends the literal word DELETE the server requires, not just a truthy flag', () => {
      const w = calls.find(c => c[0] === 'post' && c[1] === '/api/admin/wipe');
      assert.ok(w, 'wipe never reached /api/admin/wipe after the teacher confirmed');
      assert.strictEqual(w[2].confirm, 'DELETE', 'wipe did not send the literal confirmation word the server checks for');
    });
    /* I5: the confirm() question has to make OK mean "wipe", not "yes, take
       a backup first" — a teacher skimming a dialog clicks the affirmative
       button, and "This deletes EVERY room. Take a backup first?" makes the
       natural affirmative answer the opposite of what OK actually does.
       delSelected's confirm above already asks the right question ("Delete
       N room(s)…?"); wipe's has to as well. */
    check('the wipe confirmation asks "delete", not "back up" — OK must mean the same thing it does', () => {
      const confirmCall = calls.find(c => c[0] === 'confirm');
      assert.ok(confirmCall, 'wipe never called confirm() at all');
      const msg = confirmCall[1];
      assert.ok(/delete/i.test(msg), 'the wipe confirmation does not even mention deleting');
      assert.ok(!/take a backup first\s*\?/i.test(msg),
        'the wipe confirmation asks "…take a backup first?" as its yes/no question — OK reads as "yes, back up", but OK actually wipes with no backup taken. A teacher skimming clicks OK.');
    });
  }

  /* -------- load(): a wrong key keeps the gate up; the right key opens the
     panel and actually renders what came back -------- */
  {
    const { document, elem } = domStub();
    let resp = { error: 'Wrong admin key.' };
    const panel = buildAdminPanel({ document, post: async () => resp, confirm: () => true, alert: () => {} });
    // the shipped markup starts #panel with class="hidden" — mirror that starting state
    elem('panel').classList.add('hidden');
    elem('key').value = 'wrong';
    await panel.load();
    check('a wrong key keeps the gate up and shows the server\'s error', () => {
      assert.strictEqual(elem('gate').classList.contains('hidden'), false, 'the gate closed even though the key was refused');
      assert.strictEqual(elem('panel').classList.contains('hidden'), true, 'the panel opened even though the key was refused');
      assert.strictEqual(elem('gateMsg').textContent, 'Wrong admin key.', 'the server\'s error was never shown to the teacher');
    });
    resp = { ok: true, rooms: [{ code: 'ABCD', kind: 'hall', label: '', countries: 1, committed: 0, slots: 1, phase: 'prep', round: 0, touched: Date.now() }] };
    elem('key').value = 'right-key';
    await panel.load();
    check('the right key opens the panel and renders the rooms it was handed', () => {
      assert.strictEqual(elem('gate').classList.contains('hidden'), true, 'the gate stayed up after a correct key');
      assert.strictEqual(elem('panel').classList.contains('hidden'), false, 'the panel never opened after a correct key');
      assert.ok(elem('rooms').innerHTML.includes('value="ABCD"'), 'load() fetched the rooms but never actually rendered them');
    });
  }
}

/* I6: persistNow() has to survive racing an already-in-flight persist() —
   otherwise a debounced save that captured a room BEFORE a delete can
   rename its stale copy over STORE AFTER persistNow() wrote the post-delete
   state, resurrecting whatever was just deleted with no crash required at
   all. Reproducing that deterministically (instead of hoping two spawned
   processes happen to race inside a ~1.5s window) needs direct, in-process
   access to persist()/persistNow() themselves — requiring server.js
   in-process, the same technique tests/migration.test.js uses for PIDS,
   skips its listen() path via the require.main guard at the very end of
   server.js, so this shares no network surface and no state with the two
   spawned servers below.

   This first case only proves the benign half: persistNow() runs in the
   same synchronous turn as persist(), before persist()'s fs.mkdir callback
   has fired at all — so persist()'s write to its OWN temp file hasn't even
   started, and the saveGen check alone is enough to make it skip its stale
   rename. It cannot see the sharper bug a first attempt at this fix
   introduced: persist() and persistNow() briefly wrote to the identical
   temp path, so a persistNow() that ran WHILE persist()'s write already had
   that path open could have its own write land inside the same inode
   persist()'s file descriptor was still writing to — corruption that
   survives even though the saveGen check correctly skips persist()'s
   RENAME, because the damage happens at the WRITE, through the shared
   descriptor, not at the rename. runPersistRaceCheck2() below forces
   exactly that overlap. */
async function runPersistRaceCheck() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-race-'));
  const savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const S = require(path.join(ROOT, 'server.js'));
  process.env.DATA_DIR = savedDataDir;

  /* Counts fs.rename(tmp → store) calls for this room's own STORE, across
     the whole scenario below — set up BEFORE persist() is ever called, so
     nothing can be dispatched and missed. The round-1 guard (the pre-rename
     saveGen check) and the round-4 repair (the post-rename saveGen
     re-check, see server.js) can produce an IDENTICAL final disk state —
     'after', correct — while meaning very different things: the guard means
     the stale rename was never dispatched at all, so the wiped/deleted
     cohort was never on disk in any form; the repair means it WAS
     dispatched, landed, sat there for real (however briefly) as the live
     store, and only then got overwritten again. A crash or SIGTERM inside
     that transient still resurrects it permanently — the repair narrows the
     window to microseconds, it does not close it. Only counting dispatches,
     not reading final content, can tell these apart; the existing "cannot be
     clobbered" check below cannot, and would stay green even if the guard
     that makes this prevention (not just eventual correction) were deleted. */
  const tmpPath = path.join(dataDir, 'rooms.json.tmp');
  const storePath = path.join(dataDir, 'rooms.json');
  let staleRenameDispatched = 0;
  const realRename = fs.rename;
  fs.rename = function(...args) {
    if (args[0] === tmpPath && args[1] === storePath) staleRenameDispatched++;
    return realRename.apply(fs, args);
  };

  const room = S.newRoom('hall', '');
  room.label = 'before';
  S.persist();          // captures {label:'before'} synchronously right now, then goes fully async
  room.label = 'after';  // mutated before persist()'s queued fs.mkdir/writeFile/rename has run at all
  S.persistNow();        // synchronous: writes {label:'after'} straight through, and bumps the
                          // generation counter that is supposed to supersede the in-flight write above
  await new Promise(r => setTimeout(r, 400)); // let persist()'s queued async chain actually run to completion
  fs.rename = realRename;

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8'));
  const savedRoom = onDisk.rooms.find(r => r.code === room.code);
  check('persistNow() cannot be clobbered by a persist() that was already in flight when it ran (same-tick, benign-rename variant)', () => {
    assert.ok(savedRoom, 'the room never made it to disk at all');
    assert.strictEqual(savedRoom.label, 'after',
      `disk shows label "${savedRoom && savedRoom.label}" — persist()'s stale write (captured before persistNow() ran) landed AFTER persistNow()'s synchronous save and silently overwrote it. This is the exact resurrection persistNow() exists to prevent, reachable here with no crash at all.`);
  });
  check('…and prevented, not merely repaired: the stale rename is never even dispatched, so the wiped state is never on disk at all, not even transiently', () => {
    assert.strictEqual(staleRenameDispatched, 0,
      `persist()'s stale rename to STORE was dispatched ${staleRenameDispatched} time(s) — a post-rename repair could still put the correct state back afterwards (and the check above would stay green either way), but a dispatched rename means the stale, already-superseded state was briefly live on disk in between, real enough for a crash or SIGTERM landing in that window to resurrect it permanently. The pre-rename saveGen check is what stops this rename from ever being called in the first place; removing it turns prevention into after-the-fact repair, which this assertion — unlike the one above — can tell apart from prevention.`);
  });
  /* This same abandoned-write is also the case that leaves a temp file
     behind if nothing unlinks it: persist()'s write to rooms.json.tmp
     completed, but its saveGen check (correctly) decided never to rename it
     anywhere, since persistNow() had already landed the current state. With
     disjoint temp names that file has no natural second writer to overwrite
     it later, unlike the old shared-name code where persistNow()'s own next
     write consumed the same path — left alone, it just sits there, doubling
     peak disk use on a small volume for a file nothing will ever read. */
  check('an abandoned write does not leave its temp file behind', () => {
    assert.ok(!fs.existsSync(path.join(dataDir, 'rooms.json.tmp')),
      "persist()'s temp file survived being abandoned — nothing unlinked it after the saveGen check skipped its rename");
  });

  fs.rmSync(dataDir, { recursive:true, force:true });
}

/* The sharper variant: persist()'s write must genuinely be open on the
   filesystem — not merely queued in JS — when persistNow() runs, so that if
   they ever again shared a temp path, persistNow()'s open(path,'w') would
   truncate the SAME inode persist()'s file descriptor already has open,
   and persist()'s still-pending write() would then land inside whatever
   that inode has become (renamed to STORE by persistNow() in the meantime).
   Waiting on real disk timing for this is what the shipped bug depended on
   — flaky here, and the reviewer's own reproduction needed a payload that
   grew the store to 120MB over 6 seconds on a slow disk to land reliably.
   Forcing it instead, by intercepting the ONE fs.open() call persist()'s
   fs.writeFile makes for its own temp path and firing persistNow()
   synchronously the instant that open() hands back a real, live file
   descriptor (before persist() has written a single byte through it),
   reproduces the exact interleaving deterministically regardless of disk
   speed — proven against a plain reimplementation of both old code paths
   in isolation before this was wired up against the genuine, unmodified
   server.js functions below. */
async function runPersistRaceCheck2() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-race2-'));
  const savedDataDir = process.env.DATA_DIR;
  const serverPath = path.join(ROOT, 'server.js');
  process.env.DATA_DIR = dataDir;
  delete require.cache[require.resolve(serverPath)]; // a genuinely fresh module instance, not runPersistRaceCheck()'s
  const S2 = require(serverPath);
  process.env.DATA_DIR = savedDataDir;

  const room = S2.newRoom('hall', '');
  room.label = 'before';
  const tmpPath = path.join(dataDir, 'rooms.json.tmp'); // persist()'s own temp path, not persistNow()'s

  const realOpen = fs.open;
  let armed = true;
  fs.open = function(...args) {
    const p = args[0];
    if (armed && p === tmpPath) {
      armed = false; // only persist()'s own open — never re-trigger on persistNow()'s, if it ever shared this path again
      const cb = args[args.length - 1];
      const rest = args.slice(0, -1);
      return realOpen.call(fs, ...rest, (err, fd) => {
        // persist()'s fd is now genuinely open on this inode, before it has
        // written anything through it — exactly the moment the reported bug
        // needs persistNow() to run.
        room.label = 'after';
        S2.persistNow();
        cb(err, fd);
      });
    }
    return realOpen.apply(fs, args);
  };
  S2.persist();
  await new Promise(r => setTimeout(r, 400));
  fs.open = realOpen;
  delete require.cache[require.resolve(serverPath)];

  const raw = fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8');
  check("persistNow() cannot be corrupted by persist()'s write landing through an already-open, now-shared file descriptor (the sharper variant a shared temp path allowed)", () => {
    let onDisk;
    try { onDisk = JSON.parse(raw); }
    catch (e) { assert.fail('rooms.json on disk is not even valid JSON — corrupted by an overlapping write into a shared inode: ' + e.message); }
    const savedRoom = onDisk.rooms.find(r => r.code === room.code);
    assert.ok(savedRoom, 'the room never made it to disk at all');
    assert.strictEqual(savedRoom.label, 'after',
      `disk shows label "${savedRoom && savedRoom.label}" — persist()'s own file descriptor, opened before persistNow() ran, followed its inode straight through persistNow()'s rename and wrote stale bytes into what had already become the live store. The saveGen guard correctly skipped persist()'s RENAME (this would otherwise be even worse), but the damage happens at the WRITE, through a descriptor shared via an identical temp path — exactly what giving persist() and persistNow() distinct temp filenames is supposed to rule out.`);
  });

  fs.rmSync(dataDir, { recursive:true, force:true });
}

/* A third variant, smaller than the second but the same shape: giving
   persist() and persistNow() disjoint temp names closed the shared-inode
   write race, but persist()'s own saveGen check runs BEFORE its fs.rename()
   — and that rename executes on the threadpool afterwards, not
   synchronously. If a persistNow() lands in the dispatch-to-completion gap
   of that one rename, its correct write (via a different temp name, so no
   corruption at the write level) gets silently overwritten when persist()'s
   already-dispatched, now-stale rename lands last. Under the OLD shared
   name this was self-healing — persistNow()'s renameSync had already
   consumed persist()'s temp file, so persist()'s later rename hit ENOENT
   and did nothing — but disjoint names removed that accidental protection
   along with the corruption they were meant to fix.

   Reproducing this needs persistNow() to complete — write AND rename —
   strictly BEFORE persist()'s own already-dispatched rename lands on disk,
   even though persist()'s rename was called first. Waiting on real timing
   for that specific ordering was tried and rejected: the window measured in
   the tens of trials attempted here was on the order of a millisecond and
   never landed. Intercepting fs.rename for persist()'s specific source/dest
   pair and running persistNow() to completion before ever invoking the real
   rename reproduces the *outcome* precisely — persistNow()'s write
   deterministically finishes before persist()'s does — without needing to
   win a real race to get there. */
async function runPersistRaceCheck3() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-race3-'));
  const savedDataDir = process.env.DATA_DIR;
  const serverPath = path.join(ROOT, 'server.js');
  process.env.DATA_DIR = dataDir;
  delete require.cache[require.resolve(serverPath)];
  const S3 = require(serverPath);
  process.env.DATA_DIR = savedDataDir;

  const room = S3.newRoom('hall', '');
  room.label = 'before';
  const tmpPath = path.join(dataDir, 'rooms.json.tmp');   // persist()'s own temp path
  const storePath = path.join(dataDir, 'rooms.json');

  const realRename = fs.rename;
  let armed = true;
  fs.rename = function(...args) {
    const [src, dest] = args;
    if (armed && src === tmpPath && dest === storePath) {
      armed = false; // only persist()'s own rename — never re-trigger on the persistNow() call below, which uses a different temp name anyway
      // gen matched at the moment persist() decided to call this — run
      // persistNow() to completion now, so its write+rename genuinely
      // finishes before the real rename below ever executes, exactly the
      // ordering the reported bug depends on.
      room.label = 'after';
      S3.persistNow();
    }
    return realRename.apply(fs, args);
  };
  S3.persist();
  await new Promise(r => setTimeout(r, 400));
  fs.rename = realRename;
  delete require.cache[require.resolve(serverPath)];

  const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const savedRoom = onDisk.rooms.find(r => r.code === room.code);
  check("persist() re-checks saveGen after its own rename actually completes, and repairs the store if a persistNow() landed inside the dispatch-to-completion window", () => {
    assert.ok(savedRoom, 'the room never made it to disk at all');
    assert.strictEqual(savedRoom.label, 'after',
      `disk shows label "${savedRoom && savedRoom.label}" — persist()'s rename was dispatched while gen still matched, but persistNow() finished first and wrote the correct state; persist()'s rename then landed anyway and overwrote it with stale bytes, and nothing put the correct state back. The old shared temp name made this self-healing by accident (persistNow() had already consumed the file persist() was about to rename, so persist()'s rename failed harmlessly with ENOENT); disjoint names removed that accident along with the bug it was covering for.`);
  });

  fs.rmSync(dataDir, { recursive:true, force:true });
}

/* Pre-existing, and orthogonal to the three races above: a rename that
   fails outright (a transient hiccup on Railway's network-backed volume,
   say — not a race with persistNow(), just plain I/O failure) used to be
   dropped silently. `again` only gets set by a mutation landing WHILE a
   save is in flight, so a room nothing touches again afterward would never
   get retried at all — not on the usual debounce, not ever, short of some
   unrelated room's mutation happening to call persist() again later.
   Forcing a real fs.rename to report failure (without touching the real
   filesystem — the callback is intercepted, not the actual rename call, so
   nothing on disk is disturbed) proves the retry this fix adds actually
   lands the save once the ordinary debounce fires. */
async function runPersistRenameErrorRetryCheck() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-adm-race4-'));
  const savedDataDir = process.env.DATA_DIR;
  const serverPath = path.join(ROOT, 'server.js');
  process.env.DATA_DIR = dataDir;
  delete require.cache[require.resolve(serverPath)];
  const S4 = require(serverPath);
  process.env.DATA_DIR = savedDataDir;

  const room = S4.newRoom('hall', '');
  room.label = 'retry-me';
  const tmpPath = path.join(dataDir, 'rooms.json.tmp');
  const storePath = path.join(dataDir, 'rooms.json');

  const realRename = fs.rename;
  let failedOnce = false;
  fs.rename = function(...args) {
    const [src, dest, cb] = args;
    if (!failedOnce && src === tmpPath && dest === storePath) {
      failedOnce = true;
      return cb(new Error('simulated transient rename failure — nothing on disk was touched'));
    }
    return realRename.apply(fs, args);
  };

  S4.persist();
  await new Promise(r => setTimeout(r, 200)); // let the simulated failure land
  fs.rename = realRename; // restore before the retry, so it uses the real rename

  check('a failed rename does not silently drop the save', () => {
    assert.ok(!fs.existsSync(storePath), 'the store already exists after only the forced-failing rename — the test fixture is not isolating the failure correctly');
  });

  await new Promise(r => setTimeout(r, 2000)); // past the 1.5s debounce a retry needs

  check('…because the failure schedules a retry, and the retry actually lands the save', () => {
    assert.ok(fs.existsSync(storePath),
      'no retry ever landed — a rename that fails on a room nothing else touches afterward silently drops the save until the process restarts');
    const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.ok(onDisk.rooms.some(r => r.code === room.code), "the retried save landed but doesn't contain the room");
  });

  fs.rmSync(dataDir, { recursive:true, force:true });
}

/* ============================================================
   SERVER — two processes: one with no ADMIN_KEY, one with a real one
   ============================================================ */
const server  = spawn('node', ['server.js'], { cwd:ROOT, stdio:'ignore',
  env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT),  DATA_DIR:DATA_A } });
/* server2's stderr is captured, not ignored: findTeam() self-heals a CODES
   entry left dangling by a room that vanished from ROOMS without going
   through dropRoom() first, logging "CODES pointed … which no longer
   exists" the moment anything looks that code up again — and only then.
   That self-heal means an HTTP round-trip alone (ask for the code, see it
   fail) cannot tell "admin/delete purged CODES at delete time" apart from
   "admin/delete forgot, and the very next lookup papered over it." Only the
   absence of that log line, checked straight after the delete and before
   any lookup could have caused it, proves the purge actually happened when
   it was supposed to. */
let server2Stderr = '';
const server2 = spawn('node', ['server.js'], { cwd:ROOT, stdio:['ignore','ignore','pipe'],
  env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT2), DATA_DIR:DATA_B, ADMIN_KEY:KEY } });
server2.stderr.on('data', d => { server2Stderr += d.toString(); });

/* killing and rmSync-ing immediately is a real race: kill() only sends the
   signal, the child's own SIGTERM handler still has a synchronous persist
   (and possibly a pending debounced one) to run before it actually exits,
   and this file in particular now leaves plenty of in-flight writes around
   at teardown time — an rmSync that starts before the child is truly gone
   can catch a write landing mid-delete and throw ENOTEMPTY. cleanupServer
   (tests/helpers.js) waits for the child's real 'exit' event first. */
const done = (c) => {
  Promise.all([cleanupServer(server, DATA_A), cleanupServer(server2, DATA_B)])
    .then(() => process.exit(c));
};

(async () => {
  await runPanelAsyncChecks();
  await runPersistRaceCheck();
  await runPersistRaceCheck2();
  await runPersistRaceCheck3();
  await runPersistRenameErrorRetryCheck();

  for (const b of [BASE, BASE2]) {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(b + '/health'); if (r.ok) break; } catch (e) {}
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /* Fail-closed has to hold on all four routes, not just list — each one
     calls adminOk()/adminDeny() independently, so a route that grew its own
     copy-pasted guard (or lost it) would not be caught by testing only one.
     Distinguishing the message matters too, not just any error: a server
     that treats an unset (i.e. zero-length) ADMIN_KEY as merely "the wrong
     key" rather than "not enabled" has quietly turned the length guard into
     ">= 0" — every route would still 400, but the fail-closed property the
     length check exists for would be gone. */
  for (const route of ['list', 'export', 'delete', 'wipe']) {
    const r = await post('/api/admin/' + route, { key: KEY });
    check(`with no ADMIN_KEY, admin/${route} does not open`, () => {
      assert.strictEqual(r.error, 'The admin panel is not enabled on this server.',
        `admin/${route} answered on a server with no key set, or answered with the wrong message (a wrong-key-style refusal instead of "not enabled")`);
    });
  }
  check('the 16-character minimum for ADMIN_KEY is the actual threshold in server.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(/ADMIN_KEY\.length\s*>=\s*16\b/.test(src),
      'server.js no longer requires ADMIN_KEY to be at least 16 characters — a short, easily-guessed key could enable the most destructive control in the app');
  });

  /* admin/delete and admin/wipe must route every removal through dropRoom(),
     the one function that also purges CODES (leader + view codes) and PIDS —
     never a bare ROOMS.delete(). This cannot be told apart behaviourally for
     admin/wipe the way it can for admin/delete above: a wiped hall room has
     no leader/view codes of its own to probe, and after a wipe ROOMS is
     empty either way, so /api/admin/list reporting zero rooms is exactly as
     true under a bare ROOMS.delete() as under a real purge — the same
     self-heal blind spot, just with no code left to query it through.
     Reading the route bodies directly is the only way left to pin it down. */
  function extractRouteBody(routeKey) {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const marker = `'${routeKey}':`;
    const at = src.indexOf(marker);
    if (at === -1) throw new Error('could not find route ' + routeKey + ' in server.js');
    const braceStart = src.indexOf('{', src.indexOf('=>', at));
    let i = braceStart + 1, depth = 1;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    return src.slice(braceStart, i);
  }
  check('admin/delete purges through dropRoom(), not a bare ROOMS.delete()', () => {
    assert.ok(/\bdropRoom\(/.test(extractRouteBody('POST /api/admin/delete')),
      'admin/delete no longer calls dropRoom() — leader codes, class codes and pids for the deleted room could linger in CODES/PIDS');
  });
  check('admin/wipe purges through dropRoom(), not a bare ROOMS.delete()', () => {
    assert.ok(/\bdropRoom\(/.test(extractRouteBody('POST /api/admin/wipe')),
      'admin/wipe no longer calls dropRoom() — leader codes, class codes and pids for every wiped room could linger in CODES/PIDS');
  });

  const r1 = await post2('/api/host/create', { kind:'class', label:'3E' });
  const r2 = await post2('/api/host/create', { kind:'hall', key: HALL_PASS });

  const wrong = await post2('/api/admin/list', { key:'wrong' });
  const short = await post2('/api/admin/list', { key:'short' });
  const none  = await post2('/api/admin/list', {});
  check('only the right key opens it, refused with the honest message rather than merely truthy — a 500 leak would also be truthy', () => {
    assert.strictEqual(wrong.error, 'Wrong admin key.', 'a wrong key was not cleanly refused with the expected message');
    assert.strictEqual(short.error, 'Wrong admin key.', 'a short key was not cleanly refused with the expected message');
    assert.strictEqual(none.error,  'Wrong admin key.', 'a missing key was not cleanly refused with the expected message');
  });

  const list = await post2('/api/admin/list', { key: KEY });
  check('the list shows what you are about to lose', () => {
    assert.ok(!list.error, 'the correct key was refused: ' + list.error);
    assert.strictEqual(list.rooms.length, 2);
    const row = list.rooms.find(x => x.code === r1.room);
    assert.strictEqual(row.label, '3E');
    assert.ok('countries' in row && 'touched' in row, 'the row does not say how much is at stake');
  });
  check('the list leaks no keys or codes', () => {
    const s = JSON.stringify(list);
    assert.ok(!s.includes(r1.hostKey), 'a host key was published by the admin list');
    assert.ok(!s.includes(r2.hostKey), 'a host key was published by the admin list');
  });

  /* POST /api/admin/key — the way back into a room whose host key was lost
     when the console tab closed. One room, asked for by name, behind the same
     gate as everything else here; the list above must keep carrying none, or
     a single screenshot of this page leaks every key at the event. */
  const keyWrong = await post2('/api/admin/key', { key:'wrong', room:r1.room });
  const keyNone  = await post2('/api/admin/key', { room:r1.room });
  check('a host key is not handed out without the admin key', () => {
    assert.strictEqual(keyWrong.error, 'Wrong admin key.');
    assert.strictEqual(keyNone.error,  'Wrong admin key.');
  });
  const keyOk    = await post2('/api/admin/key', { key:KEY, room:r1.room });
  const keyOther = await post2('/api/admin/key', { key:KEY, room:r2.room });
  const keyGone  = await post2('/api/admin/key', { key:KEY, room:'ZZZZ' });
  check('the right admin key recovers the room\'s host key, and only that room\'s', () => {
    assert.strictEqual(keyOk.hostKey, r1.hostKey, 'the wrong host key came back');
    assert.strictEqual(keyOk.room, r1.room);
    assert.strictEqual(keyOther.hostKey, r2.hostKey, 'every room must be recoverable, not just the first');
    assert.notStrictEqual(keyOk.hostKey, keyOther.hostKey);
  });
  check('asking for a room that does not exist says so, rather than answering with nothing', () => {
    assert.strictEqual(keyGone.error, 'No room with that code.');
    assert.ok(!('hostKey' in keyGone), 'a reply for a missing room still carried a hostKey field');
  });

  /* -------- lockout: escalating delay (250ms × 2^min(fails,5)), not a hard
     lock, and reset to nothing on success. adminFails is 0 here because the
     successful `list` call just above reset it — every measurement below
     starts from a known baseline instead of trusting call order elsewhere in
     this file. Margins are wide (a local loopback round-trip is a few ms) but
     still wide apart from each other, so ordinary CI jitter cannot blur the
     doubling. -------- */
  {
    const w1 = await timed(() => post2('/api/admin/list', { key:'wrong' }));
    check('a first wrong key is throttled by roughly the 250ms base brake', () => {
      assert.ok(w1.ms >= 200 && w1.ms < 600, `first wrong key answered in ${w1.ms}ms — expected roughly 250ms`);
    });
    const w2 = await timed(() => post2('/api/admin/list', { key:'wrong' }));
    check('a second consecutive wrong key waits meaningfully longer — the delay escalates, it is not a flat brake', () => {
      assert.ok(w2.ms >= 400 && w2.ms < 900, `second wrong key answered in ${w2.ms}ms — expected roughly 500ms`);
      assert.ok(w2.ms > w1.ms + 150, `second wrong key (${w2.ms}ms) was not meaningfully slower than the first (${w1.ms}ms)`);
    });
    const right = await timed(() => post2('/api/admin/list', { key: KEY }));
    check('the correct key succeeds immediately no matter how many failures preceded it — never a hard lock on the one control that can rescue a broken event', () => {
      assert.ok(!right.r.error, 'the correct key was refused after only two prior failures');
      assert.ok(right.ms < 150, `the correct key took ${right.ms}ms — a lock or an inherited delay would have held it up`);
    });
    const w3 = await timed(() => post2('/api/admin/list', { key:'wrong' }));
    check('a success resets the delay back to the base ~250ms, not the escalated one it left off at', () => {
      assert.ok(w3.ms >= 200 && w3.ms < 600, `wrong key right after a success took ${w3.ms}ms — expected roughly the base 250ms; a much larger figure means reset-on-success is broken and the two prior failures are still being counted`);
    });
  }

  const exportNoKey = await post2('/api/admin/export', {});
  check('admin/export refuses with no key, exactly like every other admin route', () => {
    assert.ok(exportNoKey.error, 'admin/export answered a request with no key at all');
  });
  const exportRes = await postRes2('/api/admin/export', { key: KEY });
  const exportOk = await exportRes.json();
  check('admin/export — unlike admin/list — does hand back a real host key; this pins the asymmetry from both ends, not just that list withholds one', () => {
    assert.ok(!exportOk.error, 'the correct key was refused for export: ' + exportOk.error);
    assert.ok(Array.isArray(exportOk.rooms) && exportOk.rooms.length === 2, 'export did not return every room');
    const roomExp = exportOk.rooms.find(x => x.code === r1.room);
    assert.ok(roomExp, "export did not include r1's room at all");
    assert.strictEqual(roomExp.hostKey, r1.hostKey, "export did not return the room's real host key — the one thing a backup exists to preserve");
  });
  /* This pins json()'s global default (no ETag on a response means
     Cache-Control: no-store, server.js's json() helper) as observed through
     admin/export specifically — not something export does on its own behalf.
     It still genuinely bites: admin/export is exactly the route where that
     global default matters most, since it carries every credential in the
     cohort and a cache serving a stale copy would be as bad as no auth
     check at all. */
  check("admin/export gets json()'s no-store-unless-cached default — it carries every credential in the cohort, so that default matters here most of all", () => {
    assert.strictEqual(exportRes.headers.get('cache-control'), 'no-store', 'admin/export did not send Cache-Control: no-store');
  });

  /* -------- ordering: oldest-touched first, so junk floats up and a live
     game sinks. r2 (the hall room) was created after r1, so it starts more
     recently touched; touching r1 again (a plain GET /api/room, exactly what
     a projector poll does) must move it to the back of the list. -------- */
  await get2('/api/room?room=' + r1.room);
  const ordered = await post2('/api/admin/list', { key: KEY });
  check('the list is ordered oldest-touched first', () => {
    const codes = ordered.rooms.map(r => r.code);
    assert.deepStrictEqual(codes, [r2.room, r1.room],
      'the just-touched room did not sink to the back of the list — a teacher scanning top-down would see live rooms mixed in with the junk');
  });

  const g = await post2('/api/host/groups', { room:r1.room, hostKey:r1.hostKey, n:2 });
  /* I4: name both provisioned slots and commit one of them, so admin/list's
     countries/committed fields are checked against real data — not a stub
     that always answers `countries:0, committed:0` and still passes a bare
     `'countries' in row` presence check, which is all the list test above
     required. This is the whole reason the panel exists: showing what is
     actually at stake before a teacher ticks a room for deletion. */
  await post2('/api/team/save', { code:g.roster[0].code, country:{ name:'Testland', members:{ leader:'Leader One' } } });
  await post2('/api/team/save', { code:g.roster[1].code, country:{ name:'Otherland', members:{ leader:'Leader Two' } } });
  await post2('/api/team/commit', { code:g.roster[0].code });
  const listWithCodes = await post2('/api/admin/list', { key: KEY });
  check('the list leaks no country codes either, once countries exist', () => {
    const s = JSON.stringify(listWithCodes);
    assert.ok(!s.includes(g.roster[0].code), 'a country leader code was published by the admin list');
    assert.ok(!s.includes(g.roster[0].viewCode), 'a country class code was published by the admin list');
  });
  check('the list reflects real provisioning, naming and committing, not a stub that always says zero', () => {
    const row = listWithCodes.rooms.find(x => x.code === r1.room);
    assert.ok(row, "r1's row is missing from the list");
    assert.strictEqual(row.slots, 2, 'the row does not show that 2 slots are provisioned');
    assert.strictEqual(row.countries, 2, 'the row does not count both named countries');
    assert.strictEqual(row.committed, 1, 'the row does not count exactly the one committed country');
  });

  /* I6: persistNow() exists so admin/delete's removal survives a crash in
     the ordinary 1.5s debounce window. Proving that means reading the disk
     file server2 actually owns (DATA_B/rooms.json) right after the delete —
     but that only means something if r1's pre-delete state (created, named,
     committed above) genuinely reached disk first. Waiting out one full
     debounce period and checking that precondition explicitly means a
     timing fluke shows up as a loud, separately-named failure instead of
     silently making the real check below vacuous. */
  await new Promise(r => setTimeout(r, 1700));
  const roomsOnDisk = () => JSON.parse(fs.readFileSync(path.join(DATA_B, 'rooms.json'), 'utf8'));
  check("r1's pre-delete state actually reached disk, so the check after the delete below means something", () => {
    assert.ok(roomsOnDisk().rooms.some(x => x.code === r1.room),
      "r1 was never written to rooms.json before the delete — the disk check after admin/delete would prove nothing either way");
  });

  const del = await post2('/api/admin/delete', { key: KEY, rooms:[r1.room] });
  check('admin/delete reports success', () => {
    assert.ok(!del.error, 'delete failed: ' + del.error);
  });
  check('admin/delete flushes to disk immediately — persistNow(), not the 1.5s debounce, and not a stale in-flight persist() clobbering it back in', () => {
    assert.ok(!roomsOnDisk().rooms.some(x => x.code === r1.room),
      'the deleted room is still on disk immediately after admin/delete returned');
  });
  const dead = await get2('/api/state?code=' + g.roster[0].code);
  check("a deleted room's leader code stops resolving", () => {
    assert.ok(dead.error, 'a deleted room\'s country code still resolves');
  });
  await new Promise(r => setTimeout(r, 150)); // let the child's stderr pipe drain before reading it
  /* This is the genuine catch, and the only one of the four checks around
     this delete that can actually tell "dropRoom() purged CODES at delete
     time" apart from "the room merely vanished from ROOMS, and the /api/state
     lookup above happened to self-heal the stale CODES entry on its way
     out" — an HTTP round-trip alone cannot distinguish those two, only the
     absence of findTeam's self-heal warning can. */
  check("deleting a room actually purges CODES — dropRoom() ran, not findTeam()'s lazy self-heal papering over a bare ROOMS.delete()", () => {
    assert.ok(!server2Stderr.includes('CODES pointed'),
      'querying the deleted room\'s leader code triggered findTeam\'s "CODES pointed … which no longer exists" self-heal warning — CODES still held a stale entry for it, meaning admin/delete only removed the room from ROOMS and left the leader code, class code and pid indexes for findTeam\'s next lookup to clean up by accident');
  });

  /* I1: a second, still-live class room with a provisioned group, created
     just before the wipe, so wipe's CODES purge has something to prove
     itself against. Without this, the only room left standing for the wipe
     (r2, a hall room with no groups of its own) has no leader/view code to
     probe at all, and after a wipe ROOMS is empty either way — so grepping
     the route source for "dropRoom(" alone (kept above as a belt) can be
     satisfied by a decoy that never actually purges anything, e.g.
     `if(false) dropRoom(r); ROOMS.delete(r.code);`, and the suite would stay
     green throughout. */
  const r3 = await post2('/api/host/create', { kind:'class', label:'wipe-purge-check' });
  const g3 = await post2('/api/host/groups', { room:r3.room, hostKey:r3.hostKey, n:1 });

  /* C1's enabling half is the final-review's own finding 5: POST
     /api/host/import used to accept an arbitrary snapshot with no
     authentication at all whenever its room code was not already live — it
     supplies its own hostKey, and the "already open with a different host
     key" guard only ever fired for a code that WAS live. Reproduced live
     before that fix shipped: 300 anonymous rooms planted in well under a
     second. The fix requires a LIVE room whose hostKey matches, so this is
     a deliberate reversal of what this exact assertion used to pin —
     confirming the hole is closed, not confirming it is still open. See
     .superpowers/sdd/2026-07-31-rooms-and-roles/final-fixes-report.md. */
  /* Note this call carries no `key` at all — server2 DOES have a real
     ADMIN_KEY configured (KEY, above), so this is specifically the "cold +
     no admin key" half of the re-review's three-way pin, not merely "no
     admin key configured anywhere". */
  const hostileImport = await post2('/api/host/import', { snapshot: {
    code: 'ZZIMP', hostKey: 'attacker-supplied-key', teams: {}, offers: [], feed: [],
    kind: 'hall', label: '', phase: 'prep', maxRounds: 6,
    round: '<img src=x onerror=fetch(1)>', created: Date.now(), touched: Date.now(), rev: 1
  } });
  check('POST /api/host/import now refuses an unauthenticated snapshot (cold room, no admin key) for a room code that is not already live — the attack surface C1 depended on is closed', () => {
    assert.ok(hostileImport.error, 'a snapshot for a room code that was never live was accepted with no authentication at all: ' + JSON.stringify(hostileImport));
  });
  const listAfterHostileImport = await post2('/api/admin/list', { key: KEY });
  check('the refused hostile import planted no room at all', () => {
    assert.ok(!listAfterHostileImport.rooms.some(x => x.code === 'ZZIMP'), 'a room now exists at ZZIMP despite the import being refused');
  });

  /* -------- re-review "NEW-2": the plain "must be live" fix silently
     deleted the documented backup safety net — README.md's "Restore from
     file … puts it back with the same room code and the same country
     codes", the setup screen's own "Have a backup file from last lesson?"
     button, and specifically the one scenario that button exists for: the
     room is NOT live (volume lost, an /admin wipe, or the teacher's own
     act:'reset', which calls dropRoom()). The carve-out keeps the
     unauthenticated hole shut (this is still gated, just on the admin key
     instead of on being live) while restoring genuine cold recovery. Prove
     it does what the backup promise requires: a room reachable again at ITS
     ORIGINAL code, with its country's ORIGINAL leader/class codes, not
     merely "some room got created". -------- */
  const coldTeam = Object.assign(E.blankCountry(), {
    code:'COLDLDR1', viewCode:'COLDVW01', pid:'COLDPID1', name:'Coldstart',
    homeland:'delta', slot:1, members:{ leader:'Cole', edu:'', def:'', trade:'', infra:'' }
  });
  coldTeam.meters = E.foundingMeters(coldTeam);
  const coldSnapshot = {
    code:'CLDR', hostKey:'cold-recovery-hostkey', kind:'hall', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0, teams:{ COLDLDR1:coldTeam }, offers:[], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const coldNoKey = await post2('/api/host/import', { snapshot: coldSnapshot });
  check('cold recovery (room not live) is still refused with no admin key', () => {
    assert.ok(coldNoKey.error, 'a cold room was restored with no admin key at all');
  });
  const coldWrongKey = await post2('/api/host/import', { snapshot: coldSnapshot, key: 'not-the-real-admin-key' });
  check('cold recovery is refused with a wrong admin key', () => {
    assert.ok(coldWrongKey.error, 'a cold room was restored with the wrong admin key');
  });
  const coldRightKey = await post2('/api/host/import', { snapshot: coldSnapshot, key: KEY });
  check('cold recovery succeeds with the real admin key — the documented backup safety net actually works again', () => {
    assert.ok(!coldRightKey.error, 'restoring a cold (not-live) room with the correct admin key was refused: ' + coldRightKey.error);
  });
  const coldRoomView = await get2('/api/room?room=CLDR');
  check('the recovered room is reachable at its ORIGINAL room code', () => {
    assert.ok(!coldRoomView.error, 'the room restored by admin key is not reachable at the code the backup named');
  });
  const coldTeamState = await get2('/api/state?code=COLDLDR1');
  check('the recovered country is reachable at its ORIGINAL leader code, exactly as README.md promises', () => {
    assert.ok(coldTeamState.team, 'the country is not reachable at the leader code the backup carried');
    assert.strictEqual(coldTeamState.team.name, 'Coldstart', 'the recovered country is not the one the backup described');
  });

  /* admin/list's round-coercion belt (Number(r.round) || 0) still needs
     proving on its own, independently of C1's now-closed enabling hole — a
     hostile round can still reach a room through an AUTHORISED import (a
     teacher's own backup file, hand-edited or simply corrupted), so plant it
     that way instead: r3 (created above, still live) restores itself, under
     its own real hostKey, with a hostile round. */
  const r3Exp = await get2(`/api/host/export?room=${r3.room}&hostKey=${r3.hostKey}`);
  const r3Hostile = JSON.parse(JSON.stringify(r3Exp.snapshot));
  r3Hostile.round = '<img src=x onerror=fetch(1)>';
  const authedHostileImport = await post2('/api/host/import', { snapshot: r3Hostile });
  check('a teacher restoring their own live room is still allowed through — the authorised path this fix must not break', () => {
    assert.ok(!authedHostileImport.error, 'restoring a live room under its own real host key was refused: ' + authedHostileImport.error);
  });
  const listAfterAuthedImport = await post2('/api/admin/list', { key: KEY });
  check("admin/list coerces round to a number server-side, not merely relying on the page to escape whatever it is handed", () => {
    const row = listAfterAuthedImport.rooms.find(x => x.code === r3.room);
    assert.ok(row, 'the imported room is missing from the list');
    assert.strictEqual(typeof row.round, 'number', `round came back as ${typeof row.round}, not a number — a hostile import's round is reaching admin/list unmodified`);
    assert.strictEqual(row.round, 0, 'a non-numeric round did not coerce to 0');
  });

  /* I6, the wipe half: the disk-flush proof above only ever exercised
     admin/delete. admin/wipe calls persistNow() too (server.js's own comment
     on it says "for admin/delete and admin/wipe"), but nothing pinned that —
     removing the call from wipe specifically left the whole suite green.
     Same precondition discipline as the delete case: wait out a debounce
     period and confirm r2/r3 are actually on disk first, so the check right
     after the wipe cannot pass vacuously. */
  await new Promise(r => setTimeout(r, 1700));
  check('r2 and r3 are on disk before the wipe, so the disk check right after it means something', () => {
    const codes = roomsOnDisk().rooms.map(x => x.code);
    assert.ok(codes.includes(r2.room) && codes.includes(r3.room),
      'r2/r3 were never written to rooms.json before the wipe — the disk check after admin/wipe would prove nothing either way');
  });

  const halfWipe = await post2('/api/admin/wipe', { key: KEY });
  check('wiping everything needs the word DELETE', () => {
    assert.ok(halfWipe.error, 'everything was wiped without confirmation');
  });
  const wipe = await post2('/api/admin/wipe', { key: KEY, confirm:'DELETE' });
  const after = await post2('/api/admin/list', { key: KEY });
  check('a confirmed wipe clears every room', () => {
    assert.ok(!wipe.error, 'wipe failed: ' + wipe.error);
    assert.strictEqual(after.rooms.length, 0);
  });
  check('admin/wipe flushes to disk immediately too — persistNow(), not the 1.5s debounce', () => {
    assert.strictEqual(roomsOnDisk().rooms.length, 0,
      'rooms are still on disk immediately after admin/wipe returned — persistNow() was not called, or did not actually flush, from admin/wipe');
  });
  const deadR3 = await get2('/api/state?code=' + g3.roster[0].code);
  await new Promise(r => setTimeout(r, 150));
  check('a confirmed wipe purges CODES too, not just ROOMS — every dropRoom(...) call in the loop actually ran, not a decoy branch that only mentions dropRoom in source', () => {
    assert.ok(deadR3.error, "a wiped room's country code still resolves");
    assert.ok(!server2Stderr.includes('CODES pointed'),
      'querying a wiped room\'s leader code triggered findTeam\'s CODES self-heal warning — wipe left a stale CODES entry, meaning some or all of its dropRoom(...) calls never actually executed');
  });

  if (ran === 0) { console.error('FAIL  admin.test.js ran zero checks'); done(1); }
  if (fails) done(1);
  console.log('PASS  admin — fails closed, refuses a wrong key, purges codes, needs DELETE');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
