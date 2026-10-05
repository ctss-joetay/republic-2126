/* Final-branch review, fix 1 (BLOCKER): a minister's policy tap must never
   revert the Leader's buildings or industries.

   minister-client.test.js already pins saveBody()'s OUTPUT in isolation —
   this file is the behavioural half the review specifically asked for: the
   REAL saveBody(), extracted straight out of public/index.html, posted to a
   REAL running server, reproducing the exact sequence measured live in the
   review:

     LEADER builds one home, presses Next   -> SERVER buildings = {"home":1}
     INFRA MINISTER taps a policy card      -> posted {"picks":{"infra":[...]},"buildings":{}}
                                             -> SERVER buildings = {}   ok:true

   A source grep for the absence of a `buildings:` line in saveBody() cannot
   tell you the server-visible consequence never happens — only running the
   real save through the real server can. This file spawns one and does. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDone, openClassRoom, loadFn } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3348;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-min-echo-'));

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());
const get = (p) => fetch(BASE + p).then(r => r.json());

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore'
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

  const room = await openClassRoom(post);
  const groups = await post('/api/host/groups', { room: room.room, hostKey: room.hostKey, n: 1 });
  const co = groups.roster[0];

  /* The Leader builds a home and saves — exactly the leader-side saveBody()
     branch, which posts buildings unconditionally because the leader
     genuinely owns that field and genuinely has the UI for it. */
  const bKey = E.BUILDINGS[0].key;
  await post('/api/team/save', { code: co.code, country: {
    members: { leader: 'Kai' }, split: { edu:6, def:6, trade:6, infra:6 },
    buildings: { [bKey]: 1 } } });
  const beforeInfraSave = await get('/api/state?code=' + co.code);
  check('the Leader\'s build actually landed on the server (fixture sanity check)', () => {
    assert.strictEqual(beforeInfraSave.team.buildings[bKey], 1,
      'the fixture itself is broken — the Leader\'s own building save did not land, so the check below would pass for the wrong reason');
  });

  /* Now the Infra Minister's device. It has never opened a build screen —
     there is none — so its C.buildings is exactly what a fresh minister
     device starts from: E.blankCountry()'s default, same as startSolo() and
     enterPrep() hand every ministry device. Run the REAL saveBody() (not a
     reimplementation) through myMinistry()='infra', exactly as toggleCard()
     would after a policy tap, and post whatever it produces to the REAL
     server under the REAL infra credential. */
  const C = E.blankCountry();
  C.picks = { edu:[], def:[], trade:[], infra:['mixed'] };
  const S = { solo:false, code: co.minCodes.infra, role:'infra' };
  const saveBody = loadFn('saveBody', { S, C, myMinistry: () => 'infra', EDITING_PICKS: null });
  const body = saveBody();
  const infraSave = await post('/api/team/save', { code: co.minCodes.infra, country: body });
  check('the infra minister\'s save was not itself refused', () => {
    assert.ok(!infraSave.error, 'the infra minister\'s policy save was refused: ' + infraSave.error);
  });

  const afterInfraSave = await get('/api/state?code=' + co.code);
  check('an infra minister\'s policy tap does not revert the Leader\'s buildings', () => {
    assert.strictEqual(afterInfraSave.team.buildings[bKey], 1,
      'the Leader\'s building vanished after an Infra Minister saved a policy pick — the exact regression this fix exists to close');
  });
  check('the infra minister\'s own policy pick still landed', () => {
    assert.deepStrictEqual(afterInfraSave.team.picks.infra, ['mixed'],
      'the infra minister\'s actual edit (the policy pick) did not save — this fix must not also break the thing that is supposed to work');
  });

  /* Same shape, the Trade/industries door — the review's fix names both
     fields in the same breath, and both are wired through the identical
     `if(m === 'trade') b.industries = C.industries;` line in saveBody(). */
  await post('/api/team/save', { code: co.code, country: { industries: { farm: 1 } } });
  const beforeTradeSave = await get('/api/state?code=' + co.code);
  check('the Leader\'s industry actually landed on the server (fixture sanity check)', () => {
    assert.strictEqual(beforeTradeSave.team.industries.farm, 1,
      'the fixture itself is broken — the Leader\'s own industries save did not land');
  });

  const C2 = E.blankCountry();
  /* 'mixed' is an Infra card (Mixed housing estates), not a Trade one — a
     coordinator review of the first pass caught it, correctly, as posting a
     card that does not exist for this ministry. E.CARDS.trade is
     port/sme/fdi/tour/protect/strip; the server drops an unrecognised key
     silently (mayPick() filters per-ministry against E.CARDS[m]) and stores
     picks.trade as [], so the previous version of this fixture proved less
     than it looked like it did — a real card is required to prove the
     "own pick still landed" half honestly. */
  const tradePick = E.CARDS.trade[0].key; // 'port'
  C2.picks = { edu:[], def:[], trade:[tradePick], infra:[] };
  const S2 = { solo:false, code: co.minCodes.trade, role:'trade' };
  const saveBodyTrade = loadFn('saveBody', { S: S2, C: C2, myMinistry: () => 'trade', EDITING_PICKS: null });
  const bodyTrade = saveBodyTrade();
  const tradeSave = await post('/api/team/save', { code: co.minCodes.trade, country: bodyTrade });
  check('the trade minister\'s save was not itself refused', () => {
    assert.ok(!tradeSave.error, 'the trade minister\'s policy save was refused: ' + tradeSave.error);
  });

  const afterTradeSave = await get('/api/state?code=' + co.code);
  check('a trade minister\'s policy tap does not revert the Leader\'s industries', () => {
    assert.strictEqual(afterTradeSave.team.industries.farm, 1,
      'the Leader\'s industry vanished after a Trade Minister saved a policy pick — the same regression on the industries door');
  });
  check('the trade minister\'s own policy pick still landed', () => {
    assert.deepStrictEqual(afterTradeSave.team.picks.trade, [tradePick],
      'the trade minister\'s actual edit (the policy pick) did not save — this fix must not also break the thing that is supposed to work');
  });

  if (!ran) console.error('FAIL  minister-echo-guard.test.js ran zero checks — the server likely never started');
  if (fails || !ran) done(1);
  console.log(`\n${ran - fails}/${ran} passed`);
  done(0);
})().catch(e => { console.error('FAIL ', e); done(1); });
