/* Four ministries, one leader, one spectator, and a table that says who may
   touch what. Pure — no room, no server, no codes — because every gate in this
   feature funnels through these four functions, and a table that is wrong here
   is wrong in six routes at once.

   The load-bearing rule is that the LEADER IS A SUPERSET. A group that never
   hands out a ministry QR has to keep playing exactly as it does today, so
   every assertion that a ministry may do something is paired with the same
   assertion for the leader. */
const assert = require('assert');
const S = require('../server.js');
const E = require('../game_engine.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

check('the four ministries are spelled as blankCountry spells them', () => {
  assert.deepStrictEqual(S.MINISTRIES, ['edu', 'def', 'trade', 'infra']);
});

check('the leader may do everything', () => {
  for (const act of ['save', 'trade', 'ally', 'choose', 'commit', 'hall'])
    assert.ok(S.mayAct('leader', act), `the leader was refused ${act}`);
  /* Every field in FIELD_OWNER is reachable by the leader. Proof: if a later
     task writes a bulk-update loop, only owned fields can be written by anyone. */
  for (const f of ['name', 'motto', 'emblem', 'col1', 'col2', 'stripe', 'empos',
                   'members', 'split', 'ready', 'buildings', 'industries'])
    assert.ok(S.mayWrite('leader', f), `the leader was refused the ${f} field`);
  for (const m of S.MINISTRIES)
    assert.ok(S.mayPick('leader', m), `the leader was refused ${m}'s picks`);
});

check('the class code may do nothing at all', () => {
  for (const act of ['save', 'trade', 'ally', 'choose', 'commit', 'hall'])
    assert.ok(!S.mayAct('view', act), `a class code was allowed ${act}`);
  for (const f of ['name', 'buildings', 'industries'])
    assert.ok(!S.mayWrite('view', f), `a class code was allowed the ${f} field`);
  for (const m of S.MINISTRIES)
    assert.ok(!S.mayPick('view', m), `a class code was allowed ${m}'s picks`);
});

check('an unknown role is refused rather than waved through', () => {
  /* Fails closed on purpose: a typo in a role string anywhere must lock a
     device out, not open one up. */
  for (const role of ['', null, undefined, 'admin', 'EDU'])
    assert.ok(!S.mayAct(role, 'save'), `role ${JSON.stringify(role)} was allowed to save`);
});

check('Defence owns alliances and Trade owns goods', () => {
  assert.ok(S.mayAct('trade', 'trade'), 'the Trade Minister cannot send a goods offer');
  assert.ok(!S.mayAct('trade', 'ally'), 'the Trade Minister was allowed to strike an alliance');
  assert.ok(S.mayAct('def', 'ally'), 'the Defence Minister cannot propose an alliance');
  assert.ok(!S.mayAct('def', 'trade'), 'the Defence Minister was allowed to send a goods offer');
});

check('deciding, committing and the hall are the leader\'s alone', () => {
  for (const m of S.MINISTRIES)
    for (const act of ['choose', 'commit', 'hall'])
      assert.ok(!S.mayAct(m, act), `the ${m} minister was allowed ${act}`);
});

check('every ministry may save, so it can post its own picks', () => {
  for (const m of S.MINISTRIES) assert.ok(S.mayAct(m, 'save'), `${m} cannot save`);
});

check('a ministry owns its own picks and no one else\'s', () => {
  for (const m of S.MINISTRIES) {
    assert.ok(S.mayPick(m, m), `${m} cannot write its own picks`);
    for (const other of S.MINISTRIES.filter(x => x !== m))
      assert.ok(!S.mayPick(m, other), `${m} was allowed to write ${other}'s picks`);
  }
});

check('Infrastructure builds and Trade & Industry sites', () => {
  assert.ok(S.mayWrite('infra', 'buildings'), 'Infrastructure cannot build');
  assert.ok(!S.mayWrite('infra', 'industries'), 'Infrastructure was allowed to site an industry');
  assert.ok(S.mayWrite('trade', 'industries'), 'Trade & Industry cannot site an industry');
  assert.ok(!S.mayWrite('trade', 'buildings'), 'Trade & Industry was allowed to build');
});

check('the country\'s identity belongs to the leader alone', () => {
  for (const m of S.MINISTRIES)
    for (const f of ['name', 'motto', 'emblem', 'col1', 'col2', 'stripe', 'empos',
                     'members', 'split', 'ready'])
      assert.ok(!S.mayWrite(m, f), `the ${m} minister was allowed to write ${f}`);
});

check('an unknown field belongs to no ministry', () => {
  /* homeland is the live example: it is rejected from every caller today and
     must not become writable by the back door of an absent table entry. */
  for (const m of S.MINISTRIES)
    assert.ok(!S.mayWrite(m, 'homeland'), `the ${m} minister was allowed to change homeland`);
  assert.ok(!S.mayWrite('edu', 'meters'), 'a minister was allowed to write meters');
});

check('unowned fields are unreachable by everyone including the leader', () => {
  /* Critical for bulk-update safety: if a later task writes a loop like
     Object.keys(c).forEach(k => { if (mayWrite(f.role, k)) team[k] = c[k]; })
     it must refuse unowned fields for all roles including leader. homeland is
     the classroom example — dealHomeland() balance must not be overwritten by
     a leader device posting it. meters is the computed example — it must never
     be writable. Both MUST fail closed. */
  assert.ok(!S.mayWrite('leader', 'homeland'),
    'the leader was allowed to write homeland, which would break dealHomeland balancing');
  assert.ok(!S.mayWrite('leader', 'meters'),
    'the leader was allowed to write meters, which would break coin computation');
});

check('every refusal is a sentence a Sec 3 student can act on', () => {
  const msgs = [
    S.refusal('view', 'save'), S.refusal('edu', 'choose'),
    S.refusal('trade', 'ally'), S.refusal('def', 'trade'), S.refusal('edu', 'commit')
  ];
  for (const m of msgs) {
    assert.strictEqual(typeof m, 'string');
    assert.ok(m.length > 10, 'refusal too short to mean anything: ' + m);
    assert.ok(!m.includes('!'), 'no exclamation marks in student copy: ' + m);
  }
  assert.ok(/Defence/.test(S.refusal('trade', 'ally')),
    'a Trade Minister refused an alliance is not told who can strike one');
  assert.ok(/Trade/.test(S.refusal('def', 'trade')),
    'a Defence Minister refused a goods offer is not told who can send one');
});

check('regRoom() re-registers a team\'s existing ministry codes, not just leader and view', () => {
  /* regRoom() is the registration pass every room goes through on restore()
     (and on host/import) — CODES starts empty in a fresh process, and
     restore() rebuilds it room by room by calling this. A team object
     loaded from disk already HAS its four minCodes (they were minted long
     ago and persisted); if regRoom() only re-registers the leader and view
     code, those four simply stop resolving the moment the server restarts —
     nothing on disk is wrong, CODES just never got told about them again.
     This is distinct from Task 3's backfill, which mints codes for a team
     that never had any; this is re-registering codes a team already
     carries. Built in-process, directly against the module's own ROOMS/
     CODES — the one way to prove regRoom() itself, not some route wrapping
     it, without spawning a server and killing it just to restart it. */
  const room = S.newRoom('class', 'RegRoomTest');
  const team = Object.assign(E.blankCountry(), {
    code:'REGRC1', viewCode:'REGRV1', pid:'REGRP1', name:'Regland',
    minCodes:{ edu:'REGRE1', def:'REGRD1', trade:'REGRT1', infra:'REGRI1' }
  });
  room.teams[team.code] = team;
  // Deliberately NOT reg()'d yet — this is what a team looks like the instant
  // it comes back off disk, before regRoom() has run over the room at all.
  S.regRoom(room);
  for (const m of S.MINISTRIES) {
    const found = S.findTeam(team.minCodes[m]);
    assert.ok(found, `regRoom() did not register ${m}'s code — it would be dead after every restart`);
    assert.strictEqual(found.team.code, team.code, `${m}'s code resolved to the wrong team`);
    assert.strictEqual(found.role, m, `${m}'s code was registered under the wrong role`);
  }
});

check('unregTeam() deletes all six of a team\'s codes from CODES, not just leader and view', () => {
  /* Route-level coverage of this (tests/ministers.test.js, "a removed
     country's ministry codes stop working") cannot actually prove
     unregTeam() does anything: findTeam()'s own self-heal (server.js,
     inside findTeam) deletes a CODES entry the instant it points at a team
     that room.teams no longer has, and answers "Country code not found."
     regardless of whether unregTeam() ever ran. Deleting only the minCodes
     line from unregTeam() and re-running that route-level test still passes
     13/13 — it is currently the one part of this task with no real coverage
     behind it. Asserting directly against CODES, in-process, is the only way
     to observe unregTeam()'s own effect rather than a downstream repair that
     happens to produce the same visible answer. */
  const room = S.newRoom('class', 'UnregTest');
  const team = Object.assign(E.blankCountry(), {
    code:'UNRGC1', viewCode:'UNRGV1', pid:'UNRGP1', name:'Unregland',
    minCodes:{ edu:'UNRGE1', def:'UNRGD1', trade:'UNRGT1', infra:'UNRGI1' }
  });
  room.teams[team.code] = team;
  S.reg(room.code, team.code, team.code, 'leader');
  S.reg(room.code, team.code, team.viewCode, 'view');
  for (const m of S.MINISTRIES) S.reg(room.code, team.code, team.minCodes[m], m);
  S.PIDS.add(team.pid);

  S.unregTeam(team);

  // The whole contract, not just the new part — a fix that broke the
  // pre-existing leader/view cleanup while adding the ministry loop would
  // pass a ministry-only assertion here and still be a regression.
  assert.ok(!S.CODES.has(team.code), 'unregTeam() left the leader code registered');
  assert.ok(!S.CODES.has(team.viewCode), 'unregTeam() left the class code registered');
  for (const m of S.MINISTRIES)
    assert.ok(!S.CODES.has(team.minCodes[m]), `unregTeam() left ${m}'s code registered`);
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
