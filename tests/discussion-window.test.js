/* A card gets one minute of discussion before anyone can decide or trade. The
   arithmetic has one job beyond "now plus sixty": it must never outlast the
   card's own clock. A game master running a 45-second card with a 60-second
   lock would make deciding impossible and hand the whole hall an indecision
   penalty for something the server refused to let them do. */
const assert = require('assert');
const S = require('../server.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('no card clock means the full minute', () => {
  assert.strictEqual(S.discussionEnd(1000, null), 1000 + S.DISCUSS_MS);
  assert.strictEqual(S.discussionEnd(1000, 0), 1000 + S.DISCUSS_MS);
  assert.strictEqual(S.discussionEnd(1000, undefined), 1000 + S.DISCUSS_MS);
});

check('a generous card clock also means the full minute', () => {
  /* five minutes on the clock — the minute fits inside it with room to spare */
  assert.strictEqual(S.discussionEnd(0, 300000), S.DISCUSS_MS);
});

check('a short card clock leaves the floor to decide in', () => {
  /* 45 seconds on the clock: discussion must stop at 30s, leaving 15 to decide */
  const end = S.discussionEnd(0, 45000);
  assert.strictEqual(end, 45000 - S.DECIDE_FLOOR_MS);
  assert.ok(45000 - end >= S.DECIDE_FLOOR_MS, 'less than the floor was left to decide');
});

check('a clock shorter than the floor opens deciding immediately', () => {
  /* 10 seconds on the clock. There is no window that leaves 15 to decide, so
     the honest answer is no discussion window at all — never a negative one
     that somehow blocks. A timestamp in the past reads as elapsed. */
  assert.ok(S.discussionEnd(0, 10000) <= 0);
});

check('an already-expired clock opens deciding immediately', () => {
  assert.ok(S.discussionEnd(50000, 10000) <= 50000);
});

check('discussing() is true only before the stamp', () => {
  assert.strictEqual(S.discussing({ decideAt: 5000 }, 4999), true);
  assert.strictEqual(S.discussing({ decideAt: 5000 }, 5000), false);
  assert.strictEqual(S.discussing({ decideAt: 5000 }, 9999), false);
});

check('a room with no stamp is never discussing', () => {
  /* Rooms from before this existed, and every moment with no card open. */
  assert.strictEqual(S.discussing({}, 1000), false);
  assert.strictEqual(S.discussing({ decideAt: null }, 1000), false);
  assert.strictEqual(S.discussing({ decideAt: 0 }, 1000), false);
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
