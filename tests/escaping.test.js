/* A country's name, motto, emblem and colours are typed by a group of
   14-year-olds and rendered on every device in the room, including the
   teacher's console. Without escaping, a group holding only its own five-letter
   code can run script on the projector — proven end to end during review.

   These tests pin both halves of the fix: escaping on output, and rejecting
   junk colours on input. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadFn, makeDone, openClassRoom } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
let fails = 0, ran = 0;
const check = (label, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

/* ---------- 1. the engine's own helpers ---------- */

check('esc() neutralises the characters that break out of markup', () => {
  const out = E.esc(`<img src=x onerror="alert(1)">&'`);
  assert.ok(!out.includes('<'), 'still contains <');
  assert.ok(!out.includes('>'), 'still contains >');
  assert.ok(!out.includes('"'), 'still contains a double quote — this is what escapes a fill="…" attribute');
  assert.ok(!out.includes("'"), 'still contains a single quote');
  assert.ok(out.includes('&amp;'), 'ampersand not escaped');
});

check('safeColour() passes #rrggbb and replaces anything else', () => {
  assert.strictEqual(E.safeColour('#0f5c8c', '#000'), '#0f5c8c');
  assert.strictEqual(E.safeColour('#ABCDEF', '#000'), '#ABCDEF');
  // the exact payload proven in review to break out of fill="…"
  assert.strictEqual(E.safeColour('#fff" onload="alert(1)', '#000'), '#000');
  assert.strictEqual(E.safeColour('red', '#000'), '#000');
  assert.strictEqual(E.safeColour('', '#000'), '#000');
  assert.strictEqual(E.safeColour(undefined, '#000'), '#000');
});

/* ---------- 2. the shipped flagSVG, loaded out of public/index.html ---------- */

const { loadConst } = require('./helpers');
const flagBg = loadFn('flagBg', { safeColour: E.safeColour });
const flagSVG = loadFn('flagSVG', {
  FLAG_POS: loadConst('FLAG_POS'),
  flagBg,
  esc: E.esc,
  safeColour: E.safeColour
});

check('flagSVG escapes an emblem carrying markup', () => {
  const svg = flagSVG({ col1: '#0f5c8c', col2: '#f4c542', emblem: '<img src=x onerror=alert(1)>' }, 210);
  assert.ok(!/<img/i.test(svg), 'an <img> element reached the rendered SVG');
  assert.ok(svg.includes('&lt;img'), 'emblem was not escaped');
});

check('flagSVG refuses a colour that would break out of the fill attribute', () => {
  const svg = flagSVG({ col1: '#fff" onload="alert(1)', col2: '#fff" onload="alert(1)', emblem: '🦁' }, 210);
  assert.ok(!/onload/i.test(svg), 'onload survived into the rendered SVG');
  assert.ok(svg.includes('#0f5c8c') || svg.includes('#f4c542'), 'no fallback colour was substituted');
});

check('flagSVG still renders ordinary countries unchanged', () => {
  const svg = flagSVG({ col1: '#0f5c8c', col2: '#f4c542', emblem: '🦁', stripe: 'horiz', empos: 'tright' }, 210);
  assert.ok(svg.includes('#0f5c8c') && svg.includes('#f4c542'), 'valid colours were dropped');
  assert.ok(svg.includes('🦁'), 'a plain emoji emblem was mangled');
  assert.ok(/<text x="158" y="46"/.test(svg), 'tright position lost');
});

/* ---------- 3. the server refuses junk colours ---------- */

const PORT = 3312;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-esc-'));
const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
});
const done = makeDone(server, DATA_DIR);
const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());

(async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }

  const room = await openClassRoom(post);
  const join = await post('/api/join', { room: room.room, name: 'Escapeland', homeland: 'delta' });
  const code = join.code;

  await post('/api/team/save', { code, country: { col1: '#123456', col2: '#abcdef' } });
  await post('/api/team/save', { code, country: { col1: '#fff" onload="alert(1)', col2: 'javascript:alert(1)' } });
  const state = await fetch(BASE + '/api/state?code=' + code).then(r => r.json());

  try {
    assert.strictEqual(state.team.col1, '#123456', 'server persisted a colour that is not #rrggbb');
    assert.strictEqual(state.team.col2, '#abcdef', 'server persisted a colour that is not #rrggbb');
    console.log('PASS  server refuses colours that are not #rrggbb, keeping the previous valid value');
  } catch (e) { console.error('FAIL  ' + e.message); fails++; }

  if (!ran) console.error('FAIL  escaping.test.js ran zero checks — the server likely never started');
  if (fails || !ran) { console.error(`${fails} check(s) failed`); done(1); }
  console.log('PASS  escaping — group-typed fields cannot inject markup');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
