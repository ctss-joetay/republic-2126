/* ============================================================
   REPUBLIC 2126 — minimal QR encoder
   Byte mode, error correction level M, versions 1-6 only.
   Zero dependencies. No build step. Deterministic.

   Versions stop at 6 on purpose: 6-M holds 106 characters
   (the longest URL here is 47), and everything above 6 drags in
   multiple alignment patterns and the version-information
   blocks. Capping the range removes both mechanisms entirely.
   In versions 1-6 every error-correction block is also the same
   size, so the interleaver needs no ragged-block handling.
   ============================================================ */
(function (root) {
'use strict';

/* ---- GF(256), primitive polynomial x^8+x^4+x^3+x^2+1 ---- */
var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  var x = 1, i;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

/* ---- version table, ECC level M ---- */
var VER = {
  1: { blocks: 1, data: 16, ecc: 10 },
  2: { blocks: 1, data: 28, ecc: 16 },
  3: { blocks: 1, data: 44, ecc: 26 },
  4: { blocks: 2, data: 32, ecc: 18 },
  5: { blocks: 2, data: 43, ecc: 24 },
  6: { blocks: 4, data: 27, ecc: 16 }
};
/* 12 bits of header (4 mode + 8 character count) cost two whole codewords
   once rounded, which is where the -2 comes from. */
function capacity(v) { return VER[v].blocks * VER[v].data - 2; }
function pickVersion(len) {
  for (var v = 1; v <= 6; v++) if (len <= capacity(v)) return v;
  return 0;
}

function utf8(s) {
  var out = [], i, c, cp;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      i++;
      cp = 0x10000 + ((c & 0x3ff) << 10) + (s.charCodeAt(i) & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return out;
}

function dataCodewords(bytes, version) {
  var t = VER[version], total = t.blocks * t.data, bits = [], i, j, b;
  function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
  put(4, 4);                 // byte mode
  put(bytes.length, 8);      // character count is 8 bits for versions 1-9
  for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
  for (i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);
  var cw = [];
  for (i = 0; i < bits.length; i += 8) { b = 0; for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
  var pad = [0xEC, 0x11], p = 0;
  while (cw.length < total) cw.push(pad[p++ & 1]);
  return cw;
}

function genPoly(n) {
  var g = [1], i, j, ng;
  for (i = 0; i < n; i++) {
    ng = new Array(g.length + 1);
    for (j = 0; j < ng.length; j++) ng[j] = 0;
    for (j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}

function rsEcc(block, eccLen) {
  var g = genPoly(eccLen), res = block.slice(), i, j, coef;
  for (i = 0; i < eccLen; i++) res.push(0);
  for (i = 0; i < block.length; i++) {
    coef = res[i];
    if (coef) for (j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], coef);
  }
  return res.slice(block.length);
}

function finalCodewords(bytes, version) {
  var t = VER[version], cw = dataCodewords(bytes, version), blocks = [], eccs = [], out = [], b, i;
  for (b = 0; b < t.blocks; b++) {
    var blk = cw.slice(b * t.data, (b + 1) * t.data);
    blocks.push(blk);
    eccs.push(rsEcc(blk, t.ecc));
  }
  for (i = 0; i < t.data; i++) for (b = 0; b < t.blocks; b++) out.push(blocks[b][i]);
  for (i = 0; i < t.ecc; i++)  for (b = 0; b < t.blocks; b++) out.push(eccs[b][i]);
  return out;
}

/* ---- matrix ---- */
function newMatrix(size) {
  var m = [], r, c, row;
  for (r = 0; r < size; r++) { row = []; for (c = 0; c < size; c++) row.push(null); m.push(row); }
  return m;
}

function finder(m, row, col) {
  var size = m.length, r, c, rr, cc;
  for (r = -1; r <= 7; r++) for (c = -1; c <= 7; c++) {
    rr = row + r; cc = col + c;
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
    m[rr][cc] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  }
}

/* Versions 2-6 have exactly one alignment pattern. The other three
   candidate positions from the coordinate table all collide with a finder
   and are excluded by the standard, so there is nothing to iterate. */
function alignment(m) {
  var ctr = m.length - 7, r, c;
  for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++)
    m[ctr + r][ctr + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
}

function timing(m) {
  var size = m.length, i, on;
  for (i = 8; i < size - 8; i++) {
    on = (i % 2) === 0;
    if (m[6][i] === null) m[6][i] = on;
    if (m[i][6] === null) m[i][6] = on;
  }
}

var FMT_G = 0x537;   // BCH(15,5) generator
function bitLength(n) { var c = 0; while (n !== 0) { c++; n >>>= 1; } return c; }
function formatBits(mask) {
  var data = (0 << 3) | mask;        // ECC level M is 0b00
  var d = data << 10;
  while (bitLength(d) >= bitLength(FMT_G)) d ^= FMT_G << (bitLength(d) - bitLength(FMT_G));
  return ((data << 10) | d) ^ 0x5412;
}

function typeInfo(m, mask) {
  var size = m.length, bits = formatBits(mask), i, on;
  for (i = 0; i < 15; i++) {
    on = ((bits >> i) & 1) === 1;
    if (i < 6) m[i][8] = on;
    else if (i < 8) m[i + 1][8] = on;
    else m[size - 15 + i][8] = on;

    if (i < 8) m[8][size - i - 1] = on;
    else if (i < 9) m[8][15 - i] = on;
    else m[8][14 - i] = on;
  }
  m[size - 8][8] = true;             // the always-dark module
}

function maskFn(k, i, j) {
  switch (k) {
    case 0: return ((i + j) % 2) === 0;
    case 1: return (i % 2) === 0;
    case 2: return (j % 3) === 0;
    case 3: return ((i + j) % 3) === 0;
    case 4: return ((Math.floor(i / 2) + Math.floor(j / 3)) % 2) === 0;
    case 5: return (((i * j) % 2) + ((i * j) % 3)) === 0;
    case 6: return ((((i * j) % 2) + ((i * j) % 3)) % 2) === 0;
    default: return ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0;
  }
}

function mapData(m, data, mask) {
  var size = m.length, inc = -1, row = size - 1, bit = 7, idx = 0, col, c, dark;
  for (col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                       // skip the vertical timing column
    for (;;) {
      for (c = 0; c < 2; c++) {
        if (m[row][col - c] === null) {
          dark = false;
          if (idx < data.length) dark = ((data[idx] >>> bit) & 1) === 1;
          if (maskFn(mask, row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          bit--;
          if (bit === -1) { idx++; bit = 7; }
        }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }
}

var PAT_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
var PAT_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

function penalty(m) {
  var size = m.length, p = 0, r, c, run, i, k, a, b, v, dark = 0;

  for (r = 0; r < size; r++) {                      // rule 1, rows
    run = 1;
    for (c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (c = 0; c < size; c++) {                      // rule 1, columns
    run = 1;
    for (r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) p += 3 + (run - 5);
  }

  for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {   // rule 2
    v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
  }

  for (r = 0; r < size; r++) for (i = 0; i + 11 <= size; i++) {     // rule 3, rows
    a = true; b = true;
    for (k = 0; k < 11; k++) {
      v = m[r][i + k] ? 1 : 0;
      if (v !== PAT_A[k]) a = false;
      if (v !== PAT_B[k]) b = false;
    }
    if (a || b) p += 40;
  }
  for (c = 0; c < size; c++) for (i = 0; i + 11 <= size; i++) {     // rule 3, columns
    a = true; b = true;
    for (k = 0; k < 11; k++) {
      v = m[i + k][c] ? 1 : 0;
      if (v !== PAT_A[k]) a = false;
      if (v !== PAT_B[k]) b = false;
    }
    if (a || b) p += 40;
  }

  for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;   // rule 4
  p += Math.floor(Math.abs((dark * 100 / (size * size)) - 50) / 5) * 10;

  return p;
}

function build(version, mask, cw) {
  var size = version * 4 + 17, m = newMatrix(size);
  finder(m, 0, 0);
  finder(m, size - 7, 0);
  finder(m, 0, size - 7);
  if (version > 1) alignment(m);
  timing(m);
  typeInfo(m, mask);          // must precede mapData: mapData only fills nulls
  mapData(m, cw, mask);
  return m;
}

function matrix(text) {
  var bytes = utf8(String(text)), v = pickVersion(bytes.length);
  if (!v) return null;
  var cw = finalCodewords(bytes, v), best = null, bestScore = Infinity, k, m, s;
  for (k = 0; k < 8; k++) {
    m = build(v, k, cw);
    s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svg(text, opts) {
  opts = opts || {};
  var m = matrix(text);
  if (!m) return null;
  var n = m.length,
      q = (opts.quiet == null) ? 4 : opts.quiet,
      total = n + 2 * q,
      px = opts.size || n * 4,
      d = '', r, c;
  for (r = 0; r < n; r++) for (c = 0; c < n; c++)
    if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '"' +
         ' width="' + px + '" height="' + px + '" shape-rendering="crispEdges"' +
         ' role="img" aria-label="' + esc(opts.label || text) + '">' +
         '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
         '<path d="' + d + '" fill="#000"/></svg>';
}

/* Hides the container rather than showing a broken code. The URL is always
   printed beside it, so a missing QR costs a few seconds of typing; a
   malformed one costs a scan that never resolves. */
function render(el, text, opts) {
  if (!el) return false;
  var s = svg(text, opts);
  if (!s) { el.hidden = true; return false; }
  el.innerHTML = s;
  el.hidden = false;
  return true;
}

root.QR = { matrix: matrix, version: function (t) { return pickVersion(utf8(String(t)).length); },
            svg: svg, render: render };

})(typeof window !== 'undefined' ? window : globalThis);
