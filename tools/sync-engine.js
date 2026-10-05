/* game_engine.js and city.js are each duplicated verbatim inside the HTML
   pages, and there is no build step, so the copies are kept in sync by hand.
   Doing that by hand is how they drifted before — twice. This copies each
   master block into every page that carries it; tests/engine-sync.test.js
   still verifies the result.

   city.js is not served to anyone: only the inlined copies in
   public/index.html and public/screen.html run. It is kept as the master
   because editing 60kB of renderer inside an HTML file is how the drift
   starts — and with two copies rather than one, by hand is no longer an
   option at all. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const BLOCKS = [
  {
    name: 'engine',
    master: 'game_engine.js',
    into: ['public/index.html', 'public/host.html'],
    start: `/* ============================================================
   REPUBLIC 2126 — shared game engine
   Used by: student app, host console, and the Railway server.
   Zero dependencies. Deterministic.
   ============================================================ */`,
    end: /const ENGINE = \{[\s\S]*?\n\};/
  },
  {
    name: 'city',
    master: 'city.js',
    into: ['public/index.html', 'public/screen.html'],
    start: `/* ===========================================================================
   city.js — the miniature isometric city for Republic 2126.`,
    end: /global\.CityView = CityView;/
  }
];

function locate(src, block, file) {
  const start = src.indexOf(block.start);
  if (start === -1) throw new Error(`${file}: ${block.name} block start comment not found`);
  const m = block.end.exec(src.slice(start));
  if (!m) throw new Error(`${file}: ${block.name} block end not found`);
  return { start, end: start + m.index + m[0].length };
}

for (const block of BLOCKS) {
  const masterSrc = fs.readFileSync(path.join(ROOT, block.master), 'utf8');
  const mloc = locate(masterSrc, block, block.master);
  const master = masterSrc.slice(mloc.start, mloc.end);

  for (const rel of block.into) {
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    const loc = locate(src, block, rel);
    if (src.slice(loc.start, loc.end) === master) { console.log(`${rel}: ${block.name} already in sync`); continue; }
    fs.writeFileSync(file, src.slice(0, loc.start) + master + src.slice(loc.end));
    console.log(`${rel}: ${block.name} block updated`);
  }
}
