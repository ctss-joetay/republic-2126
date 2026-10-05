/* public/qr.js is a hand-written QR encoder. The two fixtures it is checked
   against were produced by an independent implementation (the `qrcode` npm
   package) BEFORE this encoder existed, and committed first. That ordering
   is the only thing that makes them evidence: a fixture generated from our
   own output would agree with any bug we happened to ship.

   A QR built with a valid-but-suboptimal mask still scans. So a mask
   mismatch here is not automatically a scanning failure — but it does mean
   our penalty scoring disagrees with a reference implementation, which is
   worth understanding rather than re-baselining away. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PLAY   = 'https://ct-negame.up.railway.app/play';
const SLIDES = 'https://ct-negame.up.railway.app/slides?track=s';

function loadQR() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'qr.js'), 'utf8'), sandbox);
  if (!sandbox.window.QR) throw new Error('public/qr.js did not attach QR to window');
  return sandbox.window.QR;
}

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
           .trim().split('\n').map(r => r.trim());
}

const asRows = m => m.map(row => row.map(v => (v ? '1' : '0')).join(''));

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

const QR = loadQR();

check('the play URL encodes to the exact matrix an independent generator produces', () => {
  const want = fixture('qr-play.txt');
  const got = asRows(QR.matrix(PLAY));
  assert.strictEqual(got.length, want.length, 'wrong module count');
  for (let i = 0; i < want.length; i++) {
    assert.strictEqual(got[i], want[i], 'row ' + i + ' differs\n  want ' + want[i] + '\n  got  ' + got[i]);
  }
});

check('the slides URL encodes to the exact matrix an independent generator produces', () => {
  const want = fixture('qr-slides.txt');
  const got = asRows(QR.matrix(SLIDES));
  assert.strictEqual(got.length, want.length, 'wrong module count');
  for (let i = 0; i < want.length; i++) {
    assert.strictEqual(got[i], want[i], 'row ' + i + ' differs\n  want ' + want[i] + '\n  got  ' + got[i]);
  }
});

/* Version selection is pinned separately from the matrix. A denser-than-needed
   code still decodes, so a bug that always picked version 6 would sail past a
   "does it scan" check while making every projected QR harder to read at the
   back of a hall. */
check('the 37-character play URL picks version 3, not something larger', () => {
  assert.strictEqual(QR.version(PLAY), 3);
});

check('the 47-character slides URL picks version 4', () => {
  assert.strictEqual(QR.version(SLIDES), 4);
});

check('106 characters is the last length that fits, and 107 is refused', () => {
  assert.strictEqual(QR.version('a'.repeat(106)), 6);
  assert.strictEqual(QR.version('a'.repeat(107)), 0);
  assert.strictEqual(QR.matrix('a'.repeat(107)), null);
  assert.strictEqual(QR.svg('a'.repeat(107)), null);
});

check('svg() draws dark modules on an explicitly white ground', () => {
  const s = QR.svg(PLAY, { size: 180 });
  assert.ok(/<rect[^>]*fill="#fff"/.test(s), 'no white background rect — a QR on the dark slide would invert');
  assert.ok(/<path[^>]*fill="#000"/.test(s), 'no dark module path');
  assert.ok(s.indexOf('width="180"') !== -1, 'opts.size was ignored');
});

check('the quiet zone is present, and is the 4 modules scanners expect', () => {
  const n = QR.matrix(PLAY).length;
  assert.ok(QR.svg(PLAY).indexOf('viewBox="0 0 ' + (n + 8) + ' ' + (n + 8) + '"') !== -1,
            'viewBox does not leave 4 modules of margin on each side');
});

/* These three pin the wiring, not the encoder. They are deliberately checked
   against ids the page JS looks up by name — see Tasks 3 and 4. */
check('slides.html loads qr.js and has both QR containers', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'slides.html'), 'utf8');
  assert.ok(src.indexOf('src="/qr.js"') !== -1, 'slides.html does not load /qr.js');
  assert.ok(src.indexOf('id="playQr"') !== -1, 'no playQr container');
  assert.ok(src.indexOf('id="playQr2"') !== -1, 'no playQr2 container');
  assert.ok(/QR\.render\(\s*document\.getElementById\('playQr'\)/.test(src), 'playQr is never rendered into');
  assert.ok(/QR\.render\(\s*document\.getElementById\('playQr2'\)/.test(src), 'playQr2 is never rendered into');
});

check('index.html loads qr.js and renders the slides QR', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(src.indexOf('src="/qr.js"') !== -1, 'index.html does not load /qr.js');
  assert.ok(src.indexOf('id="slidesQr"') !== -1, 'no slidesQr container');
  assert.ok(/QR\.render\(\s*document\.getElementById\('slidesQr'\)/.test(src), 'slidesQr is never rendered into');
});

/* QR.render() (public/qr.js) hides a failed render with el.hidden = true
   WITHOUT clearing innerHTML. That only works because [hidden]{display:none}
   is a UA default — any author display: on the container (.qr, which
   #playQr/#playQr2 use, or #slidesQr) overrides it and paints an empty white
   box on the dark slide/page instead of hiding. This has already happened
   once on this branch; these two checks are the guard against it recurring. */
check('slides.html: .qr (used by #playQr/#playQr2) sets no display: — an author display would defeat [hidden] and paint an empty white box on the dark slide', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'slides.html'), 'utf8');
  const m = /\.qr\{([^}]*)\}/.exec(src);
  assert.ok(m, '.qr rule not found in slides.html');
  assert.ok(!/display\s*:/.test(m[1]), '.qr sets a display: declaration — remove it, style layout on a wrapper instead');
});

check('index.html: #slidesQr sets no display: — an author display would defeat [hidden] and paint an empty white box', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const m = /#slidesQr\{([^}]*)\}/.exec(src);
  assert.ok(m, '#slidesQr rule not found in index.html');
  assert.ok(!/display\s*:/.test(m[1]), '#slidesQr sets a display: declaration — remove it, style layout on a wrapper instead');
});

if (fails) { console.error('\n' + fails + ' QR check(s) failed'); process.exit(1); }
console.log('PASS  qr — encoder matches an independent generator, and all three pages are wired');
