/* The emblem is positioned from a hand-tuned coordinate table. Every
   stripe/position combination must keep it inside the flag, or a group's
   emblem gets sliced off by the rounded corner.

   The disc that used to sit behind the emblem is gone, so the position is
   read off the glyph itself. The clearance asserted is still the old disc
   radius rather than the glyph's true half-height: FLAG_POS was tuned to that
   margin, it keeps the emblem well clear of the rounded corners, and relaxing
   it to the glyph box would let a future coordinate crowd the edge unnoticed. */
const assert = require('assert');
const { loadFn, loadConst } = require('./helpers');
/* flagBg and flagSVG call esc() and safeColour(), which live in the shared
   engine block rather than in the app's own script — so they are handed in
   from there rather than extracted out of the page. */
const E = require('../game_engine.js');

const STRIPES = ['solid', 'horiz', 'vert', 'diag'];
const POSITIONS = ['centre', 'left', 'right', 'tleft', 'tright'];
const W = 210, H = 132, R = 40;

// Load constants and functions from public/index.html
const FLAG_POS = loadConst('FLAG_POS');
const flagBg = loadFn('flagBg', { safeColour: E.safeColour });
const flagSVG = loadFn('flagSVG', { FLAG_POS, flagBg, esc: E.esc, safeColour: E.safeColour });

let checked = 0;
for (const stripe of STRIPES) {
  for (const empos of POSITIONS) {
    const svg = flagSVG({ col1: '#0f5c8c', col2: '#f4c542', emblem: '🦁', stripe, empos }, 210);

    const text = /<text x="([\d.]+)" y="([\d.]+)"/.exec(svg);
    assert.ok(text, `${stripe}/${empos}: no emblem glyph drawn`);
    const [cx, cy] = text.slice(1).map(Number);

    assert.ok(cx - R >= 0,  `${stripe}/${empos}: emblem off the left edge (cx=${cx})`);
    assert.ok(cx + R <= W,  `${stripe}/${empos}: emblem off the right edge (cx=${cx})`);
    assert.ok(cy - R >= 0,  `${stripe}/${empos}: emblem off the top edge (cy=${cy})`);
    assert.ok(cy + R <= H,  `${stripe}/${empos}: emblem off the bottom edge (cy=${cy})`);

    // the disc behind the emblem was removed on purpose — it must not come back
    assert.ok(!/<circle/.test(svg), `${stripe}/${empos}: the emblem disc is being drawn again`);
    checked++;
  }
}

// the removed decorative bars must not come back — they collide with `right`
assert.ok(!/x="112"/.test(flagSVG({ col1: '#000', col2: '#fff', emblem: '🦁' }, 210)),
  'decorative bars are still being drawn; they collide with the right-hand emblem positions');

// an old country saved before this feature must still render
const legacy = flagSVG({ col1: '#0f5c8c', col2: '#f4c542', emblem: '🦁' }, 210);
assert.ok(/<text x="56" y="66"/.test(legacy), 'a country with no stripe/empos must default to the old layout');

// a poisoned empos naming an Object.prototype member must not crash the
// shared leaderboard — see tests/flag-persistence.test.js for the server-side
// half of this fix. FLAG_POS[c.empos] on its own would throw for the first
// three; 'zzz' is ordinary garbage and must still fall back cleanly.
for (const poison of ['constructor', 'toString', '__proto__', 'zzz']) {
  assert.doesNotThrow(
    () => flagSVG({ col1: '#0f5c8c', col2: '#f4c542', emblem: '🦁', empos: poison, stripe: poison }, 210),
    `flagSVG threw for empos/stripe="${poison}"`
  );
}
console.log('PASS  flag geometry — flagSVG does not throw on prototype-polluting empos/stripe values');

console.log(`PASS  flag geometry — ${checked} combinations inside the viewBox`);
