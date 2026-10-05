/* Refreshing a phone used to drop a group back at the join screen. A student
   who scanned the QR on their slip was already fine — /play?code=ABCDE keeps
   the code in the URL and autoJoin() re-runs at boot — but a student who typed
   the code was not, and that is most of a hall.

   The two pages solve it differently ON PURPOSE, and that asymmetry is what
   these tests exist to hold:

   - The student app stamps the code into its own URL, landing a typed join in
     exactly the state a scanned join is already in. No new mechanism.
   - The console does NOT. A host key authorises remove, reopen and reset, the
     console is projected in front of the whole cohort, and URLs persist in
     browser history that syncs across devices. It goes to storage instead,
     where it is out of sight and can be deliberately cleared.

   Both directions of both mechanisms have to swallow their own failures. A
   page that dies at init is how the console broke once already. */
const assert = require('assert');
const path = require('path');
const { loadFn } = require('./helpers');

const APP  = path.join(__dirname, '..', 'public', 'index.html');
const HOST = path.join(__dirname, '..', 'public', 'host.html');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* --- the student app: the code goes in the URL ------------------------- */

const fakeHistory = () => {
  const calls = [];
  return { calls, replaceState: (a, b, url) => calls.push(url) };
};

check('a joined code is stamped into the URL', () => {
  const h = fakeHistory();
  const remember = loadFn('rememberCode', { history: h, location: { pathname: '/play' } }, APP);
  remember('ABCDE');
  assert.strictEqual(h.calls.length, 1, 'nothing was written to the URL');
  assert.strictEqual(h.calls[0], '/play?code=ABCDE',
    'a refresh has to land on the same URL a scanned slip produces');
});

check('the stamped URL is exactly what autoJoin already accepts', () => {
  /* The whole point: a typed join ends up in the state a QR join is in, so
     one boot path serves both and there is no second mechanism to keep true. */
  const h = fakeHistory();
  loadFn('rememberCode', { history: h, location: { pathname: '/play' } }, APP)('ABCDE');
  const autoJoin = loadFn('autoJoin', {}, APP);
  const search = h.calls[0].slice(h.calls[0].indexOf('?'));
  let filled = null, joined = false;
  assert.strictEqual(autoJoin(search, v => { filled = v; }, () => { joined = true; }), true);
  assert.strictEqual(filled, 'ABCDE');
  assert.strictEqual(joined, true);
});

check('practice mode is never stamped', () => {
  /* startSolo sets S.code to an em dash. Putting that in the URL would send a
     refresh into a join attempt for a country that does not exist. */
  const h = fakeHistory();
  const remember = loadFn('rememberCode', { history: h, location: { pathname: '/play' } }, APP);
  remember('—');
  remember('');
  remember(null);
  assert.strictEqual(h.calls.length, 0, 'something that is not a code reached the URL');
});

check('a browser without history does not break the join', () => {
  const remember = loadFn('rememberCode', { history: undefined, location: { pathname: '/play' } }, APP);
  assert.doesNotThrow(() => remember('ABCDE'),
    'a failed URL stamp must never cost a student the join that just succeeded');
});

/* --- the console: the key goes to storage, never the URL ---------------- */

const goodStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k) };
};
const angryStore = () => ({
  getItem(){ throw new Error('The operation is insecure.'); },
  setItem(){ throw new Error('The operation is insecure.'); },
  removeItem(){ throw new Error('The operation is insecure.'); }
});

const host = (store) => {
  const deps = { localStorage: store, HOSTKEY: 'r2126.host' };
  return {
    remember: loadFn('rememberHost', deps, HOST),
    forget:   loadFn('forgetHost', deps, HOST),
    stored:   loadFn('storedHost', deps, HOST)
  };
};

check('a room is remembered and comes back', () => {
  const h = host(goodStore());
  h.remember('YQWN', 'X8W4PQFW');
  assert.deepStrictEqual(h.stored(), { room:'YQWN', key:'X8W4PQFW' });
});

check('nothing stored reads as null', () => {
  assert.strictEqual(host(goodStore()).stored(), null,
    'a console that has never opened a room must start at the setup screen');
});

check('leaving forgets the key', () => {
  /* The console gets handed round. Without this the host key sits on that
     laptop indefinitely, and the next person to open /host lands in the hall
     room with the power to reset it. */
  const h = host(goodStore());
  h.remember('YQWN', 'X8W4PQFW');
  h.forget();
  assert.strictEqual(h.stored(), null, 'the host key survived leaving the room');
});

check('a corrupt stored value reads as null, not a crash', () => {
  const store = goodStore();
  store.setItem('r2126.host', 'not json{');
  const h = host(store);
  assert.strictEqual(h.stored(), null);
});

check('a half-written value reads as null', () => {
  /* Valid JSON, missing the key half — resuming with that would fire a roster
     call with an undefined credential and bounce the game master anyway. */
  const store = goodStore();
  store.setItem('r2126.host', JSON.stringify({ room:'YQWN' }));
  assert.strictEqual(host(store).stored(), null);
});

check('storage that throws costs the memory, not the console', () => {
  const h = host(angryStore());
  assert.doesNotThrow(() => h.remember('YQWN', 'X8W4PQFW'));
  assert.doesNotThrow(() => h.forget());
  assert.strictEqual(h.stored(), null);
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
