/* The Groups card folds so the leaderboard is not fifty rows below the fold on
   a projected console. Two things carry real risk and are pinned here.

   First, storage. No other page in this project touches localStorage, and it
   throws outright in some Safari privacy modes — an uncaught throw at page init
   would take the whole console down, which is exactly how the vote screen's
   identifier collision killed it. Both directions must swallow.

   Second, printing. The roster is what the slip printer prints: the sheets a
   class is handed on the day. A fold built on display:none alone would print a
   blank page, and nobody would find out until a teacher stood at a printer on
   the morning of the event. */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { loadFn } = require('./helpers');

const HOST = path.join(__dirname, '..', 'public', 'host.html');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* A localStorage that behaves, and one that does not. */
const goodStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const angryStore = () => ({
  getItem(){ throw new Error('The operation is insecure.'); },
  setItem(){ throw new Error('The operation is insecure.'); }
});

/* FOLDKEY is declared beside the two functions, not inside them, so it has to
   be handed in — loadFn pulls one function at a time. Its value is not what is
   under test; the read/write round trip is. */
const load = (store) => {
  const deps = { localStorage: store, FOLDKEY: 'r2126.rosterFolded' };
  return {
    read: loadFn('rosterFolded', deps, HOST),
    write: loadFn('setRosterFolded', deps, HOST)
  };
};

check('an unset key reads as not folded', () => {
  /* A console that has never been folded must open exactly as it does today. */
  const { read } = load(goodStore());
  assert.strictEqual(read(), false);
});

check('folded is written and read back', () => {
  const store = goodStore();
  const { read, write } = load(store);
  write(true);
  assert.strictEqual(read(), true);
  write(false);
  assert.strictEqual(read(), false);
});

check('reading survives a localStorage that throws', () => {
  const { read } = load(angryStore());
  assert.strictEqual(read(), false, 'a storage failure must degrade to not folded, not propagate');
});

check('writing survives a localStorage that throws', () => {
  const { write } = load(angryStore());
  assert.doesNotThrow(() => write(true),
    'a storage failure at page init would take the whole console down');
});

check('the print block puts the roster back', () => {
  /* The regression a runtime test cannot see: folded + print = blank slips. */
  const src = fs.readFileSync(HOST, 'utf8');
  const i = src.indexOf('@media print{');
  assert.ok(i > -1, 'the print block is gone');
  const block = src.slice(i, src.indexOf('\n}', i));
  assert.ok(/\.folded\s+#roster\s*\{[^}]*display:\s*block\s*!important/.test(block),
    'printing while folded would produce a blank roster — the slips a class is handed');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
