/* goStep lets a group tap any step pill. Backward is free; forward must run
   exactly the checks Next runs, so nothing can be skipped — and tapping the
   last pill must navigate there, not press "We are ready". */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFn, APP } = require('./helpers');
const E = require('../game_engine.js');

/* The step count is read out of the page rather than written down here. A
   hard-coded 7 kept passing after the Build step was inserted, which meant
   "tapping the last pill" stopped testing the last pill. */
const STEP_COUNT = (function(){
  const m = /^const STEPS = \[([\s\S]*?)\n\];/m.exec(fs.readFileSync(APP, 'utf8'));
  if (!m) throw new Error('could not find const STEPS in public/index.html');
  return (m[1].match(/\{\s*t:/g) || []).length;
})();
const LAST = STEP_COUNT - 1;

/* goStep and validate both close over `ST`, so they have to be evaluated
   together in one scope that owns it. */
function harness(startST, country) {
  const src = extractFn('validate') + '\n' + extractFn('goStep');
  const calls = { save: 0, paint: 0, ready: 0, toast: 0 };
  const api = new Function('C', 'STEPS', 'ENGINE', 'GAME', 'toast', 'save', 'paintStep', 'goReady', 'startST', 'calls', `
    let ST = startST;
    ${src}
    return { goStep, calls, get ST(){ return ST; } };
  `)(
    country,
    new Array(STEP_COUNT).fill({ t: 'x', ic: 'x' }),
    E, E.GAME,
    // counting this stub (rather than a silent no-op) is what lets the
    // backward-jump test below actually catch a regression where validate()
    // is called — and its failure ignored — on the backward path
    () => { calls.toast++; },
    () => { calls.save++; },
    () => { calls.paint++; },
    () => { calls.ready++; },
    startST, calls
  );
  return api;
}

const blank = () => { const c = E.blankCountry(); c.name = ''; return c; };
const filled = () => {
  const c = E.blankCountry();
  c.name = 'Republic of Sentosa';
  c.members.leader = 'Joe';
  return c;
};

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

check('backward jump is free and needs no validation', () => {
  // blank() has no Leader named, so validate() fails at ST=1; backward must skip validation.
  // If a regression called validate() on this path but ignored its result, ST would still
  // land on 0 — only the toast count below would catch the spurious "name your Leader" toast.
  const a = harness(1, blank());
  a.goStep(0);
  assert.strictEqual(a.ST, 0, 'backward jump must not be blocked by validation');
  assert.strictEqual(a.calls.toast, 0, 'backward jump must not trigger a validation toast');
});

check('forward jump stops at the first incomplete step', () => {
  // no Leader named, so validate() blocks leaving step 1
  const a = harness(0, blank());
  a.goStep(5);
  assert.strictEqual(a.ST, 1, 'should have stopped on Roles, landed on ' + a.ST);
});

check('forward jump proceeds when the steps validate', () => {
  const a = harness(0, filled());
  a.goStep(3);
  assert.strictEqual(a.ST, 3);
});

check('tapping the last pill navigates but never readies', () => {
  // forward-jump onto the last pill; filled() passes validation on the step
  // before it, so the loop runs once and lands on Launch
  const a = harness(LAST - 1, filled());
  a.goStep(LAST);
  assert.strictEqual(a.ST, LAST, 'should navigate to Launch');
  assert.strictEqual(a.calls.ready, 0, 'goStep must not call goReady()');
});

check('tapping the current step does nothing', () => {
  const a = harness(2, filled());
  const before = a.calls.paint;
  a.goStep(2);
  assert.strictEqual(a.calls.paint, before, 'should not repaint');
});

/* The Build step must never trap a group. A country that staffed more workers
   than it houses can only fix that on the Industry step — by closing a site —
   so if Build refuses to let go, every pill refuses and there is no way out.
   This happened: the guard was written when step 5 was Industry, and inserting
   Build at 5 silently moved it onto a step that cannot fix what it checks. */
check('a worker deficit does not trap a group on the Build step', () => {
  const c = filled();
  c.homeland = 'delta';          // W8, M3, F11 — cannot afford to rebuild a home
  c.buildings = { home: 1 };     // houses 6
  c.industries = { farm: 4 };    // needs 8 workers — a deficit of 2
  assert.ok(E.free(c).W < 0, 'test setup no longer over-commits workers');
  assert.ok(E.free(c).M >= 0 && E.free(c).F >= 0, 'test setup should be short of workers, not materials');

  const a = harness(5, c);
  a.goStep(6);
  assert.strictEqual(a.ST, 6, 'Build refused to let a worker-short group reach the step that could fix it');
});

check('the Industry step still refuses a worker deficit', () => {
  const c = filled();
  c.homeland = 'delta';
  c.buildings = { home: 1 };
  c.industries = { farm: 4 };
  const a = harness(6, c);
  a.goStep(7);
  assert.strictEqual(a.ST, 6, 'Industry let a group leave with more workers staffed than housed');
  assert.ok(a.calls.toast > 0, 'no toast explained why');
});

check('goStep clamps an out-of-range argument instead of wandering off the pill bar', () => {
  // goStep is a global reachable from inline handlers, not just the pill bar,
  // so an out-of-range n (99) must clamp to the last step like step() does,
  // rather than looping past STEPS.length and crashing on $('p99')
  const a = harness(LAST - 1, filled());
  assert.doesNotThrow(() => a.goStep(99), 'goStep(99) must not throw');
  assert.strictEqual(a.ST, LAST, 'goStep(99) should clamp to the last step');
});

if (fails) process.exit(1);
console.log('PASS  goStep — all navigation rules hold');
