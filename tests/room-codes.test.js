/* Two rooms must never answer to the same code — a group typing a code has to
   reach their own country's room and nobody else's.

   Two mechanisms make that true, and neither can be pinned from outside the
   process. ROOMS is a Map keyed by code, so a duplicate would overwrite rather
   than coexist; and newRoom() redraws while ROOMS already holds the code. A
   natural collision is 1 in 32^4 — 1,048,576 — so proving the redraw actually
   fires means forcing one, which means driving Math.random. That is the reason
   server.js carries a require.main guard: see the comment at its foot.

   The third check is the one that will matter later. Room codes and country
   credentials are drawn from the same alphabet by two functions that do not
   consult each other — newRoom() checks ROOMS alone, freeCode()/freePid() check
   CODES and PIDS alone. The ONLY thing keeping a room code from equalling a live
   leader code is that rooms draw 4 characters and countries draw 5. Nothing
   states that dependency, so "4 feels collision-prone, make it 5" is a change
   somebody could reasonably make. It would silently put a room code and a
   group's credential in one namespace. This pins the lengths so that change
   breaks a test instead of an event. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* Set before require: server.js reads DATA_DIR at module scope, and nothing
   here should touch a real one. */
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-roomcodes-'));
process.env.DATA_DIR = DATA_DIR;
const S = require(path.join(ROOT, 'server.js'));

let fails = 0;
/* Deliberately synchronous. An async callback returns a promise nobody awaits,
   so its assertions could never fail. Do not write one. */
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const real = Math.random;
let queue = [];
Math.random = () => (queue.length ? queue.shift() : real());
/* makeCode picks A[floor(rand()*A.length)], so feeding index/length spells a
   chosen code one character at a time. */
const spell = s => [...s].map(ch => {
  const i = A.indexOf(ch);
  assert.notStrictEqual(i, -1, `"${ch}" is not in the code alphabet`);
  return i / A.length;
});

check('a forced room-code collision is redrawn, not accepted', () => {
  queue = spell('AAAA');
  const r1 = S.newRoom('class', 'first', 'admin');
  assert.strictEqual(r1.code, 'AAAA',
    'the Math.random stub is not reaching makeCode — the rest of this file proves nothing');

  queue = [...spell('AAAA'), ...spell('BBBB')];   // draws the taken code, then a free one
  const r2 = S.newRoom('class', 'second', 'admin');

  assert.notStrictEqual(r2.code, r1.code, 'two live rooms were handed the same code');
  assert.strictEqual(r2.code, 'BBBB', 'the redraw did not take the next free code');
});

check('the room a code resolves to is the room that minted it', () => {
  assert.strictEqual(S.getRoom('AAAA').label, 'first');
  assert.strictEqual(S.getRoom('BBBB').label, 'second');
  assert.strictEqual(S.ROOMS.size, 2, 'a redrawn room did not replace the one it collided with');
});

check('every room is keyed in ROOMS by its own code', () => {
  for (const [k, r] of S.ROOMS) {
    assert.strictEqual(k, r.code, `room keyed "${k}" believes its code is "${r.code}"`);
  }
});

check('a room code cannot equal a country code or a pid, because the lengths differ', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/do \{ c = code\(4\); \} while\(ROOMS\.has\(c\)\)/.test(src),
    'room codes are no longer drawn at 4 chars against ROOMS');
  assert.ok(/function freePid\(\)\{ let c; do \{ c = code\(5\); \}/.test(src),
    'pids are no longer 5 chars — a pid could now equal a room code');
  const lens = [...src.matchAll(/freeCode\((\d+)\)/g)].map(m => m[1]);
  assert.ok(lens.length, 'no freeCode() call sites found — this check has stopped checking');
  for (const n of lens) {
    assert.strictEqual(n, '5',
      `a country code is drawn at ${n} chars; at 4 it shares a namespace with room codes, ` +
      'which newRoom() and freeCode() do not check against each other');
  }
});

/* ---------------- one process per volume ----------------
   The uniqueness above holds inside one process. A second process against the
   same volume draws from its own empty ROOMS, and persist() writes its whole
   room list over the other's rather than merging — so the guard exists to make
   that state audible at boot. */

check('a fresh data directory is claimed without complaint', () => {
  try { fs.unlinkSync(S.BEAT_FILE); } catch (e) {}
  const r = S.claimInstance();
  assert.strictEqual(r.warned, false, 'an empty directory reported a live instance');
  assert.ok(fs.existsSync(S.BEAT_FILE), 'claiming did not leave a heartbeat behind');
});

check('a second live instance on the same directory is caught', () => {
  fs.writeFileSync(S.BEAT_FILE, JSON.stringify({ pid: process.pid + 1, beat: Date.now() }));
  /* The banner is the point of the feature, but printed here it reads as a
     failure in a CI log. Swallow it and assert on the return value instead. */
  const err = console.error; console.error = () => {};
  let r; try { r = S.claimInstance(); } finally { console.error = err; }
  assert.strictEqual(r.warned, true,
    'a second server sharing this volume was not reported — rooms would be lost silently');
  assert.strictEqual(r.held.pid, process.pid + 1, 'the warning did not identify the other process');
});

check('a heartbeat old enough to be dead is treated as stale, not as a live instance', () => {
  const old = Date.now() - (S.BEAT_STALE + 1000);
  fs.writeFileSync(S.BEAT_FILE, JSON.stringify({ pid: process.pid + 1, beat: old }));
  const r = S.claimInstance();
  assert.strictEqual(r.warned, false,
    'a crashed instance\'s leftover file would block every future boot with a false alarm');
  assert.strictEqual(r.stale, true);
});

check('an unreadable heartbeat never stops the server booting', () => {
  fs.writeFileSync(S.BEAT_FILE, 'not json at all');
  const r = S.claimInstance();
  assert.strictEqual(r.warned, false, 'a corrupt heartbeat was read as a live instance');
});

check('releasing only removes a heartbeat this process owns', () => {
  fs.writeFileSync(S.BEAT_FILE, JSON.stringify({ pid: process.pid + 1, beat: Date.now() }));
  S.releaseInstance();
  assert.ok(fs.existsSync(S.BEAT_FILE),
    'shutting down deleted another live process\'s heartbeat, blinding it to a third');
  S.writeInstance();
  S.releaseInstance();
  assert.ok(!fs.existsSync(S.BEAT_FILE), 'a clean shutdown left its own heartbeat behind');
});

Math.random = real;
fs.rmSync(DATA_DIR, { recursive: true, force: true });
if (fails) process.exit(1);
console.log('PASS  room codes — unique per process, and a second process says so out loud');
