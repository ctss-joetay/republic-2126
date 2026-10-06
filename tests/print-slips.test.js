/* Printing a class's codes as cut-out slips, from the teacher console.

   The roster on the console shows every group's six codes at once, so a
   teacher handing them out either reads them aloud or shows the screen —
   either way every student sees everyone's codes. The 🖨 Print slips button
   builds a printable page per group, cut along dashed lines into six strips:
   the Leader, the four ministers and the spare class code. Each student gets
   only their own strip.

   What has to hold: one page per group; a strip carries exactly one code, so
   cutting a page apart really does separate them; no group's page leaks
   another group's codes; the host key never appears anywhere on paper; and
   the QR opens the join page with the code already filled in. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFn } = require('./helpers');

const HOST = path.join(__dirname, '..', 'public', 'host.html');
const SRC = fs.readFileSync(HOST, 'utf8');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

const esc = loadFn('esc', {}, HOST);
/* ROLES is a top-level const in host.html; the shape is all this needs. */
const ROLES = [
  { key:'leader', icon:'👑', name:'Leader' },
  { key:'edu', icon:'📚', name:'Minister of Education' },
  { key:'def', icon:'🛡️', name:'Minister of Defence' },
  { key:'trade', icon:'⚖️', name:'Minister of Trade & Industry' },
  { key:'infra', icon:'🏗️', name:'Minister of Infrastructure & Home Affairs' }
];
const qrCalls = [];
const qr = (url) => { qrCalls.push(url); return `<svg data-url="${url}"></svg>`; };
const slipsDoc = loadFn('slipsDoc', { ROLES, esc }, HOST);

const roster = [
  { slot:1, name:'Bakau', code:'AAAA1', viewCode:'VVVV1', homeland:'delta',
    minCodes:{ edu:'EEEE1', def:'DDDD1', trade:'TTTT1', infra:'IIII1' } },
  { slot:2, name:'', code:'AAAA2', viewCode:'VVVV2', homeland:'hills',
    minCodes:{ edu:'EEEE2', def:'DDDD2', trade:'TTTT2', infra:'IIII2' } },
];
const codesOf = t => [t.code, t.viewCode, ...Object.values(t.minCodes)];
const html = slipsDoc(roster, { label:'3E1', origin:'https://example.up.railway.app', qr, hostKey:'SECRETHOSTKEY' });
const pages = html.split('class="page"').slice(1);

check('one page per group', () => {
  assert.strictEqual(pages.length, 2, `expected 2 pages, got ${pages.length}`);
});

check('each page holds that group\'s six codes and no other group\'s', () => {
  roster.forEach((t, i) => {
    codesOf(t).forEach(c => assert.ok(pages[i].includes(c), `page ${i + 1} is missing ${c}`));
    roster.filter((_, j) => j !== i).forEach(o =>
      codesOf(o).forEach(c => assert.ok(!pages[i].includes(c), `page ${i + 1} leaks ${c} from another group`)));
  });
});

check('each strip carries exactly one code, so cutting the page apart separates them', () => {
  const strips = pages[0].split('class="strip"').slice(1);
  assert.strictEqual(strips.length, 6, `expected 6 strips, got ${strips.length}`);
  strips.forEach((s, k) => {
    const found = codesOf(roster[0]).filter(c => s.includes(c));
    assert.strictEqual(found.length, 1, `strip ${k + 1} carries ${found.length} codes: ${found.join(', ')}`);
  });
});

check('every role is named on its strip, and the class code is marked as the spare', () => {
  ROLES.forEach(r => assert.ok(pages[0].includes(esc(r.name)), `no strip for ${r.name}`));
  assert.ok(/spare/i.test(pages[0]), 'the class code strip does not say it is the spare');
});

check('the QR on each strip opens the join page with that code filled in', () => {
  codesOf(roster[0]).forEach(c =>
    assert.ok(qrCalls.includes(`https://example.up.railway.app/play?code=${c}`), `no QR for ${c}`));
  assert.ok(html.includes('example.up.railway.app/play'), 'the typed fallback address is missing');
});

check('the host key never appears on paper', () => {
  assert.ok(!html.includes('SECRETHOSTKEY'), 'the host key was printed');
});

check('pages break for printing, and strips are marked for cutting', () => {
  assert.ok(/page-break-after\s*:\s*always|break-after\s*:\s*page/.test(html), 'no page break between groups');
  assert.ok(/dashed/.test(html), 'no dashed cut lines');
});

check('a country name is escaped, and an unnamed group still prints', () => {
  const evil = slipsDoc([{ ...roster[0], name:'<img src=x onerror=alert(1)>' }],
    { label:'<b>x</b>', origin:'https://e.app', qr });
  assert.ok(!evil.includes('<img src=x'), 'a raw country name reached the page');
  assert.ok(!evil.includes('<b>x</b>'), 'a raw class label reached the page');
  assert.ok(pages[1].includes('Group 2'), 'an unnamed group has no heading');
});

check('the classroom console has a Print slips button wired to printSlips()', () => {
  const row = SRC.slice(SRC.indexOf('id="groupsRow"'), SRC.indexOf('</div>', SRC.indexOf('id="groupsRow"')));
  assert.ok(/onclick="printSlips\(\)"/.test(row), 'no Print slips button in the classroom groups row');
  assert.ok(/function printSlips\(/.test(SRC), 'printSlips() is not defined');
});

check('host.html still parses — a top-level name collision kills every handler', () => {
  const scripts = [...SRC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((s, i) => { try { new Function(s); } catch (e) { throw new Error(`script ${i}: ${e.message}`); } });
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
