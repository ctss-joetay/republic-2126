#!/usr/bin/env node
/* ===========================================================================
   Printed slips for the day: one page per group, plus two summaries per class.

   A group's page carries its country name, its LEADER code, its four MINISTRY
   codes, and — demoted to a spare — its CLASS code, each beside a QR that
   opens /play?code=… and joins on scan. The teacher's first summary is the
   same leader/class columns for the whole class on one sheet; a second sheet
   adds the four ministry codes, so any lost slip can be reissued from the
   front of the room without a laptop.

   Reads a snapshot from POST /api/admin/export, so it never needs a host key
   of its own and never touches the live server. Writes HTML, then asks Chrome
   to print it — the repo has no PDF dependency and is not getting one.

     node tools/make-slips.js --in rooms.json --out ~/Desktop/slips \
       --base https://your-app.up.railway.app [--classes 3E1,3E2]

   WHAT COMES OUT IS CONFIDENTIAL. Every slip is six working credentials for a
   country: the leader code drives it, the four ministry codes each drive one
   ministry, and the class code reads it. The default output is ~/Desktop/slips,
   deliberately outside the repo so nothing here can be committed by accident;
   if you point --out inside the repo, that is on you to keep out of git. Hand
   the pages out, do not mail the file round.
   =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require(path.join(__dirname, '..', 'public', 'qr.js'));   /* sets globalThis.QR */
const QR = globalThis.QR;

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1]; });
const IN   = args.in;
const OUT  = args.out ? args.out.replace(/^~/, process.env.HOME) : path.join(process.env.HOME, 'Desktop', 'slips');
/* No default: every school's copy lives at its own address, and a slip whose
   QR opens somebody else's site is worse than no slip. */
