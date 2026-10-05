/* First-run setup.

   A school deploying the Railway template may leave ADMIN_KEY and HALL_KEY
   blank. The server then has no admin key, so it prints a one-time setup code
   to its own log and /setup accepts the two keys — but only with that code.
   The code is the whole point: the site is on a public URL the moment it
   deploys, and without it whoever found the URL first would own the admin
   panel.

   Keys saved this way live in keys.json on the data volume. A Railway variable,
   when it is set, always wins over the file — a teacher who later types a key
   into Railway gets exactly that key, not one a forgotten wizard run left
   behind. */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupServer } = require('./helpers');
/* Stop a server whose data directory a later boot still needs. */
const stopKeep = proc => cleanupServer(proc, fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-scratch-')));

const ROOT = path.join(__dirname, '..');
const ADMIN = 'a-long-admin-key-from-the-wizard';
const HALL  = 'Hk7m2Qx9';

function boot(port, env, dir){
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'r2126-setup-'));
  const clean = { ...process.env };
  delete clean.ADMIN_KEY; delete clean.HALL_KEY; delete clean.SETUP_CODE;
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...clean, PORT: String(port), DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  return {
    proc, dir, base, log: () => log,
    get: p => fetch(base + p).then(r => r.json()),
    page: p => fetch(base + p).then(async r => ({ status: r.status, text: await r.text() })),
    post: (p, body) => fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()),
    ready: async () => {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 150));   // let the boot log land
    }
  };
}
const codeIn = log => (/SETUP CODE:\s*([A-Z0-9]+)/.exec(log) || [])[1];

