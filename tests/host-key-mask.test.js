/* The console is projected in front of the whole cohort, and it shows the room
   code in huge type because students need it. It also used to show the HOST KEY
   in a pill beside it — and that key gates seven routes, one of which is
   act:'reset', which calls dropRoom() and ends the hall. Both halves of the
   credential, on the wall, for the length of the event, in front of 300
   teenagers with phone cameras.

   Masked now, revealed for fifteen seconds at a time. The auto-hide is the
   feature: a game master who reveals the key and is then pulled into a rescue
   is the realistic failure, so leaving it up has to be impossible rather than
   merely discouraged.

   Nothing here changes what the key DOES. It is still recoverable from /admin
   and still printed on the teacher briefing sheets — this is only about what is
   readable off a projector. */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { loadFn } = require('./helpers');

const HOST = path.join(__dirname, '..', 'public', 'host.html');
/* KEYFOR is declared beside the function, not inside it, so loadFn — which
   pulls one function at a time — has to be handed it. 15 seconds is the window
   the reveal was designed around and the bound a backwards clock jump is
   clamped to, so the tests use the real value. */
const hostKeyLeft = loadFn('hostKeyLeft', { KEYFOR: 15000 }, HOST);

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('nothing revealed means nothing on screen', () => {
  /* The state a console boots into, and returns to. Never remembered across a
     reload, unlike the room itself. */
  assert.strictEqual(hostKeyLeft(1000, 0), 0);
  assert.strictEqual(hostKeyLeft(1000, null), 0);
  assert.strictEqual(hostKeyLeft(1000, undefined), 0);
});

check('a live reveal counts down in whole seconds', () => {
  assert.strictEqual(hostKeyLeft(0, 15000), 15);
  assert.strictEqual(hostKeyLeft(2000, 15000), 13);
  assert.strictEqual(hostKeyLeft(14600, 15000), 1, 'the last fraction of a second still reads 1, not 0');
});

check('an expired reveal is masked again', () => {
  assert.strictEqual(hostKeyLeft(15000, 15000), 0);
  assert.strictEqual(hostKeyLeft(99000, 15000), 0, 'a console left alone must not sit revealed');
});

check('a clock that jumps backwards does not strand the key on screen', () => {
  /* A laptop waking from sleep can resync its clock. The reveal must never
     outlive its window because time moved oddly — the far side of the
     comparison is the only one that matters, and it is bounded. */
  assert.ok(hostKeyLeft(-60000, 15000) <= 15,
    'a backwards clock jump extended the reveal past its window');
});

check('the host key is no longer inside the polled pills', () => {
  /* The regression that would silently put it back: #hostPills is rebuilt by
     the poll every 2.2 seconds, so anything in that template is on the wall
     permanently and no reveal state can survive there. */
  const src = fs.readFileSync(HOST, 'utf8');
  const i = src.indexOf("$('hostPills').innerHTML");
  assert.ok(i > -1, 'the pills template is gone — this test needs rewriting');
  const rest = src.slice(i);
  const tpl = rest.slice(0, rest.indexOf('`;') + 2);
  assert.ok(!/R\.key/.test(tpl),
    'the host key is back in the polled pill template, where it cannot be masked');
});

check('no template writes the raw key without a mask beside it', () => {
  /* go() also used to paint the key straight into the pills on the way in. */
  const src = fs.readFileSync(HOST, 'utf8');
  const bad = src.split('\n').filter(l =>
    /host key <b>\$\{R\.key\}/.test(l));
  assert.deepStrictEqual(bad, [],
    'a line still paints the host key onto the console unmasked');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