const BASE = String(args.base || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const ONLY = args.classes ? args.classes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null;
if (!IN) { console.error('need --in <export.json> (from POST /api/admin/export)'); process.exit(1); }
if (!/^https?:\/\//.test(BASE)) { console.error('need --base https://your-app.up.railway.app (the address students open)'); process.exit(1); }

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A code is only worth a QR if the page it opens will accept it — autoJoin()
   in public/index.html refuses anything that is not five letters, so a slip
   must not promise a scan that lands on the join screen. */
const link = (code) => `${BASE}/play?code=${encodeURIComponent(code)}`;
const qr = (code, px, label) =>
  (String(code || '').length === 5 ? QR.svg(link(code), { size: px, quiet: 2, label }) : '');

/* The four ministries, spelled and iconed exactly as game_engine.js's ROLES
   and server.js's MINISTRY_NAME do — a slip that calls a ministry something
   the app does not is a slip that sends a student to the wrong screen. */
const MINISTRIES = [
  ['edu',   '📚', 'Education'],
  ['def',   '🛡️', 'Defence'],
  ['trade', '⚖️', 'Trade & Industry'],
  ['infra', '🏗️', 'Infrastructure & Home Affairs']
];

/* ---------- read the input ----------

   Two shapes, because there are two ways to get this data and neither is
   always available. An admin export needs the admin key; a roster needs only
   the room's own host key, which the teacher briefing already carries — so on
   a day when the admin key is not to hand, rosters still get the slips out.

     snapshot : { rooms: [ { kind, code, label, teams: { … } } ] }
     rosters  : [ { klass, room, roster: [ { slot, name, code, viewCode } ] } ]  */
const input = JSON.parse(fs.readFileSync(IN, 'utf8'));
const rooms = Array.isArray(input) && input.length && input[0].roster
  ? input.map(r => ({ kind:'class', code:r.room, label:r.klass,
                      teams: Object.fromEntries((r.roster || []).map(t => [t.code, t])) }))
  : (input.rooms || input).filter(r => (r.kind || 'hall') === 'class');

const classes = rooms
  .map(r => ({
    label: (r.label || r.code || '').trim(),
    code: r.code,
    groups: Object.values(r.teams || {})
      .map(t => ({ slot: t.slot || 0, name: (t.name || '').trim(), code: t.code,
                   viewCode: t.viewCode, minCodes: t.minCodes || {} }))
      /* A provisioned-but-unclaimed slot has no country name. It still gets a
         slip: on the day it is the spare a group uses when a device dies, and
         the codes on it are already live. */
      .sort((a, b) => a.slot - b.slot)
  }))
  .filter(c => c.groups.length)
  .filter(c => !ONLY || ONLY.includes(c.label.toUpperCase()))
  .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

if (!classes.length) {
  console.error('no classroom rooms matched' + (ONLY ? ' --classes ' + ONLY.join(',') : ''));
  process.exit(1);
}

/* ---------- the page furniture ---------- */
const CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  *{ box-sizing:border-box }
  body{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
        color:#101828; -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .slip{ page-break-after:always; height:273mm; display:flex; flex-direction:column }
  .slip:last-child{ page-break-after:auto }
  .top{ display:flex; justify-content:space-between; align-items:flex-start;
        border-bottom:3px solid #0f5c8c; padding-bottom:8mm }
  .klass{ font-size:15pt; font-weight:700; color:#0f5c8c; letter-spacing:1px }
  .grp{ font-size:11pt; color:#667085; margin-top:2mm }
  .country{ font-size:30pt; font-weight:800; line-height:1.05; margin:9mm 0 2mm }
  .unnamed{ color:#98a2b3; font-weight:600; font-size:20pt }
  .lead{ font-size:11.5pt; color:#475467; margin-bottom:5mm; max-width:150mm }
  .codes{ display:flex; gap:8mm }
  .code{ flex:1; border:1.5px solid #d0d5dd; border-radius:4mm; padding:5mm; text-align:center }
  .code.leader{ border-color:#0f5c8c; border-width:2.5px }
  .role{ font-size:12pt; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#0f5c8c }
  .who{ font-size:10pt; color:#667085; margin:2mm 0 4mm; min-height:6mm }
  .val{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:27pt; font-weight:700;
        letter-spacing:5px; margin:3mm 0 4mm }
  .qr svg{ display:block; margin:0 auto }
  .scan{ font-size:9.5pt; color:#667085; margin-top:3mm }
  /* ---- the four ministries ---- */
  .ministries{ display:flex; gap:5mm; margin-top:5mm }
  .min{ flex:1; border:1.5px solid #d0d5dd; border-radius:3mm; padding:3mm 2mm; text-align:center }
  .minName{ font-size:9.5pt; font-weight:700; color:#0f5c8c; min-height:7mm }
  .minVal{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12pt; font-weight:700;
           letter-spacing:2px; margin-top:2mm }
  /* ---- the class code, demoted to a spare ---- */
  .spare{ display:flex; align-items:center; gap:5mm; margin-top:5mm;
          border-top:1px dashed #eaecf0; padding-top:4mm }
  .spareInfo{ flex:1 }
  .spareName{ font-size:10.5pt; font-weight:700; color:#667085 }
  .spareWho{ font-size:9pt; color:#98a2b3; margin-top:1mm }
  .spareVal{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:15pt; font-weight:700;
             letter-spacing:3px; margin-top:2mm }
  .foot{ margin-top:auto; border-top:1px solid #eaecf0; padding-top:4mm; font-size:10pt; color:#475467 }
  .hall{ display:inline-block; border:1.5px dashed #98a2b3; border-radius:2mm;
         padding:3mm 14mm; margin-left:3mm; color:#98a2b3 }
  /* ---- summary ---- */
  h1{ font-size:19pt; margin:0 0 1mm }
  .sub{ color:#667085; font-size:10.5pt; margin:0 0 6mm }
  table{ width:100%; border-collapse:collapse }
  th{ text-align:left; font-size:9.5pt; text-transform:uppercase; letter-spacing:1px;
      color:#667085; border-bottom:2px solid #101828; padding:0 3mm 2.5mm }
  td{ border-bottom:1px solid #eaecf0; padding:3.5mm 3mm; vertical-align:middle }
  .cname{ font-size:13pt; font-weight:700 }
  .cslot{ font-size:9pt; color:#98a2b3 }
  .cell{ display:flex; align-items:center; gap:4mm }
  .mono{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:15pt;
         font-weight:700; letter-spacing:3px }
  .mono.dim{ color:#667085 }
  /* Six columns (Group, Country, four ministries) leave less room per cell
     than the three-column leader/class sheet, so the ministry sheet's codes
     use a smaller, tighter mono style rather than .mono. */
  .mcode{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5pt;
          font-weight:700; letter-spacing:1.5px }
  .warn{ margin-top:7mm; font-size:9.5pt; color:#b42318 }
`;

const slipPage = (cls, g) => `
<section class="slip">
  <div class="top">
    <div><div class="klass">${esc(cls.label)}</div>
      <div class="grp">Group ${esc(g.slot || '—')} · Republic 2126</div></div>
    <div class="grp">Keep this sheet. It is the only copy.</div>
  </div>
  <div class="country">${g.name ? esc(g.name) : '<span class="unnamed">Your country — name it on the day</span>'}</div>
  <div class="lead">Scan a code below, or go to <b>${esc(BASE.replace(/^https?:\/\//, ''))}/play</b>
    and type the letters. The Leader names the country and breaks ties. Each Minister below uses
    their own code to run their ministry. The small code at the bottom is a spare — it only
    watches, it cannot change anything.</div>
  <div class="codes">
    <div class="code leader">
      <div class="role">Leader</div>
      <div class="who">One iPad only — the person who taps the buttons</div>
      <div class="val">${esc(g.code)}</div>
      <div class="qr">${qr(g.code, 148, 'Leader code QR')}</div>
      <div class="scan">Scan to open your country</div>
    </div>
  </div>
  <div class="ministries">
    ${MINISTRIES.map(([k, ic, nm]) => `
      <div class="min">
        <div class="minName">${ic} ${esc(nm)}</div>
        <div class="qr">${qr(g.minCodes[k], 82, nm + ' code QR')}</div>
        <div class="minVal">${esc(g.minCodes[k] || '—')}</div>
      </div>`).join('')}
  </div>
  <div class="spare">
    <div class="qr">${qr(g.viewCode, 64, 'Class code QR')}</div>
    <div class="spareInfo">
      <div class="spareName">Spare device — watches only</div>
      <div class="spareWho">Anyone else in the group can scan this to watch, not change, the country.</div>
      <div class="spareVal">${esc(g.viewCode || '—')}</div>
    </div>
  </div>
  <div class="foot">Hall code for the mass game: <span class="hall">&nbsp;</span>
    &nbsp; — your teacher gives you this on the day.</div>
</section>`;

const summaryPage = (cls) => `
<section class="slip">
  <h1>${esc(cls.label)} — codes for every group</h1>
  <p class="sub">Teacher's copy. Room <b>${esc(cls.code)}</b> · ${cls.groups.length} groups ·
    ${esc(BASE.replace(/^https?:\/\//, ''))}/play</p>
  <table>
    <tr><th>Country</th><th>Leader code — drives it</th><th>Class code — watches it</th></tr>
    ${cls.groups.map(g => `
    <tr>
      <td><div class="cname">${g.name ? esc(g.name) : '<span class="cslot">not named yet</span>'}</div>
          <div class="cslot">Group ${esc(g.slot || '—')}</div></td>
      <td><div class="cell">${qr(g.code, 76, 'Leader QR')}<span class="mono">${esc(g.code)}</span></div></td>
      <td><div class="cell">${qr(g.viewCode, 76, 'Class QR')}<span class="mono dim">${esc(g.viewCode || '—')}</span></div></td>
    </tr>`).join('')}
  </table>
  <div class="warn">Every code on this sheet is a working login. Do not photograph it or send it on.</div>
</section>`;

/* Seven columns (Group, Country, Leader, Class, and four ministries) will not
   fit A4 and stay readable, so the ministries get a sheet of their own. This
   is the front-of-room reissue path: a group whose Defence slip has gone
   missing gets the code read out without a laptop — no QR needed here, just
   letters big enough to read across a room. */
const ministrySheet = (cls) => `
<section class="slip">
  <h1>${esc(cls.label)} — ministry codes</h1>
  <p class="sub">Teacher's copy. Room <b>${esc(cls.code)}</b> · ${cls.groups.length} groups ·
    ${esc(BASE.replace(/^https?:\/\//, ''))}/play</p>
  <table>
    <tr><th>Group</th><th>Country</th>${MINISTRIES.map(([, ic, nm]) =>
      `<th>${ic} ${esc(nm)}</th>`).join('')}</tr>
    ${cls.groups.map(g => `
    <tr>
      <td class="cslot">${esc(g.slot || '—')}</td>
      <td><div class="cname">${g.name ? esc(g.name) : '<span class="cslot">not named yet</span>'}</div></td>
      ${MINISTRIES.map(([k]) => `<td><span class="mcode">${esc(g.minCodes[k] || '—')}</span></td>`).join('')}
    </tr>`).join('')}
  </table>
  <div class="warn">Every code on this sheet is a working login. Do not photograph it or send it on.</div>
</section>`;

const doc = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
   <style>${CSS}</style></head><body>${body}</body></html>`;

/* ---------- write, then print ---------- */
fs.mkdirSync(OUT, { recursive: true });
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium']
                .find(p => fs.existsSync(p));

function toPdf(html, name) {
  const htmlPath = path.join(OUT, name + '.html');
  fs.writeFileSync(htmlPath, html);
  if (!CHROME) { console.log('  ' + name + '.html (no Chrome found — print it yourself)'); return; }
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--print-to-pdf=' + path.join(OUT, name + '.pdf'), 'file://' + htmlPath], { stdio: 'ignore' });
  fs.unlinkSync(htmlPath);
  console.log('  ' + name + '.pdf');
}

let groups = 0;
for (const cls of classes) {
  groups += cls.groups.length;
  toPdf(doc(cls.label + ' — group slips', cls.groups.map(g => slipPage(cls, g)).join('')),
        cls.label + '-slips');
  toPdf(doc(cls.label + ' — teacher summary', summaryPage(cls) + ministrySheet(cls)), cls.label + '-summary');
}
console.log(`\n${classes.length} classes, ${groups} groups → ${OUT}`);
console.log('These are live credentials. Print them, do not forward them.');
