/* A student can still open /host and make themselves a room — that route is
   deliberately left unauthenticated. What they cannot do is get the country
   inside it into the hall. This file pins the stamp that makes that possible,
   including its survival across a restart: provenance that vanishes when
   Railway restarts the dyno is provenance that fails open on the day. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupServer } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3340;                 // not shared with admin.test.js (3327/3333) or board-privacy (3328)
const BASE = `http://127.0.0.1:${PORT}`;
const KEY  = 'a-very-long-admin-key-1234';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-prov-'));

const post = (p, body) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify(body) }).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

function boot(){
  const s = spawn(process.execPath, ['server.js'], { cwd:ROOT, stdio:'ignore',
    env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT), DATA_DIR:DATA, ADMIN_KEY:KEY } });
  return s;
}
async function waitUp(){
  for(let i=0;i<80;i++){
    try { await fetch(BASE + '/'); return; } catch(e){ await new Promise(r=>setTimeout(r,100)); }
  }
  throw new Error('server never came up');
}

/* cleanupServer(server, dataDir) always rm's dataDir — it has no "just wait,
   don't delete" mode. That's fine for a test's true final teardown, but wrong
   here: the restart check below reboots against the SAME DATA_DIR, so wiping
   it between the two boots would erase the very persistence being tested.
   This waits for the child to actually exit (same protocol as
   helpers.teardownServer) without touching disk. */
