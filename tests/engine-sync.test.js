/* Guard against divergence between game_engine.js (server copy) and the two
   inlined copies in public/index.html and public/host.html. With no build
   step, changes to one copy that miss another become silent, user-visible
   bugs — a country's flag renders differently on the student app than on
   the shared leaderboard, or a locked industry gives a different reason on
   the host console. A field-by-field test only catches the fields it was
   told to check; a whole-block byte comparison catches everything. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The engine block starts at this comment and ends at the closing brace of
// the `const ENGINE = {...}` export table — present, verbatim, in all three
// files. Extracting between fixed markers means the test does not care
// where the block sits inside a bigger file.
const START = `/* ============================================================
   REPUBLIC 2126 — shared game engine
   Used by: student app, host console, and the Railway server.
   Zero dependencies. Deterministic.
   ============================================================ */`;
// Matched as a pattern rather than a hardcoded list: the export table grows
// whenever the engine gains a function, and a literal copy of it here would
// turn "someone added an export" into a confusing "block not found" error
// instead of the drift report this test exists to give.
const END_RE = /const ENGINE = \{[\s\S]*?\n\};/;

function extractEngineBlock(file) {
  const src = fs.readFileSync(file, 'utf8');
  const startIdx = src.indexOf(START);
  if (startIdx === -1) throw new Error(`${file}: could not find the engine block's start comment`);
  const tail = src.slice(startIdx);
  const m = END_RE.exec(tail);
  if (!m) throw new Error(`${file}: could not find the engine block's ENGINE const export`);
  const END = m[0];
  const endIdx = startIdx + m.index;
  // normalise only leading/trailing whitespace around the block, as instructed —
  // everything inside must match byte-for-byte
  return src.slice(startIdx, endIdx + END.length).trim();
}

function firstDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return { line: i + 1, master: la[i], other: lb[i] };
    }
  }
  return null;
}

// game_engine.js appends `module.exports` for Node, but the extracted block
// stops at the ENGINE export table, so that line is never included and needs
// no stripping here.
const masterFile = path.join(ROOT, 'game_engine.js');
const master = extractEngineBlock(masterFile);

const copies = [
  { label: 'public/index.html', file: path.join(ROOT, 'public', 'index.html') },
  { label: 'public/host.html',  file: path.join(ROOT, 'public', 'host.html') }
];

let fails = 0;
for (const { label, file } of copies) {
  const block = extractEngineBlock(file);
  if (block === master) {
    console.log(`PASS  engine sync — ${label} matches game_engine.js byte-for-byte`);
    continue;
  }
  const diff = firstDiff(master, block);
  console.error(`FAIL  engine sync — ${label} has diverged from game_engine.js`);
  if (diff) {
    console.error(`      first differing line ${diff.line}:`);
    console.error(`      game_engine.js : ${JSON.stringify(diff.master)}`);
    console.error(`      ${label} : ${JSON.stringify(diff.other)}`);
  }
  fails++;
}

if (fails) {
  assert.fail(`${fails} engine cop${fails === 1 ? 'y has' : 'ies have'} diverged from game_engine.js — see above`);
}

console.log('PASS  engine sync — game_engine.js, public/index.html and public/host.html are byte-identical');

/* city.js is duplicated the same way, and the same drift is possible — worse,
   because city.js is not served to anyone: only the copy inlined in
   public/index.html actually runs, so a change made to the master alone has
   no effect at all and nothing said so. That is exactly what happened when
   the Build step was first wired into the island. */
const CITY_START = `/* ===========================================================================
   city.js — the miniature isometric city for Republic 2126.`;
const CITY_END_RE = /global\.CityView = CityView;/;

function extractCityBlock(file) {
  const src = fs.readFileSync(file, 'utf8');
  const startIdx = src.indexOf(CITY_START);
  if (startIdx === -1) throw new Error(`${file}: could not find the city block's start comment`);
  const m = CITY_END_RE.exec(src.slice(startIdx));
  if (!m) throw new Error(`${file}: could not find the city block's CityView export`);
  return src.slice(startIdx, startIdx + m.index + m[0].length).trim();
}

/* Two copies now: the student app and the projector. A city block that drifts
   between them is worse than one that drifts from the master, because the two
   screens in the same hall would disagree about what a country looks like. */
const cityMaster = extractCityBlock(path.join(ROOT, 'city.js'));
const cityCopies = ['public/index.html', 'public/screen.html'];
let cityFails = 0;
for (const rel of cityCopies) {
  const inline = extractCityBlock(path.join(ROOT, rel));
  if (inline === cityMaster) {
    console.log(`PASS  city sync — ${rel} matches city.js byte-for-byte`);
    continue;
  }
  const d = firstDiff(cityMaster, inline);
  console.error(`FAIL  city sync — ${rel} has diverged from city.js`);
  if (d) {
    console.error(`      first differing line ${d.line}:`);
    console.error(`      city.js  : ${JSON.stringify(d.master)}`);
    console.error(`      ${rel} : ${JSON.stringify(d.other)}`);
  }
  cityFails++;
}
if (cityFails) assert.fail('an inlined city renderer has diverged from city.js — run node tools/sync-engine.js');
console.log('PASS  city sync — city.js and both inlined copies are byte-identical');
