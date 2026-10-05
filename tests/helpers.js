/* Pull a function straight out of public/index.html so tests pin the shipped
   code, not a copy of it. The app is one self-contained file with no build
   step, so there is nothing to import. */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'public', 'index.html');

/* `file` defaults to the student app; public/screen.html carries its own
   inline code and is pulled out the same way. */
function extractFn(name, file) {
  const src = fs.readFileSync(file || APP, 'utf8');
  // matches `function name(...) {` or `async function name(...) {` through the closing brace at column 0
  const re = new RegExp('^(async )?function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('could not find function ' + name + '() in ' + (file || APP));
  return m[0];
}

/* `file` is optional and defaults to the student app, exactly as extractFn's
   does — existing callers pass two arguments and are unaffected. The host
   console carries its own inline code and is pulled out the same way. */
function loadFn(name, deps, file) {
  deps = deps || {};
  const keys = Object.keys(deps);
  const body = extractFn(name, file) + '\nreturn ' + name + ';';
  return new Function(...keys, body)(...keys.map(k => deps[k]));
}

function extractConst(name) {
  const src = fs.readFileSync(APP, 'utf8');
  // matches `const name = { ... };` — const declarations use [\\s\\S]* (non-greedy)
  // to avoid matching past the closing brace at column 0
  const re = new RegExp('^const ' + name + ' = (\\{[\\s\\S]*?\\n\\});', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('could not find const ' + name + ' in public/index.html');
  return m[1];  // return just the value, not the declaration
}

function loadConst(name) {
  // eval() of a const declaration returns undefined; wrap the value in parens
  // so eval returns the object itself, not the declaration side-effect
  const src = extractConst(name);
  return eval('(' + src + ')');
}

/* Spawn-based tests kill a child server and then rmSync its data directory.
   kill() only sends the signal — it returns before the child has actually
   exited. The child's SIGTERM handler persists synchronously (and a pending
   debounced autosave can also land) before it calls process.exit(), so an
   rmSync that starts the instant kill() returns can race a write into the
   directory it is mid-delete on, throwing ENOTEMPTY. Waiting for the child's
   real 'exit' event serializes the two: once 'exit' has fired, process.exit()
   in the child has abandoned any other in-flight I/O, so nothing can touch
   the directory again. A short safety timer covers the case where 'exit'
   never fires, so a hung child fails the test instead of hanging the suite
   in its place.

   A child that crashed at startup (its port was already taken, say) has
   usually already emitted 'exit' by the time a test gets around to tearing
   it down — registering server.once('exit', …) at that point waits for an
   event that has been and gone, and never fires. Checking exitCode/
   signalCode first catches that case synchronously instead of hanging. The
   safety timer is deliberately NOT unref'd: an unref'd timer lets Node exit
   the moment nothing else is pending, which is exactly what happens when the
   'exit' listener above is the orphaned one — the process would exit 0
   before the timer ever got a chance to fire, and a test file whose server
   never even started would report nothing and "pass". Keeping it ref'd means
   the process cannot exit while a teardown is still outstanding — a genuinely
   hung child still fails loudly at the 2s mark instead of hanging forever,
   and a child that died before teardown even started can no longer be lost
   to the same race. */
function teardownServer(server, dataDir, onDone) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    fs.rmSync(dataDir, { recursive: true, force: true });
    onDone();
  };
  if (server.exitCode !== null || server.signalCode !== null) {
    // already gone — the 'exit' event fired before we got here
    finish();
    return;
  }
  const t = setTimeout(finish, 2000);
  server.once('exit', () => { clearTimeout(t); finish(); });
  server.kill();
}

// For a test's final teardown: returns a done(code) that kills the server,
// waits for it to actually exit, cleans up its data dir, then process.exit()s.
function makeDone(server, dataDir) {
  return (code) => teardownServer(server, dataDir, () => process.exit(code));
}

// For cleaning up a secondary server mid-test, where the test must keep
// running afterward rather than exit the process. Await the returned promise.
function cleanupServer(server, dataDir) {
  return new Promise(resolve => teardownServer(server, dataDir, resolve));
}

/* Most tests want a country in a room quickly, and joining by room code is the
   shortest path to one. A classroom now opens with that door shut (newRoom in
   server.js), so a fixture that relies on it has to turn it on — which is the
   point: a test joining by room code IS exercising open joining, and saying so
   in one place keeps that visible instead of hiding behind a default that has
   already changed once.

   `post` is passed in because each test file builds its own against its own
   port. */
async function openClassRoom(post, body) {
  const room = await post('/api/host/create', Object.assign({ kind: 'class' }, body || {}));
  if (room.error) throw new Error('fixture could not open a classroom room: ' + room.error);
  const r = await post('/api/host/act', { room: room.room, hostKey: room.hostKey, act: 'openjoin' });
  if (r.error) throw new Error('fixture could not turn open joining on: ' + r.error);
  return room;
}

module.exports = { extractFn, loadFn, extractConst, loadConst, APP, teardownServer, makeDone, cleanupServer,
                   openClassRoom };