function waitExit(server){
  return new Promise(resolve => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    const t = setTimeout(resolve, 2000);
    server.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

(async () => {
  let server = boot();
  await waitUp();

  const self = await post('/api/host/create', { kind:'class', label:'3E1' });
  const S = require('../server.js');

  check('a room made through the open /host route is stamped self', () => {
    assert.strictEqual(typeof self.room, 'string');
    assert.strictEqual(self.origin, 'self', 'host/create should report the origin it stamped');
  });

  /* Restart against the same DATA_DIR. If `origin` were computed rather than
     stored, or dropped by snapshot(), it would come back wrong here — and the
     hall guard in Task 2 would silently start trusting every room. */
  server.kill(); await waitExit(server);
  server = boot(); await waitUp();

  const after = await post('/api/admin/list', { key:KEY });
  const row = after.rooms.find(r => r.code === self.room);

  check('the stamp survives a restart', () => {
    assert.ok(row, 'room did not come back from disk at all');
    assert.strictEqual(row.origin, 'self');
  });

  check('trusted() refuses self and accepts admin and legacy', () => {
    assert.strictEqual(S.trusted({ origin:'self' }),  false);
    assert.strictEqual(S.trusted({ origin:'admin' }), true);
    assert.strictEqual(S.trusted({}),                 true, 'a legacy room with no origin key must stay trusted');
  });

  const noKey    = await post('/api/admin/rooms', { labels:['3E1'] });
  const wrongKey = await post('/api/admin/rooms', { key:'nope', labels:['3E1'] });
  const empty    = await post('/api/admin/rooms', { key:KEY, labels:[] });
  const made     = await post('/api/admin/rooms', { key:KEY, labels:['3E1','3E2','  '] });

  check('admin room creation fails closed without a key', () => {
    assert.ok(noKey.error, 'created rooms with no key at all');
    assert.ok(!noKey.rooms);
  });
  check('admin room creation refuses a wrong key', () => {
    assert.ok(wrongKey.error);
    assert.ok(!wrongKey.rooms);
  });
  check('an empty label list is refused rather than silently making nothing', () => {
    assert.strictEqual(empty.error, 'Give at least one class name.');
  });
  check('blank labels are dropped, real ones become rooms', () => {
    assert.strictEqual(made.rooms.length, 2, 'the whitespace-only label should not become a room');
    assert.deepStrictEqual(made.rooms.map(r=>r.label), ['3E1','3E2']);
    for(const r of made.rooms){ assert.match(r.room, /^[A-Z0-9]{4}$/); assert.ok(r.hostKey); }
  });

  const listed = await post('/api/admin/list', { key:KEY });
  check('admin-created rooms are stamped admin, and are class rooms', () => {
    for(const r of made.rooms){
      const row = listed.rooms.find(x => x.code === r.room);
      assert.ok(row, 'created room ' + r.room + ' is not in admin/list');
      assert.strictEqual(row.origin, 'admin');
      assert.strictEqual(row.kind, 'class');
    }
  });
  check('a room created through admin/rooms is trusted()', () => {
    for(const r of made.rooms){
      const row = listed.rooms.find(x => x.code === r.room);
      assert.strictEqual(S.trusted(row), true, 'admin-created room ' + r.room + ' must be trusted');
    }
  });

  /* The whole point. Build a committed country in a self-made class room and
     one in an admin-made class room, then try to pull both into a hall. */
  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS, label:'Hall' });
  const mkCountry = async (roomRes) => {
    await post('/api/host/groups', { room:roomRes.room, hostKey:roomRes.hostKey, n:1 });
    const roster = await post('/api/host/roster', { room:roomRes.room, hostKey:roomRes.hostKey });
    const code = roster.roster[0].code;
    /* team/save expects the payload nested under `country` (see every other
       test file), and a group provisioned via host/groups starts with a
       blank members.leader as well as a blank name — commit refuses either
       gap. The brief's snippet omitted both, which made commit fail with
       "Your country needs a name" / a blank leader before pullCountry's
       trust check ever ran, so the guard under test was never exercised. */
    await post('/api/team/save', { code, country:{ name:'Testland', members:{ leader:'L' } } });
    await post('/api/team/commit', { code });
    return code;
  };

  const selfRoom  = await post('/api/host/create', { kind:'class', label:'Rogue' });
  const adminMade = await post('/api/admin/rooms', { key:KEY, labels:['3E2'] });
  const selfCode  = await mkCountry(selfRoom);
  const adminCode = await mkCountry({ room:adminMade.rooms[0].room, hostKey:adminMade.rooms[0].hostKey });

  const pullSelf  = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, act:'pull', code:selfCode });
  const pullAdmin = await post('/api/host/country', { room:hall.room, hostKey:hall.hostKey, act:'pull', code:adminCode });

  check('a country from a self-made room cannot enter the hall', () => {
    assert.strictEqual(pullSelf.error, 'That country is not from a registered class room.');
  });

  /* Fetched BEFORE check() rather than inside it. check() does not await its
     callback, so an async assertion inside one can never fail the suite — the
     exact shape of phantom assertion the follow-ups doc warns about. */
  const hallRoster = await post('/api/host/roster', { room:hall.room, hostKey:hall.hostKey });
  check('the refusal actually kept it out, not just returned an error', () => {
    assert.ok(!hallRoster.roster.some(x => x.code === selfCode), 'it got in anyway');
  });

  check('a country from an admin-made room is still let in', () => {
    assert.ok(!pullAdmin.error, 'admin-made room was refused: ' + pullAdmin.error);
    assert.strictEqual(pullAdmin.ok, true);
  });

  const noKeyTrust = await post('/api/admin/trust', { room:selfRoom.room });
  const noSuchRoom = await post('/api/admin/trust', { key:KEY, room:'ZZZZ' });
  const promoted   = await post('/api/admin/trust', { key:KEY, room:selfRoom.room });
  /* The same country that was refused earlier in this file, retried after
     promotion. This is the whole point of the hatch: the group keeps the
     country it built. */
  const pullAfter  = await post('/api/host/country',
    { room:hall.room, hostKey:hall.hostKey, act:'pull', code:selfCode });

  check('promotion fails closed without the admin key', () => {
    assert.ok(noKeyTrust.error);
    assert.ok(!noKeyTrust.ok);
  });
  check('promoting a room that does not exist is an error, not a silent no-op', () => {
    assert.strictEqual(noSuchRoom.error, 'No room with that code.');
  });
  check('promotion reports the new origin', () => {
    assert.strictEqual(promoted.ok, true);
    assert.strictEqual(promoted.origin, 'admin');
  });
  check('a promoted room\'s country can now enter the hall it was refused from', () => {
    assert.ok(!pullAfter.error, 'still refused after promotion: ' + pullAfter.error);
    assert.strictEqual(pullAfter.ok, true);
  });

  /* C1: pullCountry() above is only the teacher's rescue console at /host.
     The door ~300 students actually walk through is a group's own device
     posting team/join-hall after typing the hall code off the projector.
     `selfRoom` itself cannot be reused here — it was promoted to
     origin:'admin' by the /api/admin/trust call above (line ~170), which is
     the whole point of that hatch, so by now it genuinely IS trusted and
     reusing it would make this check pass or fail for the wrong reason: it
     would prove nothing about the guard, only that promotion (already
     pinned above) worked. A second, never-promoted self-made room is needed
     to exercise the join-hall guard on a room that is still actually
     untrusted. adminMade is untouched since its creation, so it is safe to
     reuse as-is, grown to 2 slots for a second, freely-committing country. */
  const selfRoom2 = await post('/api/host/create', { kind:'class', label:'Rogue2' });
  await post('/api/host/groups', { room:selfRoom2.room, hostKey:selfRoom2.hostKey, n:1 });
  await post('/api/host/groups',
    { room:adminMade.rooms[0].room, hostKey:adminMade.rooms[0].hostKey, n:2 });
  const selfRoster2  = await post('/api/host/roster', { room:selfRoom2.room, hostKey:selfRoom2.hostKey });
  const adminRoster2 = await post('/api/host/roster',
    { room:adminMade.rooms[0].room, hostKey:adminMade.rooms[0].hostKey });
  const selfCode2  = selfRoster2.roster.find(r => !r.name).code;
  const adminCode2 = adminRoster2.roster.find(r => !r.name).code;
  await post('/api/team/save', { code:selfCode2,  country:{ name:'Testland2',  members:{ leader:'L2' } } });
  await post('/api/team/save', { code:adminCode2, country:{ name:'Otherland2', members:{ leader:'L3' } } });
  await post('/api/team/commit', { code:selfCode2 });
  await post('/api/team/commit', { code:adminCode2 });

  const joinSelf  = await post('/api/team/join-hall', { code:selfCode2,  room:hall.room });
  const joinAdmin = await post('/api/team/join-hall', { code:adminCode2, room:hall.room });

  check('team/join-hall — the path ~300 students actually use — refuses a country from a self-made room', () => {
    assert.strictEqual(joinSelf.error, 'That country is not from a registered class room.');
  });

  /* Fetched BEFORE check(), same discipline as the pullCountry check above:
     check() does not await its callback. */
  const hallRoster2 = await post('/api/host/roster', { room:hall.room, hostKey:hall.hostKey });
  check("team/join-hall's refusal actually kept the country out, not just returned an error", () => {
    assert.ok(!hallRoster2.roster.some(x => x.code === selfCode2), 'it got into the hall roster anyway');
  });

  check('team/join-hall still lets in a country from an admin-made room', () => {
    assert.ok(!joinAdmin.error, 'admin-made room was refused at join-hall: ' + joinAdmin.error);
    assert.strictEqual(joinAdmin.ok, true);
  });

  /* C2: a host who holds their own room's hostKey can press Save backup,
     edit origin (and kind) in the downloaded JSON with a text editor, then
     press Restore from file — POST /api/host/import's existing checks both
     pass, because it genuinely is their own live room. origin and kind must
     be pinned from the live room, never trusted from the uploaded file. */
  const tamperRoom = await post('/api/host/create', { kind:'class', label:'Tamper' });
  const tamperExp  = await get(`/api/host/export?room=${tamperRoom.room}&hostKey=${tamperRoom.hostKey}`);
  const tampered   = JSON.parse(JSON.stringify(tamperExp.snapshot));
  tampered.origin  = 'admin';
  tampered.kind    = 'hall';
  const tamperImport = await post('/api/host/import', { snapshot: tampered });
  check("host/import accepts a teacher restoring their own live room — the authorised path this fix must not break", () => {
    assert.ok(!tamperImport.error, 'restoring a live room under its own real host key was refused: ' + tamperImport.error);
  });
  const afterTamper = await post('/api/admin/list', { key:KEY });
  const tamperRow = afterTamper.rooms.find(r => r.code === tamperRoom.room);
  check('a tampered origin in an imported snapshot is not trusted — it is pinned from the live room, not the file', () => {
    assert.ok(tamperRow, 'the room disappeared after import');
    assert.strictEqual(tamperRow.origin, 'self', 'origin was accepted from the uploaded snapshot instead of the live room');
  });
  check('a tampered kind in an imported snapshot is likewise pinned from the live room, not the file', () => {
    assert.strictEqual(tamperRow.kind, 'class', 'kind was accepted from the uploaded snapshot instead of the live room');
  });

  server.kill(); await cleanupServer(server, DATA);
  fs.rmSync(DATA, { recursive:true, force:true });
  if (fails) { console.error('\n' + fails + ' provenance check(s) failed'); process.exit(1); }
  console.log('PASS  provenance — every room is stamped, and the stamp outlives a restart');
})();
