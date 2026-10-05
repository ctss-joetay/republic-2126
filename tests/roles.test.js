/* Task 4 gave every group a leader code (one iPad, drives the country) and a
   class code (the other four, watch only) — but nothing enforced the split.
   A class code was a full write credential, AND /api/state handed it the
   leader code sitting inside team.code. Either hole alone makes the other
   pointless: block writes but leak the leader code, and a member device just
   uses the leader code it was handed; redact the leader code but skip write
   gating, and the class code still works as a write credential on its own.
   This test proves both halves close together. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone } = require('./helpers');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3323;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-roles-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, HALL_KEY: HALL_PASS, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
});
const done = makeDone(server, DATA_DIR);

(async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  let fails = 0, ran = 0;
  const check = (name, fn) => { ran++; try { fn(); console.log('PASS  ' + name); }
    catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

  const r = await post('/api/host/create', { kind:'class', label:'3G' });
  const g = await post('/api/host/groups', { room:r.room, hostKey:r.hostKey, n:2 });
  const one = g.roster[0], two = g.roster[1];
  await post('/api/team/save', { code: one.code, country: { name:'Solaria', members:{ leader:'Ana' } } });
  await post('/api/team/save', { code: two.code, country: { name:'Verdana', members:{ leader:'Bo' } } });

  const asLeader = await get('/api/state?code=' + one.code);
  const asMember = await get('/api/state?code=' + one.viewCode);
  check('both codes reach the same country, with different roles', () => {
    assert.strictEqual(asLeader.role, 'leader');
    assert.strictEqual(asMember.role, 'member');
    assert.strictEqual(asMember.team.name, 'Solaria');
  });
  const rosterOne = one;
  /* Widened when ministries got codes of their own: the rule is no longer
     "not the leader code", it is "no code but the one you arrived with".
     A member device holding any ministry's code could pick up that ministry's
     powers, which is the same hole one layer along. */
  check('a member device receives no code but its own', () => {
    const json = JSON.stringify(asMember);
    assert.ok(!json.includes(one.code),
      'the leader code was handed to a member device — the role split is theatre');
    for(const m of ['edu','def','trade','infra']){
      const mc = (rosterOne.minCodes || {})[m];
      assert.ok(mc, `the roster carries no ${m} code to check against`);
      assert.ok(!json.includes(mc),
        `a member device was handed the ${m} code — it can act as that ministry`);
    }
  });

  /* The other way a country comes into existence. /api/host/groups mints both
     codes; /api/join minted only the leader's, so a group who joined an open
     room had no class code to hand round — the leader read out the only code
     they had, every iPad in the group came back a leader, and four devices
     edited one country through nation-building, each blind to the others'
     saves. The split has to hold on both doors, not just the provisioned one. */
  const openRoom = await post('/api/host/create', { kind:'class', label:'3H' });
  await post('/api/host/act', { room:openRoom.room, hostKey:openRoom.hostKey, act:'openjoin' });
  const joined = await post('/api/join', { room:openRoom.room, name:'Selfmade', homeland:'delta' });
  const openRoster = await post('/api/host/roster', { room:openRoom.room, hostKey:openRoom.hostKey });
  const selfMade = (openRoster.roster || []).find(t => t.code === joined.code);
  check('a country made through open joining gets a class code of its own', () => {
    assert.ok(selfMade, 'the self-made country never reached the roster');
    assert.ok(selfMade.viewCode, 'a country made through open joining had no class code at all — the group has nothing to hand round but the leader code');
    assert.notStrictEqual(selfMade.viewCode, selfMade.code,
      'the class code and the leader code were the same string — every iPad in the group drives the country');
  });
  const selfMember = selfMade && selfMade.viewCode
    ? await get('/api/state?code=' + selfMade.viewCode) : null;
  check('that class code opens a watching device, not a second leader', () => {
    assert.ok(selfMember && !selfMember.error, 'the class code did not reach the country');
    assert.strictEqual(selfMember.role, 'member');
    assert.strictEqual(selfMember.team.name, 'Selfmade');
    assert.ok(!JSON.stringify(selfMember).includes(joined.code),
      'the self-made country handed its leader code to a member device');
  });
  const selfWrite = selfMade && selfMade.viewCode
    ? await post('/api/team/save', { code: selfMade.viewCode, country: { name:'Hijacked' } }) : null;
  check('a self-made country\'s class code cannot rename it', () => {
    assert.ok(selfWrite && selfWrite.error, 'a member device renamed a self-made country');
  });

  /* 'nope' used to stand in for an offer id here, which meant this row was
     refused by the "Offer not found" lookup — above the role gate — and
     never actually exercised it. A real pending offer, addressed to one's
     country, is what makes this row prove the class code is refused BY THE
     GATE, the same discipline the other four rows already get. */
  const viewRespondOffer = await post('/api/trade/offer',
    { code: two.code, to: one.pid, give:{F:1}, want:{M:1} });
  const writes = [
    ['save',    () => post('/api/team/save', { code: one.viewCode, country: { name:'Hijacked' } })],
    ['choose',  () => post('/api/scenario/choose', { code: one.viewCode, choice:'x' })],
    ['offer',   () => post('/api/trade/offer', { code: one.viewCode, to: two.pid, give:{F:1}, want:{M:1} })],
    ['respond', () => post('/api/trade/respond', { code: one.viewCode, id: viewRespondOffer.offer.id, accept:true })],
    ['commit',  () => post('/api/team/commit', { code: one.viewCode })]
  ];
  for (const [name, fn] of writes) {
    const res = await fn();
    check(`a view code cannot ${name}`, () => {
      assert.ok(res.error, `a member device was allowed to ${name}`);
    });
  }
  const stillMine = await get('/api/state?code=' + one.code);
  check('nothing a member tried actually landed', () => {
    assert.strictEqual(stillMine.team.name, 'Solaria');
  });

  /* A leader device is the one thing that IS allowed to write. Gating every
     path on role must not have collaterally blocked the role it exists to
     let through. */
  const leaderSave = await post('/api/team/save', { code: one.code, country: { motto:'Ad astra' } });
  check('the leader code can still write', () => {
    assert.ok(!leaderSave.error, 'the leader code was refused a write: ' + leaderSave.error);
  });
  const leaderCommit = await post('/api/team/commit', { code: one.code });
  check('the leader code can commit', () => {
    assert.ok(!leaderCommit.error, 'the leader code was refused a commit: ' + leaderCommit.error);
  });

  /* Two devices on one country now get different payloads. If they share an
     ETag, one browser's cache serves the other's answer. */
  const eL = (await fetch(BASE + '/api/state?code=' + one.code)).headers.get('etag');
  const eM = (await fetch(BASE + '/api/state?code=' + one.viewCode)).headers.get('etag');
  check('leader and member responses do not share a cache entry', () => {
    assert.ok(eL && eM, 'no ETag was issued');
    assert.notStrictEqual(eL, eM, 'a member could be served the leader\'s cached response');
  });

  /* Prove the gate, not just the guard: a write refusal is worthless if the
     same response (or any other route a member device polls) still hands
     over the credential that makes the refusal irrelevant. Fetch the RAW
     HTTP body — not a value re-serialised by this test — so nothing between
     the wire and the assertion can paper over a leak. /api/state carries
     team, income, score, free, board, offers and feed all in one payload;
     checking the whole raw body for the leader code covers every one of
     them in a single pass. */
  const rawMemberState = await fetch(BASE + '/api/state?code=' + one.viewCode).then(r => r.text());
  check('the raw /api/state body for a class code contains no occurrence of the leader code', () => {
    assert.ok(!rawMemberState.includes(one.code),
      'the leader code appears in the raw response text — team, income, score, free, board, offers or feed leaked it');
  });
  const rawLeaderState = await fetch(BASE + '/api/state?code=' + one.code).then(r => r.text());
  check('a leader device is still told its own leader code', () => {
    assert.ok(rawLeaderState.includes(one.code),
      'the leader\'s own device stopped receiving its own code — that would break every existing client');
  });

  /* trade/respond needs a guard the brief itself never triggers: `locked` is
     always false until Task 6 lands the commit flow, so this is the only
     way to prove the from.locked check does anything at all today. Craft a
     room directly — via the same host/import path rooms.test.js and
     board-privacy.test.js already use to plant arbitrary state — with one
     country already committed and holding a pending outgoing offer, and
     confirm the recipient cannot complete it. */
  const E2 = require('../game_engine.js');
  const lockedTeam = Object.assign(E2.blankCountry(), {
    code:'LOCKED1', viewCode:'LOCKVW1', pid:'LOCKPID', name:'Lockland', homeland:'delta', slot:1, locked:true
  });
  lockedTeam.meters = E2.foundingMeters(lockedTeam);
  const openTeam = Object.assign(E2.blankCountry(), {
    code:'OPEN001', viewCode:'OPENVW1', pid:'OPENPID', name:'Openland', homeland:'high', slot:2, locked:false
  });
  openTeam.meters = E2.foundingMeters(openTeam);
  const pendingOffer = {
    id:'OFFR01', from:'LOCKPID', fromName:'Lockland', to:'OPENPID', toName:'Openland',
    give:{ W:0, M:0, F:1 }, want:{ W:0, M:1, F:0 }, coins:0, ally:false, status:'pending', t:Date.now()
  };
  // Final-review finding 5: host/import now requires a LIVE room with a
  // matching hostKey, not just any code — mint one for real first.
  const lockedHost = await post('/api/host/create', { kind:'hall', key: HALL_PASS });
  const lockedRoom = {
    code:lockedHost.room, hostKey:lockedHost.hostKey, kind:'hall', label:'', phase:'prep', round:0, maxRounds:10,
    scenario:null, scenarioRound:0,
    teams:{ LOCKED1:lockedTeam, OPEN001:openTeam }, offers:[pendingOffer], feed:[],
    openJoin:false, practiceLeft:0, timerEndsAt:null, timerSecs:0, rev:1, created:Date.now(), touched:Date.now()
  };
  const lockedImport = await post('/api/host/import', { snapshot: lockedRoom });
  check('a crafted room with a committed country imports cleanly', () => {
    assert.ok(!lockedImport.error, 'import failed: ' + lockedImport.error);
  });
  const respondToLocked = await post('/api/trade/respond', { code:'OPEN001', id:'OFFR01', accept:true });
  check('a country cannot accept an offer from a country that has committed', () => {
    assert.ok(respondToLocked.error, 'the offer from a locked country was accepted anyway — untestable until Task 6 sets locked:true through the real commit flow, so this pins the guard by crafting that state directly');
  });
  const offerAfter = await get('/api/state?code=OPEN001');
  check('the untouched offer is still pending, and no resources moved', () => {
    const stillPending = offerAfter.offers.find(o => o.id === 'OFFR01');
    assert.ok(stillPending && stillPending.status === 'pending', 'the offer was resolved despite the sender being locked');
    assert.strictEqual(offerAfter.team.stock.F, 0, 'Openland received resources from a locked sender');
  });

  if (!ran) console.error('FAIL  roles.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log('PASS  roles — only a leader code may write, and a member never receives one');
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