let fails = 0, ran = 0;
const check = async (name, fn) => { ran++;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

(async () => {
  const s = boot(3381, {});
  await s.ready();
  const code = codeIn(s.log());

  await check('a server with no admin key prints a one-time setup code to its log', () => {
    assert.ok(code && code.length >= 8, 'no setup code in the boot log:\n' + s.log());
  });

  await check('the status route says setup is needed, and never carries a key or the code', async () => {
    const st = await s.get('/api/setup/status');
    assert.strictEqual(st.needed, true);
    assert.strictEqual(st.adminSet, false);
    assert.strictEqual(st.hallSet, false);
    assert.ok(!JSON.stringify(st).includes(code), 'the status route leaked the setup code');
  });

  await check('/setup serves the wizard page', async () => {
    const r = await s.page('/setup');
    assert.strictEqual(r.status, 200);
    assert.ok(/setup code/i.test(r.text), 'the page does not ask for the setup code');
  });

  await check('a wrong setup code saves nothing', async () => {
    const r = await s.post('/api/setup', { code: 'WRONGCODE', adminKey: ADMIN, hallKey: HALL });
    assert.ok(r.error, 'a wrong code was accepted');
    assert.ok(!fs.existsSync(path.join(s.dir, 'keys.json')), 'a wrong code still wrote keys.json');
  });

  await check('an admin key under 16 characters is refused, even with the right code', async () => {
    const r = await s.post('/api/setup', { code, adminKey: 'short', hallKey: HALL });
    assert.ok(r.error && /16/.test(r.error), 'a short admin key was accepted: ' + JSON.stringify(r));
  });

  await check('a hall key under 8 characters is refused, even with the right code', async () => {
    const r = await s.post('/api/setup', { code, adminKey: ADMIN, hallKey: 'abc' });
    assert.ok(r.error && /8/.test(r.error), 'a short hall key was accepted: ' + JSON.stringify(r));
  });

  await check('the right code with good keys saves them, and both work straight away', async () => {
    const r = await s.post('/api/setup', { code, adminKey: ADMIN, hallKey: HALL });
    assert.ok(r.ok, 'setup failed: ' + JSON.stringify(r));
    const list = await s.post('/api/admin/list', { key: ADMIN });
    assert.ok(!list.error, 'the new admin key does not open /admin: ' + list.error);
    const hall = await s.post('/api/host/create', { kind: 'hall', key: HALL, label: 'Hall' });
    assert.ok(!hall.error, 'the new hall key does not open a hall: ' + hall.error);
    assert.strictEqual((await s.get('/api/setup/status')).needed, false);
  });

  await check('setup cannot be run a second time to take the site over', async () => {
    const r = await s.post('/api/setup', { code, adminKey: 'someone-elses-admin-key-123', hallKey: 'Zz9Zz9Zz' });
    assert.ok(r.error, 'a second setup run was accepted');
    const list = await s.post('/api/admin/list', { key: ADMIN });
    assert.ok(!list.error, 'the original admin key stopped working');
  });

  await check('keys.json is written where only the server can read it', () => {
    const mode = fs.statSync(path.join(s.dir, 'keys.json')).mode & 0o777;
    assert.strictEqual(mode, 0o600, 'keys.json is mode ' + mode.toString(8));
  });

  await stopKeep(s.proc);

  /* Same data directory, fresh process: a redeploy with the volume attached. */
  const again = boot(3382, {}, s.dir);
  await again.ready();
  await check('saved keys survive a restart, and no new setup code is printed', async () => {
    assert.ok(!codeIn(again.log()), 'a configured server printed a setup code');
    const list = await again.post('/api/admin/list', { key: ADMIN });
    assert.ok(!list.error, 'the saved admin key was lost on restart');
  });
  await stopKeep(again.proc);

  /* A Railway variable beats the file. */
  const envWins = boot(3383, { ADMIN_KEY: 'the-railway-variable-admin-key' }, s.dir);
  await envWins.ready();
  await check('a Railway ADMIN_KEY wins over the saved one', async () => {
    assert.ok(!(await envWins.post('/api/admin/list', { key: 'the-railway-variable-admin-key' })).error,
      'the Railway variable was ignored');
    assert.ok((await envWins.post('/api/admin/list', { key: ADMIN })).error,
      'the saved key still opens /admin although a Railway variable is set');
  });
  await check('the saved hall key still works when only ADMIN_KEY comes from Railway', async () => {
    const hall = await envWins.post('/api/host/create', { kind: 'hall', key: HALL, label: 'Hall' });
    assert.ok(!hall.error, 'the saved hall key was dropped: ' + hall.error);
  });
  await cleanupServer(envWins.proc, s.dir);

  /* Railway variables already set: nothing to do, and the door stays shut. */
  const preset = boot(3384, { ADMIN_KEY: 'a-preset-admin-key-0123', HALL_KEY: 'Pq8Rs7Tu' });
  await preset.ready();
  await check('with both keys set in Railway there is no setup code and no setup', async () => {
    assert.ok(!codeIn(preset.log()), 'a setup code was printed although both keys are set');
    assert.strictEqual((await preset.get('/api/setup/status')).needed, false);
    const r = await preset.post('/api/setup', { code: 'ANYTHING1', adminKey: ADMIN, hallKey: HALL });
    assert.ok(r.error, 'setup was accepted on an already configured server');
  });
  await cleanupServer(preset.proc, preset.dir);

  /* A setup code chosen in Railway (SETUP_CODE) is used instead of a random one,
     so it can be read from the Variables tab rather than the logs. */
  const chosen = boot(3385, { SETUP_CODE: 'MYCODE2026' });
  await chosen.ready();
  await check('SETUP_CODE from Railway is the code the wizard accepts', async () => {
    const r = await chosen.post('/api/setup', { code: 'mycode2026', adminKey: ADMIN, hallKey: HALL });
    assert.ok(r.ok, 'the chosen SETUP_CODE was refused: ' + JSON.stringify(r));
  });
  await cleanupServer(chosen.proc, chosen.dir);

  /* The template asks for both keys on Railway's deploy page, but Railway
     cannot check a length. A too-short ADMIN_KEY must not leave the site with
     no way in: it is ignored, said so in the log, and setup opens as the backup. */
  const tooShort = boot(3386, { ADMIN_KEY: 'short-key', HALL_KEY: 'Pq8Rs7Tu', SETUP_CODE: 'BACKUP2026' });
  await tooShort.ready();
  await check('a too-short ADMIN_KEY from Railway is ignored and setup opens as the backup', async () => {
    assert.ok(/ADMIN_KEY is only 9 characters/.test(tooShort.log()), 'no warning about the short admin key');
    const st = await tooShort.get('/api/setup/status');
    assert.strictEqual(st.needed, true, 'setup did not open');
    assert.strictEqual(st.hallFromRailway, true, 'the valid Railway hall key was not recognised');
    const r = await tooShort.post('/api/setup', { code: 'BACKUP2026', adminKey: ADMIN });
    assert.ok(r.ok, 'setup refused an admin-only save when the hall key is already set: ' + JSON.stringify(r));
    assert.ok(!(await tooShort.post('/api/admin/list', { key: ADMIN })).error, 'the admin key chosen at setup does not work');
  });
  await cleanupServer(tooShort.proc, tooShort.dir);

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
