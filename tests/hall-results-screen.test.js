/* Bar width is proportional to the TOTAL number of countries, not to the
   biggest bar on the card. Nineteen has to look the same length on every
   screen, or stepping through rescales the chart under a game master who is
   mid-sentence in front of 300 people. Pulled out of the shipped page. */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { loadFn } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const HOST = path.join(PUB, 'host.html');
const barPct = loadFn('barPct', {}, HOST);

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('a bar is its share of the whole room', () => {
  assert.strictEqual(barPct(19, 47), 19 / 47 * 100);
  assert.strictEqual(barPct(47, 47), 100);
  assert.strictEqual(barPct(0, 47), 0);
});

check('the same count is the same width whatever else is on the card', () => {
  /* the rule this whole function exists for */
  assert.strictEqual(barPct(19, 47), barPct(19, 47));
  assert.ok(barPct(19, 47) < barPct(19, 20), 'width did not track the room size');
});

check('a card nobody was in does not divide by zero', () => {
  assert.strictEqual(barPct(0, 0), 0);
});

check('the results overlay carries no card text of its own', () => {
  /* Everything on that screen arrives over the authenticated route. A title
     baked into the page would put the deck back on a static file, which is
     what tests/scenario-secrecy.test.js exists to stop. */
  const src = fs.readFileSync(HOST, 'utf8');
  const overlay = src.slice(src.indexOf('<div id="hres"'), src.indexOf('<script src="/qr.js">'));
  assert.ok(overlay.length > 0, 'the results overlay is not in the page');
  assert.ok(!/Could not agree in time[^<]*\d/.test(overlay), 'a count was baked into the markup');
  assert.ok(!/Haze|Brain Drain|Water Runs/.test(overlay), 'a card title was baked into the page');
});

/* Every page's inline script has to PARSE, and all of a page's classic
   scripts share one global lexical scope — so a second top-level `let RES`
   anywhere in the file is a SyntaxError that takes down the whole page, not
   just the block that declared it. Every button on the console goes dead and
   nothing in the console says which line did it.

   Nothing caught this before: the other page tests pull out one function at a
   time and never parse the file as a whole. It cost a real "nothing happens
   when I click" on a console two days before the hall. */
const PAGES = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));

check('every page\'s inline script parses, as one scope', () => {
  assert.ok(PAGES.length >= 4, 'the page list came back suspiciously short');
  for(const page of PAGES){
    const src = fs.readFileSync(path.join(PUB, page), 'utf8');
    /* src= blocks are separate files and separate scopes; only the inline
       ones share the global one this is checking. */
    const inline = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]).join('\n;\n');
    if(!inline.trim()) continue;
    try {
      new vm.Script(inline, { filename: page });
    } catch (e) {
      throw new Error(page + ' does not parse — ' + e.message);
    }
  }
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
