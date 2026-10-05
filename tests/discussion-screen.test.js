/* The countdown is drawn locally from decideAt and the clock skew the app
   already tracks, exactly as the card timer is — a countdown that jumps in
   poll-sized steps is worse than none.

   The interesting part is that it must NOT rebuild the choice panel every
   second. renderScenario deliberately skips redrawing when its signature is
   unchanged, so a poll arriving mid-tap cannot rebuild the cards under a
   student's finger. A per-second repaint would defeat that guard on every
   card, for the whole minute, while thirty fingers are on the screen. */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { loadFn } = require('./helpers');

const APP = path.join(__dirname, '..', 'public', 'index.html');
const discussLeft = loadFn('discussLeft', {}, APP);

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('no stamp means nothing to wait for', () => {
  assert.strictEqual(discussLeft(1000, 0), 0);
  assert.strictEqual(discussLeft(1000, null), 0);
  assert.strictEqual(discussLeft(1000, undefined), 0);
});

check('a live window counts down in whole seconds', () => {
  assert.strictEqual(discussLeft(0, 60000), 60);
  assert.strictEqual(discussLeft(13000, 60000), 47);
  assert.strictEqual(discussLeft(59400, 60000), 1, 'the last fraction still reads 1, not 0');
});

check('a passed window reads as open', () => {
  assert.strictEqual(discussLeft(60000, 60000), 0);
  assert.strictEqual(discussLeft(99000, 60000), 0);
});

check('a stamp already in the past reads as open', () => {
  /* What a short card clock produces — see discussionEnd() on the server. */
  assert.strictEqual(discussLeft(1000, -5000), 0);
});

check('the countdown does not live in the panel signature', () => {
  /* If seconds were part of the sig, renderScenario would rebuild the choice
     cards once a second for the whole minute, under thirty fingers. */
  const src = fs.readFileSync(APP, 'utf8');
  const i = src.indexOf('function renderScenario');
  const body = src.slice(i, src.indexOf('\n}', i));
  const sig = body.split('\n').filter(l => /const sig =/.test(l)).join('');
  assert.ok(sig, 'renderScenario lost its signature guard');
  assert.ok(!/discussLeft\(|decideAt/.test(sig),
    'the countdown was put in the panel signature — the cards will rebuild every second');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
