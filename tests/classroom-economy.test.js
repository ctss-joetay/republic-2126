/* Coins are the farming vector: pillars() reads Wealth straight off c.coins
   (game_engine.js:443), so a host who can press "Next round" in their own room
   can mint score. Trade materials are not — score() never reads stock, and
   stock only gates what a country may BUILD, which still costs coins. So a
   classroom keeps its materials and loses its income. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupServer } = require('./helpers');
const E = require('../game_engine.js');

const ROOT = path.join(__dirname, '..');
/* Opening a hall takes the event passcode now. Set it in the spawned
   server's environment and hand it to every hall this file opens — do NOT
   weaken the guard to keep a test green, or the test asserts the bug. */
const HALL_PASS = 'a-very-long-hall-passcode-for-tests';
const PORT = 3341;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-econ-'));
const post = (p, body) => fetch(BASE + p, { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify(body) }).then(r => r.json());
// /api/state is a GET-only route (server.js keys routes on `method + ' ' + path`),
// so a POST to it falls through to static-file serving and returns a 404 page,
// not JSON — the brief's snippet posted to it. Use GET with a query string,
// same as every other test in this suite (e.g. tests/board-privacy.test.js).
const get = (p) => fetch(BASE + p).then(r => r.json());

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { console.error('FAIL  ' + label + ' — ' + e.message); fails++; }
};

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd:ROOT, stdio:'ignore',
    env: { ...process.env, HALL_KEY: HALL_PASS, PORT:String(PORT), DATA_DIR:DATA } });
  for(let i=0;i<80;i++){ try { await fetch(BASE+'/'); break; } catch(e){ await new Promise(r=>setTimeout(r,100)); } }

  const cls = await post('/api/host/create', { kind:'class', label:'3E1' });
  await post('/api/host/groups', { room:cls.room, hostKey:cls.hostKey, n:1 });
  const roster = await post('/api/host/roster', { room:cls.room, hostKey:cls.hostKey });
  const code = roster.roster[0].code;

  const roundInClass = await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'round' });
  check('a classroom refuses to advance a round at all', () => {
    assert.strictEqual(roundInClass.error, 'A classroom does not run rounds. Use Deal trade materials.');
  });

  const before = await get('/api/state?code=' + code);
  await post('/api/host/act', { room:cls.room, hostKey:cls.hostKey, act:'yield' });
  const after = await get('/api/state?code=' + code);

  check('dealing materials pays no coins', () => {
    assert.strictEqual(after.team.coins, before.team.coins,
      'coins moved — the farming vector is still open');
  });

  check('dealing materials does not advance the round', () => {
    // /api/state returns round at the top level (round:room.round) — `room`
    // itself is just room.code, a string. `after.room.round` would silently
    // read undefined on both sides and pass no matter what advanceRound() did.
    assert.strictEqual(after.round, before.round);
  });

  /* A country with no industries yet has nothing to stockpile, so this asserts
     the coins/round invariants above rather than a stock increase. The stock
     increase itself is pinned on stockpile() directly, below. */
  const S = require('../server.js');
  check('stockpile() adds each non-stalled industry output and skips stalled ones', () => {
    const t = { stock:{ W:0, M:0, F:0 } };
    const ind = E.INDUSTRIES.find(i => i.out && i.out.M);
    assert.ok(ind, 'no industry produces M — this test needs rewriting');
    S.stockpile(t, [{ key:ind.key, n:2, stalled:false }, { key:ind.key, n:5, stalled:true }]);
    assert.strictEqual(t.stock.M, ind.out.M * 2, 'stalled sites must contribute nothing');
  });

  const hall = await post('/api/host/create', { kind:'hall', key: HALL_PASS, label:'Hall' });
  const yieldInHall = await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'yield' });
  check('a hall refuses to deal materials — the two actions are exclusive', () => {
    assert.strictEqual(yieldInHall.error, 'Trade materials are dealt in a classroom, not the hall.');
  });

  await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'phase', phase:'game' });
  let last;
  for(let i=0;i<E.GAME.rounds + 3;i++){
    last = await post('/api/host/act', { room:hall.room, hostKey:hall.hostKey, act:'round' });
  }
  check('a hall stops at maxRounds instead of running forever', () => {
    assert.strictEqual(last.error, 'The mass game is over — all rounds have been played.');
  });

  server.kill(); await cleanupServer(server, DATA);
  fs.rmSync(DATA, { recursive:true, force:true });
  if (fails) { console.error('\n' + fails + ' economy check(s) failed'); process.exit(1); }
  console.log('PASS  classroom economy — materials without income, and a hall that ends');
})();
