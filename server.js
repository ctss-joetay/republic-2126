/* ============================================================
   REPUBLIC 2126 — main server (zero dependencies)
   Rooms live in memory and are mirrored to a small JSON file, so a
   cohort can build their countries one day and play the mass game
   the next.
   ============================================================ */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const crypto = require('crypto');
const E      = require('./game_engine.js');
/* The hall's scenario deck. Server-only on purpose — see hall-scenarios.js. */
const { HALL, STRIKES } = require('./hall-scenarios.js');

const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOMS  = new Map();          // roomCode -> room

/* Every leader code and every view code in the process, in one index.
   Codes used to be checked unique inside a room but looked up across all of
   them, which was harmless with one room and hands a group somebody else's
   country once each form teacher has their own. Both kinds share the namespace,
   so a view code can never collide with another country's leader code either. */
const CODES = new Map();   // CODE -> { room, team, role:'leader'|'view' }

/* Every public id in the process, kept apart from CODES on purpose. A pid is
   not a credential — findTeam() must never resolve one — so it is never
   registered in CODES. It still has to be excluded from the same draw as
   codes, or a freshly minted leader code could equal an already-published
   pid and the leaderboard would be publishing a live credential again. */
const PIDS = new Set();

function reg(roomCode, teamCode, c, role){ if(c) CODES.set(c, { room:roomCode, team:teamCode, role }); }
function unregTeam(t){
  if(t.code) CODES.delete(t.code);
  if(t.viewCode) CODES.delete(t.viewCode);
  /* The ministry codes too, or shrinking a class leaves four live credentials
     in CODES pointing at a country that no longer exists — findTeam's self-heal
     would fire on them, which is correct behaviour for a bug and no reason to
     ship one. */
  for(const m of MINISTRIES) if(t.minCodes && t.minCodes[m]) CODES.delete(t.minCodes[m]);
  if(t.pid) PIDS.delete(t.pid);
}
function regRoom(room){ for(const t of Object.values(room.teams)){
  reg(room.code, t.code, t.code, 'leader'); reg(room.code, t.code, t.viewCode, 'view');
  /* Every registration pass a room goes through — a server restart's restore()
     chief among them — starts from an empty CODES map, so a team that already
     HAS four ministry codes needs them put back here or they simply stop
     resolving the moment the process comes back up. Distinct from Task 3's
     backfill: that mints codes for a team that never had any; this re-registers
     codes a team already carries. */
  if(t.minCodes) for(const m of MINISTRIES) if(t.minCodes[m]) reg(room.code, t.code, t.minCodes[m], m);
  if(t.pid) PIDS.add(t.pid); } }
function unregRoom(room){ for(const t of Object.values(room.teams)) unregTeam(t); }
/* The one way a room is ever removed. Deleting it without purging leaves codes
   pointing at a room that is gone. */
function dropRoom(room){ unregRoom(room); ROOMS.delete(room.code); markDirty(); }
function freeCode(n){ let c; do { c = code(n); } while(CODES.has(c) || PIDS.has(c)); return c; }
/* Never register a pid with reg() — that would let findTeam(pid) succeed and
   turn a public identifier back into a credential, inverting the point of
   having one. */
function freePid(){ let c; do { c = code(5); } while(CODES.has(c) || PIDS.has(c)); PIDS.add(c); return c; }

const code = n => E.makeCode(n, Math.random);

/* empos is used as an object-key lookup client-side (flagSVG's
   FLAG_POS[c.empos]) — an unvalidated string here (e.g. 'constructor') can
   crash the shared leaderboard for the whole room. stripe drives an if/else
   chain instead, so it cannot trigger the same crash, but it is validated
   the same way for consistency: a country's saved fields should only ever
   hold values the UI actually offers. */
const STRIPE_VALUES = new Set(['solid','horiz','vert','diag']);
const EMPOS_VALUES  = new Set(['centre','left','right','tleft','tright']);

/* ---------------- surviving the night ----------------
   Groups build their countries in their own classroom one day and play the
   mass game in the hall on another, so a room has to outlive the lesson —
   and any restart in between. Every change is written to one small JSON file
   a moment later, and that file is read back when the server boots.

   Mount a Railway volume at /data and the room also survives a redeploy;
   without one it still survives a plain restart. Nothing here is personal
   data: country names, the choices a group made, and a five-letter code. */
const DATA_DIR = process.env.DATA_DIR ||
                 (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const STORE    = path.join(DATA_DIR, 'rooms.json');
const TTL_DAYS = Number(process.env.ROOM_TTL_DAYS) || 14;
const MAX_AGE  = 1000*60*60*24*TTL_DAYS;

/* ---------------- one process per volume ----------------
   Room codes are unique because newRoom() redraws while ROOMS already holds the
   code — but ROOMS lives in one process's memory. A second process against the
   same volume draws from its own empty map, so it can mint a code the first one
   is already using, and the two are invisible to each other.

   The collision is the small half of it. persist() serialises [...ROOMS.values()]
   and renames the result over rooms.json, so two processes do not merge — each
   writes its whole world over the other's. Last save wins and the loser's rooms
   are simply gone, mid-lesson, with nothing in any log to say why.

   Nothing in code could stop that: the fix is Railway's Replicas = 1, which the
   deploy guide already mandates. What code CAN do is notice, so a setting
   changed months from now by someone who never read the guide announces itself
   at boot instead of during a hall session with 300 students in it.

   Deliberately a warning, not a refusal. A false positive — a stale file from an
   unclean shutdown, a clock skew — would take the whole game down, which is a
   worse failure than the one being guarded. Set ROOM_STRICT_SINGLETON=1 to make
   it fatal instead, once you have seen it behave on your own infrastructure. */
const BEAT_FILE   = path.join(DATA_DIR, 'instance.json');
const BEAT_EVERY  = 10000;
/* Three missed beats. Two is a GC pause or a slow disk; three means gone. */
const BEAT_STALE  = BEAT_EVERY * 3;
const STRICT_ONE  = process.env.ROOM_STRICT_SINGLETON === '1';

function readInstance(now){
  try{
    const raw = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8'));
    const beat = Number(raw && raw.beat);
    if(!beat) return null;
    /* A beat from the future is a clock that moved, not a live instance. Treat
       it as live anyway — the whole point is to be loud about the ambiguous
       case rather than to guess our way past it. */
    return { pid:raw.pid, beat, age: now - beat };
  }catch(e){ return null; }   // missing or unreadable: nothing is holding it
}

function writeInstance(){
  try{
    fs.mkdirSync(DATA_DIR, { recursive:true });
    fs.writeFileSync(BEAT_FILE, JSON.stringify({ pid:process.pid, beat:Date.now() }));
    return true;
  }catch(e){ return false; }  // never let bookkeeping stop the server booting
}

/* Returns what it found so a test can assert on it without parsing logs. */
function claimInstance(now){
  now = now || Date.now();
  const held = readInstance(now);
  const live = !!held && held.age < BEAT_STALE;
  if(live){
    const msg = `another server (pid ${held.pid}) wrote ${BEAT_FILE} ${Math.round(held.age/1000)}s ago`;
    if(STRICT_ONE){
      console.error(`✋ refusing to start: ${msg}.`);
      console.error('   Two processes on one volume overwrite each other\'s rooms wholesale.');
      console.error('   Set Replicas to 1 in Railway → Settings → Deploy, or unset ROOM_STRICT_SINGLETON.');
      process.exit(1);
    }
    console.error('');
    console.error('🚨 ANOTHER SERVER IS USING THIS DATA DIRECTORY.');
    console.error(`   ${msg}.`);
    console.error('   Room codes are only unique within one process, and saving is not merged —');
    console.error('   each process writes its whole room list over the other\'s. Rooms WILL be lost.');
    console.error('   Fix: Railway → Settings → Deploy → Replicas = 1, then redeploy.');
    console.error('');
  }
  writeInstance();
  return { warned: live, stale: !!held && !live, held };
}

function releaseInstance(){
  /* Only if it is still ours. A second process that took over after we were
     declared stale owns the file now, and deleting it would blind a third. */
  try{
    const raw = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8'));
    if(raw && raw.pid === process.pid) fs.unlinkSync(BEAT_FILE);
  }catch(e){}
}

/* One secret, guarding the only control in this app that can delete a whole
   cohort's work. Fails closed: unset or weak and no admin route answers at all,
   because a missing environment variable must never be the thing leaving it open. */
/* Each key comes from a Railway variable when one is set and long enough, and
   otherwise from keys.json on the data volume, which only the first-run setup
   page (/setup, below) writes. The variable always wins, so a teacher who
   types a key into Railway later gets exactly that key. applyKeys() runs at
   boot and again the moment setup saves. */
const ENV_ADMIN = String(process.env.ADMIN_KEY || '');
const ENV_HALL  = String(process.env.HALL_KEY || '');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
let ADMIN_KEY = '', ADMIN_ON = false, HALL_KEY = '', HALL_ON = false;
function readSavedKeys(){
  try { const k = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); return (k && typeof k === 'object') ? k : {}; }
  catch(e){ return {}; }
}
function applyKeys(){
  const saved = readSavedKeys();
  ADMIN_KEY = ENV_ADMIN.length >= 16 ? ENV_ADMIN : String(saved.adminKey || '');
  ADMIN_ON  = ADMIN_KEY.length >= 16;
  HALL_KEY  = ENV_HALL.length >= 8 ? ENV_HALL : String(saved.hallKey || '');
  HALL_ON   = HALL_KEY.length >= 8;
}
applyKeys();
let adminFails = 0;

/* The passcode for opening a hall. Deliberately separate from ADMIN_KEY so that
   whoever runs the event does not thereby gain /admin's room listing, exports
   and imports. */
/* Eight, not the sixteen ADMIN_KEY demands. They guard different things: the
   admin key opens every room's export and import, while this one opens a hall
   — and it has to be short enough that whoever runs the event can type it from
   a note without a fuss. Eight random alphanumerics is 62^8, which no amount of
   guessing gets through; eight HUMAN-chosen ones are usually a word, which is
   why failed attempts are slowed down below. Pick something random. */
let hallFails = 0;

/* First-run setup. A fresh deploy with no admin key would otherwise have no
   admin panel and no way to open a hall, and a school deploying the Railway
   template may well leave both variables blank. So the server prints a
   one-time setup code to its own deploy log, and POST /api/setup accepts the
   two keys only with that code. The code is what stops whoever reaches the
   public URL first from claiming the site. SETUP_CODE may be set in Railway
   instead, so it can be read from the Variables tab. Setup is only open while
   there is no admin key; once one exists it is shut for good, and keys are
   changed in Railway's Variables from then on. */
const SETUP_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let SETUP_CODE = '';
let setupFails = 0;
const setupNeeded = () => !ADMIN_ON;
if(setupNeeded())
  SETUP_CODE = String(process.env.SETUP_CODE || '').trim().toUpperCase()
    || Array.from(crypto.randomBytes(10), x => SETUP_ALPHA[x % SETUP_ALPHA.length]).join('');
function setupCodeOk(code){
  if(!SETUP_CODE) return false;
  const a = Buffer.from(String(code || '').trim().toUpperCase(), 'utf8');
  const b = Buffer.from(SETUP_CODE, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/* Written to a temp file and renamed, so a crash mid-write cannot leave a
   half file that reads back as "no keys" and reopens setup. 0600: nobody but
   the server process reads it. */
function saveKeys(adminKey, hallKey){
  const tmp = KEYS_FILE + '.tmp';
  fs.mkdirSync(DATA_DIR, { recursive:true });
  fs.writeFileSync(tmp, JSON.stringify({ adminKey, hallKey, savedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, KEYS_FILE);
}

/* Every wrong hall passcode doubles the wait for the next one — 250ms, 500ms,
   1s, 2s, 4s, capped at 8s from the sixth on. Its own counter, separate from
   adminFails: a student hammering the hall door must not slow a teacher's
   admin access, and neither must lock the other out. A correct passcode is
   never delayed, because hallKeyOk() returns before this is ever called, and
   one success clears the count. */
const hallDeny = async (msg) => {
  const delay = 250 * Math.pow(2, Math.min(hallFails, 5));
  hallFails++;
  await new Promise(r=>setTimeout(r, delay));
  return { error: msg };
};

function adminOk(key){
  if(!ADMIN_ON) return false;
  const a = Buffer.from(String(key||''), 'utf8');
  const b = Buffer.from(ADMIN_KEY, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if(ok){ adminFails = 0; return true; }
  return false;
}

/* May this caller open a hall?

   A hall's host key deals scenario cards without limit, so opening one is the
   moment to ask. A classroom is not gated — teachers open their own rooms all
   day, and gating that would be a worse problem than the one this closes.

   ADMIN_KEY is accepted as well as HALL_KEY, on purpose. It is the stronger
   credential and is already set in production, so a HALL_KEY that nobody
   remembered to add to Railway is a recoverable mistake on the morning rather
   than an event that cannot start. If NEITHER is set, no hall opens at all —
   see the boot warning at the bottom of this file.

   adminOk() fails closed on its own and has no side effect worth avoiding: the
   escalating delay lives in a separate function, and adminOk only ever resets
   the counter, on success. Calling it here costs no attempt and grants none. */
function hallKeyOk(key){
  const k = Buffer.from(String(key||''), 'utf8');
  if(HALL_ON){
    const h = Buffer.from(HALL_KEY, 'utf8');
    if(k.length === h.length && crypto.timingSafeEqual(k, h)){ hallFails = 0; return true; }
  }
  if(adminOk(key)){ hallFails = 0; return true; }
  return false;
}
/* Every wrong guess doubles the wait for the next one — 250ms, 500ms, 1s, 2s,
   4s, capped at 8s from the sixth failure on — instead of the hard 60-second
   lock this used to be. A ≥16-character key already makes brute force
   hopeless at a handful of guesses a second, so the escalation alone is
   plenty; a hard lock instead turned the one control that can rescue a
   broken event into something anyone who merely knows roughly when it starts
   can deny outright — ten *parallel* wrong guesses locked it in under 400ms,
   since adminOk() above increments before this ever awaits. Worse, a locked
   teacher saw the same "Wrong admin key" whether they mistyped or someone
   else was hammering the door, and would retype the same correct key into
   the same wall. adminOk() returns the moment a key matches, before this
   function ever runs, so the correct key is never delayed and never locked
   out — however many failures came before it — and one success erases every
   prior failure (adminFails = 0, above). */
const adminDeny = async () => {
  const delay = 250 * Math.pow(2, Math.min(adminFails, 5));
  adminFails++;
  await new Promise(r=>setTimeout(r, delay));
  return { error: ADMIN_ON ? 'Wrong admin key.' : 'The admin panel is not enabled on this server.' };
};

/* the board cache is rebuilt on demand, so it never needs saving */
function snapshot(room){
  const out = {};
  for(const k in room) if(k[0] !== '_') out[k] = room[k];
  return out;
}
const payload = () => JSON.stringify({ v:1, saved:Date.now(), rooms:[...ROOMS.values()].map(snapshot) });

let saveTimer = null, saving = false, again = false, saveGen = 0;
function persist(){
  if(saving){ again = true; return; }
  saving = true;
  const gen = ++saveGen;
  const body = payload();
  fs.mkdir(DATA_DIR, { recursive:true }, () => {
    /* write beside the real file and rename, so a crash mid-write can never
       leave a half-finished save where the good one used to be */
    fs.writeFile(STORE + '.tmp', body, err => {
      if(err){ saving = false; return console.error('⚠️  could not save rooms:', err.message); }
      /* persistNow() (below) bumps saveGen when it runs a synchronous save of
         its own — an admin delete or wipe that cannot wait for this debounce.
         If that happened while this write was in flight, `body` above is
         stale (captured before whatever persistNow() just removed), and
         renaming it over STORE now would silently resurrect it. gen !==
         saveGen means exactly that race happened: drop this write instead of
         completing it — persistNow() already wrote the current state. */
      if(gen !== saveGen){
        saving = false;
        /* Abandoned: nothing will ever rename this file anywhere. Left
           behind it just sits there until the next persist() happens to
           overwrite the same path — a whole extra store-sized file on a
           volume that may not have room to spare for one. */
        fs.unlink(STORE + '.tmp', () => {});
        if(again){ again = false; markDirty(); }
        return;
      }
      fs.rename(STORE + '.tmp', STORE, err2 => {
        saving = false;
        if(err2){
          /* Otherwise dropped for good: `again` only gets set by a mutation
             that lands WHILE this save is in flight, so a rename failure on
             a room nothing else touches afterward would never be retried —
             not on the usual debounce, not ever, until something unrelated
             happens to call persist() again. markDirty() here means a
             transient failure (a hiccup on Railway's network-backed volume,
             say) still self-heals on the next debounce instead of silently
             losing the write. */
          console.error('⚠️  could not save rooms:', err2.message);
          markDirty();
        }
        /* gen matched the instant this rename was dispatched, above — but
           the rename itself finishes on the threadpool, not synchronously,
           and a persistNow() can land in that gap: write and rename its own
           correct, current state to STORE, and then have THIS rename —
           already in flight, unaware anything changed — complete right
           after it and silently overwrite that correct state with this
           call's now-stale one. No error either way; fs.rename succeeds
           whichever file wins. Checking saveGen again here, after the
           rename has actually finished, is the only way to notice: if it no
           longer matches, a persistNow() ran inside the window and this
           call's rename just clobbered it, so redo persistNow() immediately
           to put the current state back rather than leaving the debounce to
           correct it 1.5s (or a crash) later. */
        else if(gen !== saveGen){ persistNow(); }
        if(again){ again = false; markDirty(); }
      });
    });
  });
}
/* twenty groups pressing "we are ready" at once should cost one write */
function markDirty(){
  if(saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 1500);
  saveTimer.unref?.();
}
/* The synchronous escape hatch for admin/delete and admin/wipe: a crash in
   the 1.5s debounce window would otherwise bring a just-deleted room back
   from disk on restart. Bumping saveGen makes an in-flight persist() drop
   its own stale rename instead of completing it (see above); the separate
   temp filename below is what keeps that same in-flight persist() from
   corrupting THIS call's write in the meantime. Together they make this
   genuinely the last word on disk, not merely the fastest one. */
function persistNow(){
  /* Redundant-write optimisation, not a correctness guard: persist() itself
     only ever evaluates payload() when its debounce timer actually fires
     (markDirty() → setTimeout → persist()), so a pending timer this cancels
     can never fire on stale data — it would have called payload() fresh, the
     same as this call is about to. This purely skips a save that would have
     duplicated the one persistNow() is doing right now. */
  if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
  saveGen++;
  try{
    fs.mkdirSync(DATA_DIR, { recursive:true });
    /* A DIFFERENT temp name from persist()'s STORE+'.tmp', not the same one —
       saveGen (above) only ever protected the rename, not the write. persist()
       writes its temp file asynchronously; if this call and persist()'s write
       shared one path, this writeFileSync could truncate that same inode out
       from under persist()'s still-open, in-flight file descriptor, and
       persist()'s write (of stale, pre-delete data) would land inside the
       inode this call had just pointed STORE at via rename — resurrecting
       whatever this call just deleted, with the rename-side guard never even
       coming into play because fs.rename() genuinely was never reached by the
       corrupted write. Two fixed, distinct names are enough because each
       function only ever has one writer of its own in flight at a time —
       persist() is serialised by the `saving` flag above, and persistNow()
       is fully synchronous. */
    fs.writeFileSync(STORE + '.now.tmp', payload());
    fs.renameSync(STORE + '.now.tmp', STORE);
  }catch(e){ console.error('⚠️  final save failed:', e.message); }
}
/* Shared by restore() (a full process reboot) and POST /api/host/import (a
   teacher's backup file) — both can hand back a room saved by an older
   build, or, for import, one exported by the very build this shipped in,
   a moment before pid existed. Doing the migration once means neither
   entry point can drift from the other. */
function migrateTeam(t){
  if(t.viewCode == null) t.viewCode = '';
  if(t.slot == null) t.slot = 0;
  if(t.locked == null) t.locked = false;
  if(t.renameAsked == null) t.renameAsked = false;
  if(t.rejectedName == null) t.rejectedName = '';
  if(t.origin === undefined) t.origin = null;
  if(t.arrived === undefined) t.arrived = null;
  /* Absence AND shape, same discipline as room.usedScenarios: a country saved
     before programmes existed has no such key, and a hand-edited backup could
     carry something that is not an array. Either way it comes back having
     bought nothing, rather than throwing on the first .includes() mid-hall. */
  if(!Array.isArray(t.programmes)) t.programmes = [];
  /* Absence AND shape. A country saved before Spec D has no such key, and a
     hand-edited backup could carry a string or a negative. Either way it comes
     back with nobody displaced — the safe direction, because the alternative
     is a country permanently short of workers with no way to find out why.
     Math.floor, not just a type check: a fractional displaced would leak into
     housed() and make free() non-integral for the rest of the game. */
  if(typeof t.displaced !== 'number' || !isFinite(t.displaced) || t.displaced < 0) t.displaced = 0;
  else t.displaced = Math.floor(t.displaced);
  /* A displaced flooring can land on 0 (a negative or fractional legacy
     value), and t.struck is a separate field this backfill never touches —
     without this call a restored country can carry a struck record with
     nobody displaced, exactly the "permanently flagged as struck" state
     clearIfRecovered() exists to prevent (see its own comment, above
     strikeCountry). */
  clearIfRecovered(t);
  /* Absence AND shape, same discipline as programmes above but with a sharper
     reason: a missing or malformed flag must read as OPEN. A room written
     before this build carries no mandate at all, and if that came back
     undefined every gate below would refuse — one restore would freeze every
     minister in the hall for the rest of the game. Each key is defaulted
     independently, so a half-written object cannot close a door either. */
  if(!t.mandate || typeof t.mandate !== 'object') t.mandate = {};
  for(const k of E.MANDATE_FLAGS) if(typeof t.mandate[k] !== 'boolean') t.mandate[k] = true;
  /* Absence, not falsiness. A team saved by current code already carries
     pid:'' — not yet assigned — and must be left alone for the provisioning
     path to fill. A team with no such key at all was saved before pid
     existed. Now that boardRow() publishes pid instead of code, defaulting
     it to the team's own leader code (the old behaviour, when boardRow
     still published code and the two were interchangeable) would publish
     that code on every device's leaderboard the moment this room loads.
     Mint it a real, freshly drawn one instead. */
  if(t.pid == null) t.pid = freePid();
}
/* A legacy room's allies[] and offers[].from/.to were recorded before pid
   existed, so they hold leader codes — exactly what boardRow() and the
   offers filter no longer accept. The map has to be built before any of it
   is rewritten, and keyed by each team's ORIGINAL code, so an entry that is
   already a pid (a room saved after this fix) simply has no key to match
   and passes through unchanged. */
function migrateRoom(room){
  /* Absence, not falsiness — same discipline as migrateTeam()'s pid guard.
     A room with no `kind` key at all predates the classroom/hall split
     entirely: every room behaved like today's open-joining hall-that-
     accepts-joins, so it must come back exactly that way, openJoin:true
     included, or "no flag day" is broken the moment this ships against
     whatever is already sitting in Railway's volume. A room that DOES carry
     a `kind` (even one saved by a build after kind existed but before
     openJoin did) is a different generation — for that one openJoin still
     derives from kind, the same way newRoom() sets it for a brand-new room. */
  const hadKind = 'kind' in room;
  if(!room.kind) room.kind = 'hall';
  if(room.label == null) room.label = '';
  /* This deliberately no longer tracks newRoom(), which now opens every room
     closed. Restoring is not creating: a room saved by a build in that window
     genuinely had open joining on, and silently closing it would strand a class
     that is mid-lesson and joining by room code. Both branches restore the
     room as it actually behaved; a teacher who wants it shut presses the
     console's own lever, which is one click and says what it did. */
  if(room.openJoin == null) room.openJoin = hadKind ? (room.kind === 'class') : true;
  if(room.practiceLeft == null) room.practiceLeft = 0;
  /* Absence AND shape: a room saved before the deck tracked what it had dealt
     has no such key, and a hand-edited or half-written backup could carry
     something that is not an array. Either way the room comes back with a full
     deck rather than one that throws on the first .includes(). */
  if(!Array.isArray(room.usedScenarios)) room.usedScenarios = [];
  /* Absence AND shape, for the same reason as usedScenarios above: a room
     saved before the hall's decisions were recorded has no such key, and a
     hand-edited backup could carry something that is not an array. Either
     way the room comes back with an empty history rather than throwing on
     the first push, mid-hall, on the round path. */
  if(!Array.isArray(room.results)) room.results = [];
  /* A room saved before the discussion window existed has no stamp, and 0
     reads as "not discussing" — so it comes back behaving exactly as it did,
     and the very next card it is dealt gets a window like any other. */
  if(typeof room.decideAt !== 'number') room.decideAt = 0;
  /* A room restored or migrated from before maxRounds existed would otherwise
     leave it undefined — and room.round >= undefined is false forever, so
     the hall round cap this branch added becomes a silent no-op instead of
     ever refusing a round. */
  if(room.maxRounds == null) room.maxRounds = E.GAME.rounds;

  /* A bare {} inherits Object.prototype, so `'toString' in codeToPid` is
     true even though nothing ever put a 'toString' key there — asPid()
     would substitute Object.prototype.toString (a function) for that
     allies[] entry instead of leaving it unchanged. allies.length is not
     affected; the damage is a function sitting where a pid string belongs,
     which JSON-serialises to null on the next save. A null-prototype object
     has no such members, so `in` only ever matches a key this loop actually
     set. */
  const codeToPid = Object.create(null);
  for(const t of Object.values(room.teams)){
    migrateTeam(t);
    /* A country saved by a build whose /api/join minted no class code comes
       back with none, and its group is stuck sharing the leader code for the
       rest of the room's life. Mint one here so a restart heals a room that
       is already in the volume — a teacher mid-lesson does not have to
       rebuild their class.

       Registered right here rather than left to regRoom(), which has already
       run by the time any caller reaches this line (see restore() and
       /api/host/import): a code nothing registered opens nothing. Empty
       string, not absence — blankCountry() has always carried viewCode:'',
       and provisioning fills it in the same breath, so a saved team still
       holding '' is one of the join-made countries this repairs. */
    if(!t.viewCode){
      t.viewCode = freeCode(5);
      reg(room.code, t.code, t.viewCode, 'view');
    }
    /* The same repair, one layer up. A country saved before ministries had
       codes comes back with none, and its four ministers scan into nothing.
       Registered right here rather than left to regRoom(), which has already
       run by the time any caller reaches this line (see restore() and
       /api/host/import): a code nothing registered opens nothing.

       Per-ministry rather than all-or-nothing, so a country half-repaired by
       an interrupted earlier load still comes out whole. */
    if(!t.minCodes) t.minCodes = {};
    for(const m of MINISTRIES){
      if(!t.minCodes[m]){
        t.minCodes[m] = freeCode(5);
        reg(room.code, t.code, t.minCodes[m], m);
      }
    }
    codeToPid[t.code] = t.pid;
  }
  const asPid = v => (v in codeToPid) ? codeToPid[v] : v;

  /* Both allies and offers are filtered against the room's actual, current
     pids — not merely rewritten. A backup can be hand-edited, or simply
     stale, and list an ally that resolves to nobody left in the room; left
     in, that is a permanent, fabricated bump to the ally bonus
     (roundIncome's allyBonus is 1 + min(3, allies.length)*0.07 — three fake
     entries are +21% forever). Filtering by livePids also strips any
     surviving prototype-member value from the hazard above, belt and
     braces on top of the null-prototype fix. */
  const livePids = new Set(Object.values(room.teams).map(t=>t.pid));
  for(const t of Object.values(room.teams)){
    if(Array.isArray(t.allies)) t.allies = t.allies.map(asPid).filter(p => livePids.has(p));
  }
  /* An alliance is only ever struck mutually — trade/respond's ally branch
     pushes both pids at once, never one alone — so if one side's allies[]
     still names the other after the filter just above, the other side must
     name it back too. Left unrepaired, a room saved while moveTeam()'s own
     one-directional bug (final-review finding "NEW-1") was still live would
     come back one-sided forever, restart after restart, even once the
     runtime bug is fixed: a saved snapshot does not un-corrupt itself. This
     closes the same hole for restore()/host/import that the symmetric push
     in moveTeam() below closes for a live migration. */
  const byPid = Object.create(null);
  for(const t of Object.values(room.teams)) byPid[t.pid] = t;
  for(const t of Object.values(room.teams)){
    if(!Array.isArray(t.allies)) continue;
    for(const pid of t.allies){
      const other = byPid[pid];
      if(other && Array.isArray(other.allies) && !other.allies.includes(t.pid)) other.allies.push(t.pid);
    }
  }
  if(Array.isArray(room.offers)){
    room.offers = room.offers
      .map(o => ({ ...o, from:asPid(o.from), to:asPid(o.to) }))
      .filter(o => livePids.has(o.from) && livePids.has(o.to));
  }
  /* Deliberately NOT setting `origin`. A room with no origin key predates
     provenance entirely, and trusted() reads absence as trusted — nobody can
     retroactively create a room in the past. Stamping these 'self' would strand
     a teacher's live room mid-lesson; stamping them 'admin' would be a lie. */
  return room;
}
function restore(){
  try{
    if(!fs.existsSync(STORE)) return;
    const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    const now = Date.now(); let n = 0, teams = 0;
    for(const r of (data.rooms || [])){
      if(!r || !r.code || !r.teams) continue;
      if(now - (r.touched || 0) > MAX_AGE) continue;
      /* Rooms written before this build carry none of the new fields. Defaulting
         them to what they already behaved like means no flag day: an old room
         keeps working exactly as it did.

         regRoom() runs BEFORE migrateRoom(), not after. migrateRoom() mints a
         fresh pid (via freePid()) for any team that has none, and freePid()
         excludes only what is already in CODES/PIDS at the moment it draws.
         If this room's own leader and view codes are not registered yet, a
         freshly minted pid can equal one of them — publishing a live leader
         code on the leaderboard under the name "pid". reg() is an idempotent
         Map.set, so registering codes migrateRoom leaves untouched costs
         nothing. */
      regRoom(r);
      migrateRoom(r);
      ROOMS.set(r.code, r); n++; teams += Object.keys(r.teams).length;
    }
    if(n) console.log(`↩️  restored ${n} room(s) and ${teams} countries from ${STORE}`);
  }catch(e){ console.error('⚠️  could not read saved rooms:', e.message); }
}
/* ---------------- room helpers ---------------- */
function newRoom(kind, label, origin){
  let c; do { c = code(4); } while(ROOMS.has(c));
  const isClass = kind === 'class';
  const room = {
    code:c, kind: isClass ? 'class' : 'hall', label:String(label||'').slice(0,24),
    /* Where this room came from. 'admin' means a teacher was handed it; 'self'
       means somebody opened /host, which anyone can do. Only the SOURCE room's
       origin is ever read — see trusted() and pullCountry(). */
    origin: origin === 'admin' ? 'admin' : 'self',
    hostKey:code(8), phase:'prep', round:0, maxRounds:E.GAME.rounds,
    scenario:null, scenarioRound:0, teams:{}, offers:[], feed:[], trades:[],
    /* Cards already dealt in this room. The hall console takes a thrown card
       off its list, so this is what stops a reload — or resuming on another
       laptop the next day — from offering it again. Emptied only by the
       game master's own deck reset. A classroom never reads it: its single
       drill is governed by practiceLeft. */
    usedScenarios:[],
    /* What each card the hall played was decided by, one row per card, in
       the order they were thrown. Written by closeCard() and read only by
       GET /api/host/results, which refuses until the game has been called.
       A classroom never gets a row: its single drill is a rehearsal. */
    results:[],
    /* When deciding opens on the card now showing, or 0 when none is. Stamped
       by pushScenario, read by every guard through discussing(). */
    decideAt:0,
    /* Joining by room code is what lets one group mint a second country and
       trade with itself. A hall room never needs it — countries arrive by
       migration. A classroom no longer starts with it either: a room code is
       projected, so anything it opens is open to whoever reads the screen, and
       the ordinary flow is that a teacher provisions groups and hands out the
       leader and class codes. The console's own "Allow open joining" is the way
       back for a latecomer or a group that lost both codes. */
    openJoin: false,
    practiceLeft: isClass ? 1 : 0,
    /* The countdown is stored as the wall-clock instant it ends, not as a
       number of seconds ticking down. A server-side interval would drift, would
       not survive a restart, and would have to be pushed to every device; an
       end time is one number every client can subtract from its own clock and
       reach the same answer. null means no clock is running. */
    timerEndsAt:null, timerSecs:0,
    rev:1, created:Date.now(), touched:Date.now()
  };
  ROOMS.set(c, room);
  return room;
}
/* Absence is trust. See migrateRoom()'s closing comment for why. */
function trusted(room){ return room.origin !== 'self'; }
function getRoom(c){ const r = ROOMS.get(String(c||'').toUpperCase().trim()); if(r) r.touched = Date.now(); return r; }
function findTeam(teamCode){
  const tc = String(teamCode||'').toUpperCase().trim();
  const e = CODES.get(tc); if(!e) return null;
  /* Under correct operation this pair of self-heals is unreachable: dropRoom
     purges CODES proactively, and nothing else removes a team from
     room.teams. If either fires it means CODES drifted out of sync with
     reality — worth a loud warning, because the alternative is a code that
     mysteriously stops working with no trace of why. */
  const room = ROOMS.get(e.room);
  if(!room){ console.warn(`⚠️  CODES pointed ${tc} at room ${e.room}, which no longer exists — dropping it`); CODES.delete(tc); return null; }
  const team = room.teams[e.team];
  if(!team){ console.warn(`⚠️  CODES pointed ${tc} at team ${e.team} in room ${e.room}, which no longer exists — dropping it`); CODES.delete(tc); return null; }
  /* a room with students actively polling it is not an idle room */
  room.touched = Date.now();
  return { room, team, role:e.role };
}
const teamByPid = (room, pid) => Object.values(room.teams)
  .find(t => t.pid === String(pid||'').toUpperCase().trim()) || null;

/* ---------- who may do what ----------

   Four ministries, spelled exactly as blankCountry() spells them in members,
   split and picks. One table rather than a role check per route, because the
   same question is asked from six routes and a table is the only version of
   this that can be read in one sitting.

   Everything here fails closed. An unknown role — a typo, a stale client, a
   role string from a saved room written by an older build — must lock a device
   out, never open one up. That is why every function tests for MEMBERSHIP of a
   list rather than absence from one.

   The leader is a superset of every ministry, deliberately. A group that never
   hands out a ministry code has to keep playing exactly as it did before this
   existed, and that fallback is the only thing standing between a bad hall and
   a cancelled one. */
const MINISTRIES = ['edu', 'def', 'trade', 'infra'];

/* An act is a route, not a field. `save` is here so a ministry can reach
   /api/team/save at all; WHAT it may write once inside is mayWrite/mayPick. */
const ACT_ROLES = {
  save:   ['leader', ...MINISTRIES],
  trade:  ['leader', 'trade'],
  ally:   ['leader', 'def'],
  /* A single offer that carries BOTH an alliance and goods is a distinct act
     from either alone — Trade and Defence each hold one of the two acts
     below, and neither holds both, so this list has exactly one name on it.
     That is deliberate, not an oversight: it is what makes a combined offer
     the Leader's one-iPad fallback rather than a loophole either ministry
     can reach alone (see offerAct() below). */
  'ally+trade': ['leader'],
  choose: ['leader'],
  commit: ['leader'],
  hall:   ['leader'],
  /* Education alone, plus the Leader as always. Programmes are the hall's only
     coin sink, and coins are absent from FIELD_OWNER precisely so that no
     client can write them through a bulk save — this act is the one door. */
  programme: ['leader', 'edu']
  ,
  /* The Leader alone. This is the one act that changes what everybody ELSE
     may do, so it is deliberately not shared with any ministry. */
  mandate: ['leader'],
  /* Spec D. Defence is the right hand thematically: the minister whose
     defences just failed is the one who has to go and ask. It is also the only
     new job Defence has had in the whole arc — Spec B gave them no fifth tab.
     Aid is goods and coins, and Spec C established that those are never gated,
     so it is Trade's alongside the Leader. Both lists name the Leader
     explicitly because mayAct fails closed. */
  appeal: ['leader', 'def'],
  aid:    ['leader', 'trade']
};

/* Flat country fields only. picks is per-ministry and goes through mayPick.
   A field present in this table belongs to the owner named. The leader can write
   any owner's field. A ministry can write only its own. A field absent from this
   table — homeland (dealt by the server, never writable) and meters (computed) —
   is unreachable by every role including the leader. This is what keeps both
   dealHomeland()'s classroom balancing and the computed meters safe from accidental
   writes inside bulk-update paths. */
const FIELD_OWNER = {
  name:'leader', motto:'leader', emblem:'leader', col1:'leader', col2:'leader',
  stripe:'leader', empos:'leader', members:'leader', split:'leader', ready:'leader',
  buildings:'infra', industries:'trade'
};

function mayAct(role, act){
  return (ACT_ROLES[act] || []).includes(role);
}
function mayWrite(role, field){
  const owner = FIELD_OWNER[field];
  if(!owner) return false;
  if(role === 'leader') return true;
  if(!MINISTRIES.includes(role)) return false;
  return owner === role;
}
function mayPick(role, ministry){
  if(!MINISTRIES.includes(ministry)) return false;
  return role === 'leader' || role === ministry;
}

/* What the student reads. Each one names who CAN do the thing, because a
   refusal that only says no leaves five students looking at each other. */
const MINISTRY_NAME = { edu:'Education', def:'Defence', trade:'Trade & Industry',
                        infra:'Infrastructure & Home Affairs' };
function refusal(role, act){
  if(role === 'view')
    return 'That is the class code — it watches your country, it does not drive it.';
  if(act === 'ally')   return 'Alliances are the Defence Minister\'s to propose.';
  if(act === 'trade')  return 'Sending goods is the Trade Minister\'s job.';
  if(act === 'ally+trade')
    return 'A ministry offer is one or the other, not both — propose the alliance and send the goods as two separate offers. Only your Leader can combine them in one.';
  if(act === 'choose') return 'Only your Leader can answer the card.';
  if(act === 'commit') return 'Only your Leader can commit your country.';
  if(act === 'hall')   return 'Only your Leader can take your country to the hall.';
  if(act === 'programme') return 'Education programmes are the Education Minister\'s to run.';
  if(act === 'mandate') return 'Only your Leader can set what the cabinet may do.';
  if(act === 'appeal') return 'Asking your allies for help is the Defence Minister\'s to do.';
  if(act === 'aid')    return 'Sending help costs goods and coins — that is the Trade Minister\'s job.';
  return 'Your Leader has to do that one.';
}

/* What act a trade offer actually is, given what it carries. Takes anything
   shaped like { ally, give, want, coins } — the raw POST body on the way in
   (untrusted, fields may be missing or non-numeric) or a stored offer on the
   way out (already sanitised numbers) both work, because every read here is
   guarded the same defensive way either input needs.

   ally:true alone is 'ally' — Defence's. Goods/coins with no ally is 'trade'
   — Trade's. Both together is a third, distinct act ('ally+trade', see
   ACT_ROLES) that only the Leader holds: without this, ally:true silently
   REPLACED the goods check instead of adding to it, so a Defence Minister
   filling in give/want/coins alongside the checkbox moved resources under
   Defence's authority alone — exactly the two-student split this whole task
   exists to enforce, defeated by one field. */
function offerAct(o){
  const give = o.give || {}, want = o.want || {};
  /* !== 0, not > 0. The real guard against a negative quantity is the clamp
     where /api/trade/offer parses give/want (Math.max(0, ...), same as
     coins already was) — by the time anything reaches here, nothing should
     be negative. This is the second line of defence, not the first: `> 0`
     would silently reclassify a still-negative give/want as "no goods",
     which is exactly how a Defence Minister moved stock alone with
     ally:true before the clamp existed. Testing !== 0 means a value that
     slips past the clamp some other way (a stored offer read back from an
     old snapshot, a future call site that forgets it) still counts as
     goods and still needs Trade, instead of quietly reopening the bypass. */
  const hasGoods = ['W','M','F'].some(k => (+give[k]||0) !== 0 || (+want[k]||0) !== 0)
    || Math.max(0, +o.coins||0) > 0;
  if(o.ally) return hasGoods ? 'ally+trade' : 'ally';
  return 'trade';
}

/* The one guard every write path runs. The member UI greys its inputs, but that
   is decoration — a code is all a browser needs to POST, so the refusal has to
   live here. */
function writable(f, act, allowCommitted){
  if(!f) return { error:'Country code not found.' };
  /* Was a single "not the class code" test. It is now a question about the
     specific act, because six roles reach these routes and each may do a
     different subset — see MINISTRIES and ACT_ROLES above. Fails closed: an
     act nobody is listed for refuses everyone, including the leader. */
  if(!mayAct(f.role, act)) return { error: refusal(f.role, act) };
  /* `locked` means nation-building is closed, not that the country is frozen
     forever. Scoped to prep: the moment a country carries into the hall
     (Task 8's moveTeam does not, and must not, clear locked — it is the
     historical record of a proper commit), phase flips to 'game' and this
     branch must get out of the way, or every committed country in the hall
     is refused every scenario choice and trade offer — the entire mass game,
     telling students to undo the very step that got them there. */
  /* `allowCommitted` exists for exactly one caller: the classroom drill, which
     runs AFTER commit by design. It moves meters only — the coin component is
     zeroed for a classroom, and the meters are put back from a snapshot when
     the card closes — so letting a committed country answer it costs nothing
     and takes nothing back. Every other write path still refuses. */
  if(!allowCommitted && f.team.locked && f.room.phase === 'prep')
    return { error:'Your country is committed. Ask your teacher to reopen it.' };
  return null;
}

/* The name to put in a refusal. The sentence names a PERSON, not a ministry —
   "Kai has closed building" is what sends one student across the table, and
   "Education is closed" is what makes them shrug. Falls back when a group
   never typed their Leader's name at nation-building. */
function leaderName(team){
  return String(((team.members) || {}).leader || '').trim();
}

/* The mandate gate. ACT_ROLES/mayAct answer WHO may act; this answers whether
   their Leader has left that door open. The two are orthogonal and they stack.

   The Leader is never bound by their own mandate: they set it, so binding them
   would be circular, and it would break the one-iPad fallback that a group who
   never hands out ministry codes depends on.

   `!== false` and not `=== false` inverted: absent, malformed, half-written or
   otherwise unexpected data all read as OPEN. That single operator is what
   guarantees a country whose mandate never arrived can still play — which is
   the difference between a group having a quiet game and four students
   holding dead iPads.

   Returns null to proceed, or the sentence to refuse with. */
function mandateBlock(team, role, flag){
  if(role === 'leader') return null;
  if(((team.mandate) || {})[flag] !== false) return null;
  const raw = leaderName(team);
  const who = raw || 'Your Leader';
  const ask = raw || 'them';
  return `${who} has closed ${E.MANDATE_WHAT[flag]}. Go and ask ${ask}.`;
}

/* Merge incoming counts UPWARD and move the meters by what was added. Hall
   only — the prep paths still replace wholesale, because during nation-
   building a group is meant to be able to take a building back.

   Why upward and not replace: saveBody() (public/index.html:5266) posts the
   whole country on every Leader autosave, from a device whose copy is only as
   fresh as its last poll. Under replace-semantics, that echo deletes whatever
   a minister built in the seconds since — measured live, see the comment at
   public/index.html:5281. max() makes the echo idempotent, and makes two
   ministers building at the same time converge instead of one clobbering the
   other. It is also why the hall can safely let ministers post these fields at
   all.

   applyFx, never foundingMeters: foundingMeters rebuilds the whole meter set
   from scratch and would erase every scenario effect and every round of drift.

   FOUND_SCALE is applied because a building has a prep equivalent — without it
   a group is rewarded for delaying construction until the hall, where the same
   building would hit harder. */
function growCounts(team, field, incoming, defs){
  const cur = team[field] || {};
  const next = { ...cur };
  const added = {};
  for(const k of Object.keys(incoming || {})){
    if(!defs.some(d => d.key === k)) continue;          // unknown key: dropped, never stored
    const n = Math.floor(Number(incoming[k]) || 0);
    const was = cur[k] || 0;
    if(!(n > was)) continue;                            // equal or lower: the stale echo, ignored
    added[k] = n - was;
    next[k] = n;
  }
  team[field] = next;
  const fx = {};
  for(const k in added){
    const def = defs.find(d => d.key === k);
    for(const m in (def.fx || {})) fx[m] = (fx[m] || 0) + def.fx[m] * added[k] * E.FOUND_SCALE;
  }
  if(Object.keys(fx).length) team.meters = E.applyFx(team.meters, fx);
  return added;
}

/* team.log only, deliberately never say(room, …). Twenty countries building
   between cards would bury the regional news feed under construction notices,
   and the feed is what the projector shows. */
function logGrowth(team, round, added, defs, verb){
  for(const k in added){
    const def = defs.find(d => d.key === k); if(!def) continue;
    team.log.unshift({ round, note:`${verb} ${added[k]} × ${def.name}` });
  }
  team.log = team.log.slice(0,30);
}
/* every change to a room bumps its revision — that is what lets the polling
   endpoints answer "nothing new" with a 304 instead of resending the board */
function bump(room){ room.rev++; markDirty(); }
function say(room, text, icon){
  room.feed.unshift({ t:Date.now(), text, icon:icon||'•' });
  room.feed = room.feed.slice(0,60);
  bump(room);
}
function sweep(){
  const now = Date.now();
  for(const [k,r] of ROOMS) if(now - r.touched > MAX_AGE) dropRoom(r);
}
setInterval(sweep, 1000*60*10).unref?.();

function publicTeam(t){
  const s = E.score(t);
  return {
    pid:t.pid, name:t.name, emblem:t.emblem, col1:t.col1, col2:t.col2,
    homeland:t.homeland, ready:t.ready, coins:t.coins, meters:t.meters,
    allies:t.allies, score:s, free:E.free(t), industries:t.industries,
    chosen:t.chosen||null, members:t.members, programmes:t.programmes, mandate:t.mandate
  };
}

/* The leaderboard row every other country sees. With 50 groups in one room
   this row is sent 50 times in every single poll, so it carries only what the
   student and teacher screens actually draw — no member lists, no spare
   resources, no per-pillar breakdown. Your own country arrives in full
   separately, under `team`.

   pid, never code. A leader code is a credential now; putting one on a
   leaderboard every device polls would let any student drive any country. */
function boardRow(t){
  const s = E.score(t);
  return {
    pid:t.pid, name:t.name, emblem:t.emblem, col1:t.col1, col2:t.col2,
    coins:t.coins, meters:t.meters, allies:t.allies,
    ready:!!t.ready, chosen:!!t.chosen,
    /* Spec D. The count so an ally's aid card can say how many are still
       displaced, and the icon so a leaderboard row can wear a badge. The
       strike's TITLE and STORY stay off this row deliberately — every device
       in the room reads the board, and a country that was not hit must not be
       handed the copy. Same discipline the row already keeps with pids
       instead of codes. */
    displaced:t.displaced || 0,
    strk:(t.struck && t.struck.icon) || '',
    score:{ overall:s.overall, balance:s.balance }
  };
}
/* Everything the renderer needs to draw a country, and nothing else.

   Deliberately NOT boardRow: this is fetched once when somebody opens a city,
   not fifty times in every poll, so it can afford homeland, industries, picks
   and buildings — the four fields that decide what the island actually looks
   like. Deliberately not publicTeam either: no members, no stock, no chosen,
   no free, and above all no code and no viewCode. A leader code is a
   credential; this route is readable by every device in the room.

   motto is the one field here that is not already on boardRow. It is the
   country's own public slogan, written to be read out, and the projector
   overlay is exactly where it is meant to appear. */
function cityRow(t){
  return {
    pid:t.pid, name:t.name, motto:t.motto, emblem:t.emblem, col1:t.col1, col2:t.col2,
    homeland:t.homeland, meters:t.meters, industries:t.industries,
    picks:t.picks, buildings:t.buildings, coins:t.coins, allies:t.allies,
    score:E.score(t)
  };
}
function board(room){
  if(room._boardRev === room.rev) return room._board;
  room._board = Object.values(room.teams).filter(t=>String(t.name||'').trim()).map(boardRow)
    .sort((a,b)=> b.score.overall - a.score.overall);
  room._boardRev = room.rev;
  return room._board;
}

/* The teacher's own view of their class. Carries the codes, so it may only ever
   be returned from a host-authenticated route — never from /api/room, which
   any device in the room can read. */
function rosterOf(room){
  return Object.values(room.teams)
    .sort((a,b)=> (a.slot||0) - (b.slot||0))
    .map(t=>({ slot:t.slot, code:t.code, viewCode:t.viewCode, minCodes:t.minCodes, pid:t.pid,
               homeland:t.homeland, name:t.name, ready:!!t.ready,
               locked:!!t.locked, renameAsked:!!t.renameAsked }));
}

/* Deals whichever homeland this room currently has the fewest of, tied
   broken by the homeland's own position in HOMELANDS. For a freshly
   provisioned room every count starts at zero, so this walks HOMELANDS in
   order exactly as a plain round-robin on slot number would — every
   assertion written against that round-robin still holds.

   The difference only shows up after a shrink. Slots are never renumbered,
   so keying the deal to slot number (slot-1)%HOMELANDS.length leaves a
   permanent hole: shrink away the group that had Isles, and no group will
   ever be dealt Isles again even after growing back — two groups end up
   sharing a homeland (identical shortages, so trade between them is
   pointless) while a whole homeland vanishes from the class. Counting what
   the room actually holds right now, instead of trusting slot arithmetic,
   self-heals a shrink-then-grow instead of leaving a scar. */
function dealHomeland(teams){
  const counts = new Map(E.HOMELANDS.map(h=>[h.key, 0]));
  for(const t of teams) if(counts.has(t.homeland)) counts.set(t.homeland, counts.get(t.homeland)+1);
  let best = E.HOMELANDS[0];
  for(const h of E.HOMELANDS) if(counts.get(h.key) < counts.get(best.key)) best = h;
  return best.key;
}

/* ---------------- game actions ---------------- */
/* The stockpiling half of a round's yield. Extracted rather than copied into
   dealMaterials(): a duplicated loop would drift the day an industry gains an
   output, and the classroom would quietly stop handing out something the hall
   still pays. */
function stockpile(t, detail){
  for(const d of detail){
    if(d.stalled) continue;
    const ind = E.INDUSTRIES.find(i=>i.key===d.key); if(!ind) continue;
    if(ind.out.M) t.stock.M = (t.stock.M||0) + ind.out.M*d.n;
    if(ind.out.F) t.stock.F = (t.stock.F||0) + ind.out.F*d.n;
  }
}

/* A classroom trades but does not earn. No coins, no round bump, no drift and
   no indecision penalty — none of those belong to a lesson that is still in
   nation-building. */
function dealMaterials(room){
  for(const t of Object.values(room.teams)){
    stockpile(t, E.roundIncome(t).detail);
    t.log.unshift({ round:room.round, note:'Trade materials delivered' });
    t.log = t.log.slice(0,30);
  }
  say(room, 'Trade materials delivered. Trade them before the next card.', '📦');
}

/* What the hall decided about the card that is closing, as a snapshot.

   A snapshot and not a live count, because the room does not hold still:
   countries migrate into a hall mid-game, get rescued into it, and get
   removed from it. Recomputing this later would attribute a card to a room
   that did not exist when it was thrown.

   The scenario key on `chosen` is checked, not merely its presence. A country
   that answered the previous card and has not answered this one still carries
   the old decision until advanceRound wipes it — counting that as an answer
   here would put a country in a bar it never chose.

   `arrived === room.round` is excused for the same reason advanceRound excuses
   it from the indecision penalty: that country migrated in after this card was
   dealt and was never asked it. It is not undecided, and it is not in the
   denominator either.

   null, not an empty row, when there is nothing to tally — the callers use
   that to stay silent rather than write a row per round. */
function tallyCard(room){
  if(!room || !room.scenario || room.kind === 'class') return null;
  const counts = {};
  let undecided = 0;
  for(const t of Object.values(room.teams)){
    if(t.chosen && t.chosen.scenario === room.scenario){
      counts[t.chosen.choice] = (counts[t.chosen.choice] || 0) + 1;
    } else if(t.arrived !== room.round){
      undecided += 1;
    }
  }
  const chosen = Object.values(counts).reduce((s,n)=>s+n, 0);
  return { key:room.scenario, round:room.round, counts, undecided, total:chosen + undecided };
}

/* Called from every place a card stops being open, and from nowhere else.

   Once per DEALING, which is not the same as once per call. advanceRound
   wipes every chosen but deliberately leaves room.scenario set — the card a
   hall has just finished stays on the console until the next one is thrown.
   So the three call sites can genuinely fire twice on one card: Next round
   tallies it, and then throwing the next card arrives to find that same
   card still open with every decision gone, and would record it a second
   time as a card nobody answered.

   room.scenarioTallied is what makes that exact, rather than guessed at from
   the last row's key: pushScenario clears it as it deals, so each dealing of
   a card gets one row even when the same card is dealt again after a deck
   reset. Found by playing a hall by hand — the unit tests null room.scenario
   themselves, which is what act:'clear' does and advanceRound does not.

   Reads and appends. It writes no meter, no coin and no pre-existing game
   field, which is the whole reason it is safe on the round path: the worst
   outcome of a bug here is a wrong number on a chart after the game is over. */
function closeCard(room){
  const row = tallyCard(room);
  if(!row || room.scenarioTallied) return;
  room.scenarioTallied = true;
  if(!Array.isArray(room.results)) room.results = [];
  room.results.push(row);
}

/* One helper, two call sites — advanceRound's decay and /api/aid/send. Both
   are places displaced can reach 0, and two copies of the same three lines is
   how a country ends up permanently flagged as struck with nobody displaced:
   a banner on every tab, and an appeal button that refuses. */
function clearIfRecovered(t){
  if((t.displaced || 0) <= 0){ t.displaced = 0; delete t.struck; }
}

/* One phrase, four sites: the log note and the appeal line in this file,
   strikeFeedLines below, and host.html's strikeRoll (which keeps its own
   copy — this file is not shipped to the browser). All four used to word the
   same event differently, and none of them pluralised — "1 people lost their
   homes" was what a lightly-defended country actually read on the wall. */
function lostHomesPhrase(n){
  return n === 1 ? '1 person lost their home' : `${n} people lost their homes`;
}

/* One country, one strike. Mutates the country and returns the row the feed
   and the projected roll both read.

   Exposure, not a flat cost: a country at 60 or above in the shielding meter
   is scratched and nothing else, which is the moment a Defence Minister's
   spending pays off in public, in front of the room.

   The cap binds on the RUNNING TOTAL against capacity(), not on this hit. A
   single hit can never exceed a third on its own — exposure is at most 1 — so
   a cap written as a min against one hit would be arithmetically dead. The
   case it has to survive is a game master striking the same country twice.

   capacity(), not housed(): housed() already subtracts displaced, so sizing
   the next hit off it would feed the damage formula its own output and the
   cap would stop meaning a third of anything. */
function strikeCountry(t, kind, round){
  /* Both branches below write one row to the country's own log and trim it
     to the same 30 entries every other writer of t.log already trims to
     (buildings, trades, scenarios, programmes — see the other t.log.unshift
     call sites in this file). Local, not hoisted to file scope: nothing else
     needs it, and every other call site's shape is close enough to this one's
     but not identical that a shared helper would need a parameter for what
     amounts to "sometimes there are coins too" — not worth it for two calls. */
  const note = (extra) => {
    t.log.unshift({ round, ...extra });
    t.log = t.log.slice(0,30);
  };

  const shield   = Number((t.meters || {})[kind.shield]);
  /* /30, not /60. Founding meters land between 38 and 76 against the 60
     threshold below, so a /60 divisor confined real exposure to [0, 0.37] —
     the top two-thirds of the range was unreachable, and combined with
     Math.ceil every country from Defence 42 to 59 took the identical single
     displaced person. workerPull (roundIncome) only bites once a country is
     at full employment, and real countries carry 2-5 spare workers, so the
     income penalty this spec is built around never fired. At /30, Defence 61
     still holds the line, 45 goes from 0.25 to 0.50 exposure, and typical
     displaced moves from 1 to 3-4 — enough for workerPull to bite and for
     recovery to cost two rounds instead of none. */
  const exposure = E.clamp((60 - (isFinite(shield) ? shield : 50)) / 30, 0, 1);
  if(exposure <= 0){
    /* Recorded, not skipped. "Held the line" is the most instructive line on
       the wall and the roll has to carry it. */
    note({ note:`${kind.title} — your defences held. Nothing was lost.` });
    /* t.struck is deliberately left untouched here, not just unwritten by
       omission. It is not a log of events — Task 5's clearIfRecovered()
       deletes it the instant displaced reaches 0, so its only job is to
       describe the damage a country is CURRENTLY living with. A hold does no
       damage: a country still displaced from an earlier strike that then
       holds the line against this one is still living with that earlier
       strike, and the banner built from t.struck (student app, Task 9) has
       to keep saying so. Overwriting it here would replace a real, ongoing
       casualty count with an event that cost nothing, and the banner only
       renders while displaced > 0 — so it would show a "nothing happened"
       headline over a real number. The room-wide "this just happened" signal
       for a hold belongs to room.lastStrike and the feed (Task 4), which
       carries every roll, held ones included — the point of a hold is that
       the room sees it, not that the holder's own banner changes. */
    return { name:t.name, displaced:0, coins:0, held:true };
  }
  const cap  = Math.ceil(E.capacity(t) / 3);
  const hit  = Math.ceil(E.capacity(t) * exposure / 3);
  const was  = t.displaced || 0;
  t.displaced = Math.min(was + hit, cap);
  const lost  = t.displaced - was;

  const coins = Math.min(t.coins, Math.round(t.coins * 0.10 * exposure));
  t.coins -= coins;

  const fx = {};
  for(const m in kind.fx) fx[m] = Math.round(kind.fx[m] * exposure);
  t.meters = E.applyFx(t.meters, fx);

  /* The copy travels with the country, so a phone renders the strike without
     ever being sent the table. /api/state returns `mine = team` whole, so this
     reaches the struck country's own devices and no other — the secrecy is a
     consequence of where the field is stored, not of a route filtering it. */
  t.struck = { kind:kind.key, icon:kind.icon, title:kind.title, line:kind.line,
               displaced:t.displaced, coins, fx, round, t:Date.now() };
  note({ coins:-coins, note:`${kind.title} — ${lostHomesPhrase(lost)}` });
  return { name:t.name, displaced:lost, coins, held:false };
}

/* Turns one strike's roll into the lines the projected feed says, in the
   order they must be SAID — not the order they end up on screen. say()
   (below) unshifts, so whatever is said last lands newest-on-top; the
   headline is therefore last in the array this returns, not first, so a
   reader looking at the top of the wall sees what happened before its
   detail rather than the tail of a roll with no heading over it.

   FEED_LINE_CAP is chosen from what the room needs to read, not from any
   test's fixture size. The whole point of a per-country line is that when a
   country holds the line, the room sees THAT COUNTRY named — it is the
   clearest argument this game can make for spending on Defence, and it is
   why the roll names holders as well as casualties. The common play pattern
   is a game master ticking two or three checkboxes, occasionally more; a
   named strike is realistically single digits. 9 sits comfortably above
   that, so every country a game master plausibly names by hand is listed
   individually — nobody's hold or loss is a coin flip between being shown
   and being folded. The fold below exists only to stop a large RANDOM throw
   (tens of countries, hall scale) from evicting the rest of room.feed's
   60-line cap; it does not, and must not, care whether targets came from
   pids or random — a game master can tick every box just as easily as
   asking for everyone at random, so the cap is flat and cannot be dodged by
   which input route was used.

   Deliberately self-contained: no closures over `say`, `room`, or the
   module-level STRIKES/E — tests/strike.test.js pulls this exact function
   out of the file with loadFn and runs it standalone, at whatever N proves
   both sides of the cap, without spinning up a room or fixture countries at
   all. */
function strikeFeedLines(kind, hits){
  const FEED_LINE_CAP = 9;
  const shown = hits.slice(0, FEED_LINE_CAP);
  const lines = shown.map(h => ({
    text: h.held
      ? `${h.name} held the line. Nothing was lost.`
      /* Not lostHomesPhrase() — this function is deliberately self-contained
         (see the comment above it: no closures over say/room/STRIKES/E, so
         tests/strike.test.js can pull it out standalone with loadFn and no
         deps). Same wording, kept in sync by hand rather than by a shared
         call. */
      : `${h.name} — ${h.displaced === 1 ? '1 person lost their home' : `${h.displaced} people lost their homes`}, ${h.coins} coins gone.`,
    icon: h.held ? '🛡️' : '💔'
  }));
  if(hits.length > FEED_LINE_CAP){
    const rest = hits.slice(FEED_LINE_CAP);
    const held = rest.filter(h => h.held).length;
    lines.push({
      text: `…and ${rest.length} more — ${held} held the line, ${rest.length - held} took losses.`,
      icon: kind.icon
    });
  }
  lines.push({ text:`${kind.icon} ${kind.title.toUpperCase()} — ${kind.line}`, icon:kind.icon });
  return lines;
}

function advanceRound(room){
  /* A country that never decided on the open card pays for the indecision. This
     has to happen BEFORE round is bumped and chosen is cleared, or there is no
     longer any way to tell who ducked it. Only counts when a card was actually
     open — the first round opens with none, and nobody should be punished for
     failing to answer a question that was never asked. */
  /* A card whose discussion window never elapsed was never answerable: the
     server refused every decision for its whole life. Penalising that is
     punishing the room for a rule the room obeyed. Same shape as the
     `arrived === room.round` exemption just below — the game does not charge
     anyone for missing a question they could not answer.

     This can only ever WITHHOLD a penalty. Nothing here applies one that
     would not have been applied before. */
  if(room.scenario && !discussing(room, Date.now())){
    for(const t of Object.values(room.teams)){
      /* A country that migrated in mid-round was never asked this card either
         — t.arrived is stamped with the hall's round at the moment it arrived,
         so this only exempts the round it arrived on. The very next round it
         is judged exactly like everyone else. */
      if(t.chosen || t.arrived === room.round) continue;
      t.meters = E.applyFx(t.meters, E.INDECISION.fx);
      t.log.unshift({ round:room.round, note:`Could not agree on the scenario — Stability and Harmony suffered` });
      say(room, `${t.name} ${E.INDECISION.note}.`, '⚠️');
    }
  }
  /* After the indecision loop and BEFORE round is bumped and chosen is
     wiped — both of those destroy the thing being counted. */
  closeCard(room);
  room.round += 1;
  for(const t of Object.values(room.teams)){
    /* Spec D. Before income, deliberately: decaying afterwards would charge a
       country for people who had already gone home. Two a round means an
       unhelped country climbs out over three or four rounds and the hall still
       finishes — aid is how you get your factories running THIS round instead
       of in three, which is enough to make asking worth it without leaving an
       unpopular group crippled to the final score. */
    if(t.displaced > 0){ t.displaced = Math.max(0, t.displaced - 2); clearIfRecovered(t); }
    const inc = E.roundIncome(t);
    t.coins = Math.max(0, t.coins + inc.net);
    stockpile(t, inc.detail);
    t.meters = E.drift(t);
    t.chosen = null;
    t.round  = room.round;
    t.log.unshift({ round:room.round, coins:inc.net, note:`Round ${room.round}: earned ${inc.net} coins` });
    t.log = t.log.slice(0,30);
  }
  room.offers = room.offers.filter(o=>o.status==='pending');
  room.timerEndsAt = null;      /* the round is over; the clock stops until the next card */
  say(room, `Round ${room.round} begins — industries paid out.`, '⏱️');
}

/* Which deck a room plays from is a property of the ROOM, never of the caller.
   A classroom has exactly one card — the drill — and a hall has the eight.
   A classroom has exactly one card, the drill. A hall has the eight, and they
   come from hall-scenarios.js, which no page inlines. This is the only place
   in the server that names a deck. */
const deckFor = (room) => room.kind === 'class' ? [E.DRILL] : HALL;

/* The open card, as much of it as a device is allowed to have.

   Everything the student app draws before a decision — icon, title, story, and
   per choice its icon, label, tag and ally flag — and nothing else. `fx` and
   `coin` stay here: they reach a device only inside team.chosen, after that
   country has committed to an answer. Until this existed, every phone held the
   complete effects table and a student in devtools could read off the best
   answer to a card before it was dealt.

   null when nothing is open, so the client branches on one field. */
function publicCard(room, team){
  if(!room.scenario) return null;
  const sc = deckFor(room).find(s => s.key === room.scenario);
  if(!sc) return null;
  return {
    key:sc.key, icon:sc.icon, title:sc.title, story:sc.story,
    /* `team` is optional and deliberately so. With one, each choice carries the
       warnings that country would earn — computed from the same bite entries as
       the arithmetic, so a preview cannot disagree with what it previews.
       Without one, the card is the neutral thing the projector and the console
       show to a whole hall at once.

       fx, coin and bite stay behind either way. A phone learns what a choice
       means for its own country, in words; it never learns the table. */
    choices: sc.choices.map(c => {
      const out = { key:c.key, icon:c.icon, label:c.label, tag:c.tag, ally:!!c.ally };
      if(team) out.notes = E.biteChoice(c, team).notes;
      return out;
    })
  };
}

/* The news clipping for the card a room has open — the projector's front page.

   The filename is built from room.scenario and NEVER from anything in the
   request: there is no key parameter to pass, so this cannot be walked through
   the deck to see what is coming, and there is no caller-controlled string
   anywhere near the path join. Nothing open means 404, which is also what a
   card with no art file gets.

   That puts the picture at exactly the secrecy level publicCard() already sets
   — readable by anyone in the room the moment the card is dealt, invisible
   before — so it needs no credential of its own. A clipping IS the card, which
   is why assets/cards lives outside PUBLIC, where the static handler below
   would serve it to anyone who guessed the filename.

   ETag is keyed on the card and the file's mtime, so the projector fetches
   each image once and a redeploy invalidates it. */
const CARD_ART = path.join(__dirname, 'assets', 'cards');
function cardArt(req, res, u){
  const miss = () => { res.writeHead(404, { 'Content-Type':'text/plain' }); res.end('No card open'); };
  const room = getRoom(u.searchParams.get('room'));
  if(!room || !room.scenario) return miss();
  const key = String(room.scenario);
  /* A card key is a bare word in hall-scenarios.js and game_engine.js. Checking
     it anyway is belt and braces: it means no value of room.scenario, however
     it got there — a hand-edited backup, a future edit to the deck — can reach
     path.join with a separator or a dot-dot in it. */
  if(!/^[a-z0-9]+$/i.test(key)) return miss();
  const full = path.join(CARD_ART, key + '.jpg');
  if(!full.startsWith(CARD_ART) || !fs.existsSync(full)) return miss();
  const stat = fs.statSync(full);
  const tag  = `"a${key}-${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  const head = { 'Content-Type':'image/jpeg', 'ETag':tag,
                 'Cache-Control':'public, max-age=0, must-revalidate' };
  if(req.headers['if-none-match'] === tag){ res.writeHead(304, head); return res.end(); }
  res.writeHead(200, head);
  fs.createReadStream(full).pipe(res);
}

/* One minute where the only thing to do is argue about the card.

   The hall answered its first scenario cards heads-down in the trade panel,
   and nothing stopped them: neither trade route looks at room.scenario. Nor
   should a ban be the answer — ally choices scale with allies, alliances are
   struck through trade, so scrambling for one when a co-operative option
   appears is correct play. What was missing was a rhythm, not a prohibition. */
const DISCUSS_MS = 60000;
/* The least time a country may be left to actually answer. A game master
   running a 45-second card with a 60-second lock would otherwise make
   deciding impossible and penalise the whole hall for it. */
const DECIDE_FLOOR_MS = 15000;

/* When deciding opens. Clamped against the card's own clock, and deliberately
   allowed to land in the PAST: a clock too short to leave the floor gets no
   discussion window rather than a negative one, and a stamp already behind us
   reads as elapsed everywhere. That is what makes this impossible to hang on. */
function discussionEnd(now, timerEndsAt){
  const full = now + DISCUSS_MS;
  if(!timerEndsAt) return full;
  return Math.min(full, timerEndsAt - DECIDE_FLOOR_MS);
}
/* The single question every guard asks. Absent stamp = not discussing, so a
   room restored from before this existed behaves exactly as it used to. */
function discussing(room, now){
  return !!(room && room.decideAt) && now < room.decideAt;
}

function pushScenario(room, key){
  /* A card thrown while one is still open ends that one. Recording it first
     is the only chance — the loop below wipes every chosen. */
  closeCard(room);
  const deck = deckFor(room);
  const sc = deck.find(s=>s.key===key) || deck[room.round % deck.length];
  room.scenario = sc.key; room.scenarioRound = room.round;
  /* A fresh dealing has not been tallied yet — see closeCard. Cleared here
     and nowhere else, so the flag always describes the card now open. */
  room.scenarioTallied = false;
  for(const t of Object.values(room.teams)) t.chosen = null;
  /* Once a teacher has picked a length, every new card restarts the clock on
     its own — otherwise they would be pressing two buttons for every card,
     eight times a lesson, while also reading the scenario aloud. */
  if(room.timerSecs > 0) room.timerEndsAt = Date.now() + room.timerSecs*1000;
  /* AFTER the timer restart above, never before: that line is what sets the
     clock this window has to fit inside. timerEndsAt is only trusted while a
     length is actually set — a room whose timer was switched off can still be
     carrying a stale end time from an earlier card. */
  room.decideAt = discussionEnd(Date.now(), room.timerSecs > 0 ? room.timerEndsAt : null);
  say(room, `Scenario card: ${sc.title}`, sc.icon);
  return sc;
}

function chooseScenario(room, team, choiceKey){
  const sc = deckFor(room).find(s=>s.key===room.scenario);
  if(!sc) return { error:'No scenario is open.' };
  if(team.chosen) return { error:'Your country has already decided.' };
  if(discussing(room, Date.now())){
    const wait = Math.ceil((room.decideAt - Date.now()) / 1000);
    return { error:`Talk it through first — your cabinet can decide in ${wait}s.` };
  }
  const ch = sc.choices.find(c=>c.key===choiceKey);
  if(!ch) return { error:'Unknown choice.' };
  let fx = { ...ch.fx };
  let coin = ch.coin || 0;
  // allies make co-operative choices work better
  if(ch.ally){
    const n = Math.min(3, (team.allies||[]).length);
    if(n === 0){ coin -= 4; fx = Object.fromEntries(Object.entries(fx).map(([k,v])=>[k, Math.round(v*0.55)])); }
    else { fx = Object.fromEntries(Object.entries(fx).map(([k,v])=>[k, Math.round(v*(1 + n*0.18))])); }
  }
  /* A practice card in a class room must not move coins at all. Reversing the
     delta at commit is not an option: team.coins below is clamped at zero, so
     a group on 3 coins hit by a -5 card lands on 0, and adding 5 back at
     commit would give 5, not 3 — the clamp makes exact reversal impossible.
     Zeroing the coin component here, before it is ever applied, is the only
     way practice stays genuinely free. Scoped to kind==='class', not
     phase==='prep': a hall room is also in prep before the mass game starts,
     and trades already move coins legitimately then — only a classroom's
     cards are rehearsals. */
  /* The tilt, after ally scaling and before the classroom coin rule. Ally
     scaling is part of the BASE this is measured against — a co-operative
     choice made stronger by three allies has a correspondingly larger budget
     for its bites — and putting this above the classroom line means a
     rehearsal's bite coin is zeroed along with everything else. */
  const bite = E.biteChoice(ch, team);
  for(const k in bite.fx) fx[k] = (fx[k] || 0) + bite.fx[k];
  coin += bite.coin;
  if(room.kind === 'class') coin = 0;
  team.meters = E.applyFx(team.meters, fx);
  team.coins  = Math.max(0, team.coins + coin);
  team.chosen = { scenario:sc.key, choice:ch.key, label:ch.label, fx, coin, notes:bite.notes };
  team.log.unshift({ round:room.round, note:`${sc.title} → ${ch.label}` });
  say(room, `${team.name} chose: ${ch.label}`, ch.icon);
  return { ok:true, applied:{ fx, coin } };
}

/* ---------------- http plumbing ---------------- */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

/* Identical answers are compressed once and kept, so 50 phones polling the
   same unchanged room cost one gzip between them, not fifty.

   The entry keeps the RAW body beside the compressed one and only reuses the
   buffer when the raw bytes match. The tag alone is not enough: it is the
   room's revision, and every refusal path returns before bump(room), so two
   answers can share a tag while differing in content. Keying on the tag alone
   served the older bytes for the newer body — harmless live (a refusal really
   did change nothing) but it silently blinded every test that diffs state
   across a refusal, which is precisely how the no-mutation-without-bump()
   rule is policed. See tests/gzip-cache.test.js.

   The optimisation is untouched by this: fifty phones polling one unchanged
   room send byte-identical bodies, so they still share a single gzip. */
const GZ = new Map();
function gzip(body, tag){
  if(!tag) return zlib.gzipSync(body, { level:6 });
  const hit = GZ.get(tag);
  if(hit && hit.raw.equals(body)) return hit.buf;
  if(GZ.size > 500) GZ.clear();
  const buf = zlib.gzipSync(body, { level:6 });
  GZ.set(tag, { raw:body, buf });
  return buf;
}

function json(res, obj, status, req){
  const tag = obj && obj.__etag;
  if(tag) delete obj.__etag;

  /* the browser kept this exact answer last time — say so and send no body */
  if(tag && req && req.headers['if-none-match'] === tag){
    res.writeHead(304, { 'ETag':tag, 'Cache-Control':'private, max-age=0, must-revalidate' });
    return res.end();
  }

  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = { 'Content-Type':'application/json; charset=utf-8' };
  if(tag){ head['ETag'] = tag; head['Cache-Control'] = 'private, max-age=0, must-revalidate'; }
  else   { head['Cache-Control'] = 'no-store'; }

  const wants = String((req && req.headers['accept-encoding']) || '').includes('gzip');
  if(wants && body.length > 900){
    const packed = gzip(body, tag);
    head['Content-Encoding'] = 'gzip';
    head['Vary'] = 'Accept-Encoding';
    res.writeHead(status||200, head);
    return res.end(packed);
  }
  res.writeHead(status||200, head);
  res.end(body);
}
function readBody(req){
  return new Promise(resolve=>{
    let d=''; req.on('data',c=>{ d+=c; if(d.length>200000) req.destroy(); });
    req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); }catch(e){ resolve({}); } });
  });
}

/* One country, one room to another, codes and all. The country code is
   deliberately kept: it is the only thing a group is guaranteed to still have
   on the day, and it is globally unique so it cannot clash on arrival. */
function moveTeam(team, from, to){
  delete from.teams[team.code];
  unregTeam(team);
  /* unregTeam() was written for a team leaving the process entirely (e.g. the
     console's "remove"), so it frees the pid from the global PIDS set as a
     side-effect. A migrating team is not leaving — it is about to be filed
     under a new room code — so the pid has to be re-reserved immediately, or
     it sits unreserved in PIDS for the rest of the event: a fresh freeCode()
     could then mint a brand-new leader code equal to a pid this very country
     is publishing to every leaderboard, or a fresh freePid() could hand a
     second country the exact same public id teamByPid() is already using to
     find this one. */
  if(team.pid) PIDS.add(team.pid);
  team.origin = from.code;
  team.chosen = null;
  /* joins at the current round with what it committed — no back-pay */
  team.round  = to.round;
  /* Stamped so advanceRound's indecision penalty can tell "arrived after this
     card was asked" apart from "was here and ducked it" — see advanceRound. */
  team.arrived = to.round;
  /* An ally struck in the classroom can point to a pid that has not migrated
     to this hall (yet, or ever) — livePids the same way migrateRoom() does,
     against the room actually being arrived at. Left unfiltered, roundIncome's
     allyBonus (1 + min(3, allies.length)*0.07) keeps paying out for a
     counterparty nobody in the hall can see or trade with — up to +21%
     income, invisible, since the pid resolves to nothing on anyone's board.

     Migration happens one country at a time, so the first arrival of an
     allied pair has its own allies[] filtered against a hall that does not
     contain its ally YET — stripping it correctly at that instant, but
     leaving it stripped even once the ally arrives too, because nothing
     else ever revisits an already-migrated team. With n allied pairs both
     migrating (the ordinary Session 1 → Session 2 path this branch exists
     for), every alliance would end up one-sided, deterministically —
     contradicting the promise a committed country "arrives exactly as it
     left it." Repaired here, symmetrically: trade/respond's ally branch
     only ever pushes both pids at once, so a pid that survives THIS team's
     own filter is proof the alliance was mutual — meaning the other side is
     genuinely missing team.pid (because it migrated first, before this
     filter existed to run on it) and gets it pushed back, regardless of
     which of the pair arrived first. This can never fabricate an alliance:
     it only ever restores the other half of one the filter just confirmed
     is real. */
  if(Array.isArray(team.allies)){
    const livePids = new Set(Object.values(to.teams).map(t=>t.pid));
    team.allies = team.allies.filter(p => livePids.has(p));
    for(const other of Object.values(to.teams))
      if(team.allies.includes(other.pid) && Array.isArray(other.allies) && !other.allies.includes(team.pid))
        other.allies.push(team.pid);
  }
  to.teams[team.code] = team;
  reg(to.code, team.code, team.code, 'leader');
  reg(to.code, team.code, team.viewCode, 'view');
  /* unregTeam() above deleted all six codes from CODES, not just the leader
     and class code — so the four ministry codes need re-registering here too,
     against the destination room, or a country arrives in the hall with its
     Trade and Defence ministers' codes dead. The hall is exactly where those
     two ministers start mattering (Task 11), so this is not a theoretical gap. */
  if(team.minCodes) for(const m of MINISTRIES) if(team.minCodes[m]) reg(to.code, team.code, team.minCodes[m], m);
  say(from, `${team.name} has left for the hall.`, '✈️');
  say(to,   `${team.name} has arrived${from.label ? ' from ' + from.label : ''}.`, '🌍');
}

function pullCountry(hall, tc){
  if(hall.kind !== 'hall') return { error:'Only a hall room can bring a country in.' };
  const f = findTeam(tc); if(!f) return { error:'No country has that code.' };
  if(f.role === 'view') return { error:'That is a class code. Use the group\'s leader code.' };
  if(f.room.code === hall.code) return { ok:true, already:true, roster:rosterOf(hall) };
  /* A country already in a hall is not stranded — pulling it again would
     silently relocate it to a different hall, overwriting the origin it
     already recorded and vanishing it from the leaderboard it is on. */
  if(f.room.kind === 'hall') return { error:'That country is already in a different hall.' };
  /* A student can open /host and mint themselves a room; they cannot get what
     is inside it onto the projected leaderboard. Only the source room's origin
     matters — the hall's own is never checked, so a teacher can keep opening
     the hall from /host exactly as before. */
  if(!trusted(f.room)) return { error:'That country is not from a registered class room.' };
  if(!f.team.locked) return { error:'That country has not been committed yet.' };
  moveTeam(f.team, f.room, hall);
  return { ok:true, roster:rosterOf(hall) };
}

const routes = {
  /* What the setup page needs to draw itself — never a key, never the code. */
  'GET /api/setup/status': async () => ({
    needed: setupNeeded(), adminSet: ADMIN_ON, hallSet: HALL_ON,
    adminFromRailway: ENV_ADMIN.length >= 16, hallFromRailway: ENV_HALL.length >= 8
  }),
  'POST /api/setup': async (b) => {
    if(!setupNeeded())
      return { error: 'This server is already set up. To change a key, set ADMIN_KEY or HALL_KEY in Railway\'s Variables tab.' };
    if(!setupCodeOk(b.code)){
      /* The same doubling wait as the admin and hall doors. */
      const delay = 250 * Math.pow(2, Math.min(setupFails, 5));
      setupFails++;
      await new Promise(r => setTimeout(r, delay));
      return { error: 'That setup code is not right. Find SETUP_CODE in your Railway service\'s Variables tab, or the line SETUP CODE: in its deploy log.' };
    }
    setupFails = 0;
    const adminKey = String(b.adminKey || '').trim();
    const hallKey  = String(b.hallKey || '').trim();
    if(adminKey.length < 16 || adminKey.length > 200)
      return { error: 'The admin password needs at least 16 characters.' };
    const hallNeeded = ENV_HALL.length < 8;
    if(hallNeeded && (hallKey.length < 8 || hallKey.length > 200))
      return { error: 'The hall key needs at least 8 characters.' };
    if(hallNeeded && hallKey === adminKey)
      return { error: 'Use a different hall key from the admin password — the hall key gets handed to whoever runs the event.' };
    try { saveKeys(adminKey, hallNeeded ? hallKey : ''); }
    catch(e){ return { error: 'Could not save the keys: ' + e.message }; }
    applyKeys();
    SETUP_CODE = '';
    console.log('🔑 Setup complete — admin password and hall key saved to ' + KEYS_FILE);
    return { ok:true };
  },
  'POST /api/host/create': async (b) => {
    /* Anyone may open a classroom. A hall is the mass game, and a hall's host
       key deals scenario cards without limit — so opening one takes the event
       passcode. Until this guard existed, anyone who could reach /host could
       run the whole mass game a week early and learn every card in it. */
    if(b.kind !== 'class' && !hallKeyOk(b.key))
      return hallDeny((HALL_ON || ADMIN_ON)
        ? 'That is not the event passcode.'
        : 'Opening a hall needs the event passcode, and none is set on this server. Set it up at /setup.');
    const r = newRoom(b.kind, b.label);
    /* A room opened here is always stamped 'self' (newRoom's third argument,
       'admin', only ever comes from /api/admin/rooms) — so every classroom
       room this route opens will be refused at the hall door until someone
       trusts it from /admin. Say so plainly, once, right when it is opened,
       so a teacher finds out today rather than mid-event when a class's
       countries won't come in. */
    say(r, r.kind === 'class'
      ? `Classroom room opened${r.label ? ' for ' + r.label : ''}. Set the number of groups.${r.origin === 'self' ? ' This room was opened here, not issued from /admin, so its countries won\'t be able to join the hall until someone presses Trust this room on /admin.' : ''}`
      : 'Hall room opened. Waiting for countries to arrive…', '🚀');
    return { room:r.code, hostKey:r.hostKey, kind:r.kind, label:r.label, origin:r.origin };
  },

  'POST /api/join': async (b) => {
    const room = getRoom(b.room);
    if(!room) return { error:'No room with that code. Check with your teacher.' };
    if(room.openJoin === false)
      return { error:'This room is not open for joining. Ask your teacher for your country code.' };
    const name = String(b.name||'').trim().slice(0,28);
    if(!name) return { error:'Give your country a name.' };
    const tc = freeCode(5);
    const t = Object.assign(E.blankCountry(), { code:tc, name, homeland:b.homeland||'delta' });
    room.teams[tc] = t;
    /* tc must be registered before the class code and the pid are drawn —
       freeCode() and freePid() exclude only what is already in CODES/PIDS,
       and until reg() runs tc is in neither, so either draw could come back
       equal to this country's own leader code. */
    reg(room.code, tc, tc, 'leader');
    /* A country made here needs BOTH codes, exactly as one provisioned by
       /api/host/groups does. Until this line it got only the leader's: the
       group had nothing to hand round but the code that drives the country,
       so every iPad they read it out to came back a leader, and four devices
       edited one country through nation-building — each one's save silently
       overwriting the last, because a leader device does not mirror the
       server during prep. */
    t.viewCode = freeCode(5);
    reg(room.code, tc, t.viewCode, 'view');
    /* A country made here needs all six codes, exactly as one provisioned by
       /api/host/groups does. This is the same hole viewCode fell down: minted
       at one door and not the other, a self-made country's four ministers have
       nothing to scan and the group is back to one iPad. */
    t.minCodes = {};
    for(const m of MINISTRIES){
      t.minCodes[m] = freeCode(5);
      reg(room.code, tc, t.minCodes[m], m);
    }
    t.pid = freePid();
    t.meters = E.foundingMeters(t);
    say(room, `${name} has joined the region.`, '🌍');
    /* team:t here still carries viewCode and minCodes, unredacted. That is a
       deliberate decision, not an oversight left over from before this file
       had a redaction rule: whoever calls /api/join becomes tc's leader (reg()
       a few lines above registers tc's own code as role:'leader'), and the
       leader is the documented exception — the one who reads the class code
       and the four ministry codes out to their group, and reissues one when a
       slip goes missing. GET /api/state?code=tc would hand this same device
       the same two fields a moment later; withholding them here would only
       force an extra round trip, not close anything. */
    return { code:tc, room:room.code, team:t, phase:room.phase, round:room.round };
  },

  'POST /api/team/save': async (b) => {
    const f = findTeam(b.code); const no = writable(f, 'save'); if(no) return no;
    const { room, team, role } = f;
    const c = b.country || {};
    /* A refusal anywhere below must leave the country exactly as it was
       when this call started — not just the one field that triggered the
       refusal. public/index.html bundles the WHOLE country into every save
       and never inspects the response for .error, so a field written
       earlier in this same call (name, split, ...) before a later field
       (picks, industries, buildings) got refused used to survive the
       refusal and land anyway — a Leader who nudges the split slider past
       what a ministry had already spent got told the save failed, but the
       new split was committed regardless. One snapshot, one revert(),
       called from every refusal path in this handler, so a refusal added
       later inherits it rather than having to remember. */
    const snapshot = JSON.parse(JSON.stringify(team));
    const revert = () => Object.assign(team, snapshot);
    /* homeland is deliberately NOT in this list. It is dealt by dealHomeland()
       the moment the teacher provisions groups (POST /api/host/groups), so
       that every classroom ends up with a spread of resource shortages worth
       trading over — a group does not get to trade up to a better homeland
       just by posting one over it here. Every other field below is gated by
       mayWrite/mayPick: a field the caller does not own is dropped silently,
       never refused — a stale full copy of the country from a slow-polling
       device is normal operation, not an attack. The leader is a superset of
       every ministry (mayWrite returns true for 'leader' on any owned field),
       so a group that never hands out a ministry code plays exactly as it
       did before this existed. */
    ['motto','emblem'].forEach(k=>{ if(c[k]!=null && mayWrite(role,k)) team[k]=String(c[k]).slice(0,40); });
    /* name is handled apart from the rest: a bounced country (renameAsked)
       must not be able to reappear under the exact name the teacher just
       turned down. Before this, ANY non-blank incoming name — including the
       leader's own stale, unedited local copy, silently re-posted by
       doCommit()'s save()-then-commit sequence — was treated as proof the
       group had renamed, clearing the flag and letting the rejected name
       straight through to commit. See the 2026-07-31 rooms-and-roles
       acceptance report, Step 4. */
    if(c.name != null && mayWrite(role,'name')){
      const raw = String(c.name).slice(0,40);
      const trimmed = raw.trim();
      if(team.renameAsked && trimmed){
        /* Trimmed and case-insensitive: "Testonia", " testonia " and
           "TESTONIA" are all still the name that was just turned down. A
           match is REFUSED, not silently ignored — the whole save call
           fails with an error the client can show, so the leader's device
           learns the retype did not register, rather than typing into a
           void while the rest of the save quietly succeeds. */
        if(trimmed.toLowerCase() === String(team.rejectedName||'').trim().toLowerCase()){
          revert();
          return { error:'Your teacher asked for a different name — that one was just turned down. Type a genuinely new name.' };
        }
        team.name = raw; team.renameAsked = false; team.rejectedName = '';
      } else if(!team.renameAsked){
        team.name = raw;
      }
      /* else: renameAsked is still true and the incoming name is blank —
         either the group has not retyped anything yet, or this is the
         leader's own stale autosave echoing the server's already-blanked
         name back. Neither is a rename or a resubmitted rejection, so
         team.name and renameAsked are left exactly as they are. */
    }
    /* The two colours go straight into an SVG fill="…" on every device in the
       room, so only a literal #rrggbb is accepted. Free text here would let one
       group close the attribute and inject markup onto the shared leaderboard
       and the teacher's console. Everything a group types is escaped on output
       as well — this is the belt to that pair of braces. */
    ['col1','col2'].forEach(k=>{ if(c[k]!=null && mayWrite(role,k) && /^#[0-9a-fA-F]{6}$/.test(String(c[k]))) team[k]=String(c[k]); });
    // reject anything outside the known enum instead of trusting the client —
    // an ignored field just keeps the team's previous, already-valid value
    if(c.stripe != null && mayWrite(role,'stripe') && STRIPE_VALUES.has(c.stripe)) team.stripe = c.stripe;
    if(c.empos  != null && mayWrite(role,'empos')  && EMPOS_VALUES.has(c.empos))   team.empos  = c.empos;
    if(c.members && mayWrite(role,'members')) team.members = c.members;
    if(c.split   && mayWrite(role,'split'))   team.split   = c.split;
    /* Per ministry, never wholesale. Five devices post this field and four of
       them own exactly one key of it; `team.picks = c.picks` let whichever
       saved last delete the other three ministries' cards, with no error and
       nothing on screen to notice. A key the caller does not own is dropped
       silently — a device autosaving its own stale copy of the country is
       normal operation, not an attack. */
    if(c.picks && typeof c.picks === 'object'){
      /* Every ministry this call actually wrote — the ONLY ones the cap
         below may judge. split carries no validation against current
         spend, so a Leader lowering split.def below what Defence had
         already spent must not poison every other device's save in the
         room: Education saving its own, perfectly affordable card must
         never be told it overspent a budget it cannot see and does not
         control. A leader posting two ministries in the one call, where
         the combination busts one of them, is still caught — both land in
         `touched`. */
      const touched = [];
      for(const m of MINISTRIES){
        if(!Array.isArray(c.picks[m])) continue;
        if(!mayPick(role, m)) continue;
        /* Unknown keys dropped before the budget is ever computed — a stale
           client posting a key from a re-authored deck is not an attack, but
           an unfiltered array would let an unrecognised key ride free (it
           costs 0 in E.spent below) while still sitting in this ministry's
           saved array. That is also the hole a scenario `pick:` condition
           opens: public/host.html scans every ministry's array for a key, so
           a card key that belongs to a DIFFERENT ministry — real, just not
           this one's — must not survive into this array either. Filtering
           against E.CARDS[m] specifically (not the union of every deck)
           closes both at once. */
        const clean = c.picks[m].filter(k => E.CARDS[m].some(card => card.key === k));
        team.picks = { ...team.picks, [m]:clean };
        touched.push(m);
      }
      /* Checked on the merged result, not the incoming array, because the
         leader may post several ministries at once and a cap that only looked
         at one of them would pass a body that busts two.

         Refused, and the WHOLE country restored via revert() — not just
         picks — because whatever landed earlier in this same call (name,
         split, ...) is not this ministry's to keep just because a later
         field of the same request got refused. A minister whose cards are
         silently dropped instead has no way to tell which one went, and
         would keep re-picking it. Same shape as the industries and
         buildings reverts below. */
      for(const m of touched){
        const cap = Math.max(0, Math.floor(Number((team.split||{})[m]) || 0));
        if(E.spent(team, m) > cap){
          revert();
          return { error:`That is more points than the ${MINISTRY_NAME[m]} ministry has. You have ${cap}.` };
        }
      }
    }
    /* Three phases, and each wants something different. In 'prep' a group is
       still founding its country and may take a building back, so the incoming
       map replaces. In 'game' it merges upward and moves the meters (see
       growCounts). In 'final' the game has been called and neither field is
       writable at all — a country must not build its way up a leaderboard that
       has already been read out. Scoped on 'game' explicitly rather than
       '!== prep', because that would have let 'final' through. */
    const hall = room.phase === 'game';
    if(room.phase !== 'final'){
      if(c.industries && mayWrite(role,'industries')){
        const shut = mandateBlock(team, role, 'site');
        if(shut){ revert(); return { error:shut }; }
        let added = null;
        if(hall) added = growCounts(team, 'industries', c.industries, E.INDUSTRIES);
        else team.industries = c.industries;
        const fr = E.free(team);
        if(fr.W < 0 || fr.M < 0 || fr.F < 0){
          revert();
          return { error:'That industry plan needs more resources than your country has.' }; }
        if(added) logGrowth(team, room.round, added, E.INDUSTRIES, 'Opened');
      }
      if(c.buildings && mayWrite(role,'buildings')){
        const shut = mandateBlock(team, role, 'build');
        if(shut){ revert(); return { error:shut }; }
        let added = null;
        if(hall) added = growCounts(team, 'buildings', c.buildings, E.BUILDINGS);
        else {
          /* keep only real building keys with a sane count — an unknown key would
             sit in the saved room forever, and a negative count would hand a group
             free resources. growCounts applies the same two filters itself. */
          const clean = {};
          for(const k of Object.keys(c.buildings)){
            if(!E.BUILDINGS.some(b=>b.key===k)) continue;
            const n = Math.floor(Number(c.buildings[k])||0);
            if(n > 0) clean[k] = n;
          }
          team.buildings = clean;
        }
        const fr = E.free(team);
        if(fr.M < 0 || fr.F < 0){
          revert();
          return { error:'That building plan needs more materials or food than your country has.' }; }
        if(added) logGrowth(team, room.round, added, E.BUILDINGS, 'Built');
      }
    }
    if(room.phase === 'prep'){ team.meters = E.foundingMeters(team); }
    if(c.ready != null && mayWrite(role,'ready') && !team.ready && c.ready){ team.ready = true; say(room, `${team.name} has finished nation-building.`, '✅'); }
    else bump(room);   /* a quiet edit still changes the board */
    return { ok:true, team:publicTeam(team) };
  },

  /* Education's one act. A route of its own rather than a field on team/save,
     for a concrete reason: saveBody() re-posts the whole country on every
     autosave, so a `programmes` array arriving there would either double-charge
     or need the same upward-merge dance as buildings — and coins are
     deliberately absent from FIELD_OWNER, meaning no client can write them
     today. Keeping the spend behind its own non-idempotent route is what keeps
     that true.

     No FOUND_SCALE, unlike a hall building. A programme has no prep equivalent
     to arbitrage against, so the catalogue's numbers are exactly what it does. */
  'POST /api/edu/programme': async (b) => {
    const f = findTeam(b.code); const no = writable(f, 'programme'); if(no) return no;
    const { room, team } = f;
    const shut = mandateBlock(team, f.role, 'programme');
    if(shut) return { error:shut };
    if(room.phase !== 'game')
      return { error:'Programmes run during the mass game, between the cards.' };
    const prog = E.PROGRAMMES.find(p => p.key === b.key);
    if(!prog) return { error:'No such programme.' };
    if((team.programmes || []).includes(prog.key))
      return { error:`You have already run ${prog.name}. Each programme is a one-off.` };
    if(team.coins < prog.cost)
      return { error:`${prog.name} costs ${prog.cost} coins — you have ${team.coins}.` };
    team.coins -= prog.cost;
    team.programmes = [...(team.programmes || []), prog.key];
    team.meters = E.applyFx(team.meters, prog.fx);
    team.log.unshift({ round:room.round, coins:-prog.cost, note:`Ran ${prog.name}` });
    team.log = team.log.slice(0,30);
    bump(room);
    return { ok:true, team:publicTeam(team) };
  },

  /* Spec D. Never mandate-gated: asking spends nothing, and a Leader who could
     forbid it would be able to stop their own country being rescued. */
  'POST /api/aid/appeal': async (b) => {
    const f = findTeam(b.code); const no = writable(f, 'appeal'); if(no) return no;
    const { room, team } = f;
    if(room.phase !== 'game') return { error:'Help is asked for during the mass game.' };
    if(!(team.displaced > 0))
      return { error:'Nobody in your country has lost their home. There is nothing to ask for.' };
    const now = Date.now();
    /* Per country, not per room: two countries struck by the same throw both
       need to be able to ask. */
    if(team.appealAt && now - team.appealAt < 30000)
      return { error:`You have just asked. Give the hall ${Math.ceil((30000 - (now - team.appealAt))/1000)}s to answer.` };
    team.appealAt = now;
    say(room, `🆘 ${team.name} is asking for help — ${lostHomesPhrase(team.displaced)}.`, '🆘');
    return { ok:true };
  },

  /* Spec D. A one-way gift: it lands immediately, with nothing to accept and
     nothing to expire. A gift that asks for nothing back cannot be used
     against the receiver, which is what makes consent skippable here and not
     in /api/trade/respond — and it matters, because nothing in the student app
     announces an incoming offer, so a gift routed through the trade panel
     would sit unclaimed while the room moved on.

     Never mandate-gated: aid is goods and coins, and Spec C established that
     those are never gated. No fifth switch on the Cabinet screen.

     NOT blocked by the discussion window, unlike both trade routes. That
     window exists to stop the alliance scramble during a card; aid strikes no
     alliance and moves no multiplier, and a strike landing mid-card is exactly
     when help matters most. */
  'POST /api/aid/send': async (b) => {
    const f = findTeam(b.code); const no = writable(f, 'aid'); if(no) return no;
    const { room, team } = f;
    if(room.phase !== 'game') return { error:'Help is sent during the mass game.' };
    const to = teamByPid(room, b.to);
    if(!to) return { error:'No country in this room has that ID.' };
    if(to.pid === team.pid) return { error:'You cannot send help to yourself.' };
    /* The anti-farm gate, and the only one needed. A country cannot be gifted
       unless it is currently struck, only the game master can strike, and the
       receiver's displaced is itself capped at a third of capacity() and
       decays two a round — so the total Harmony any strike can put into the
       room is bounded before anyone taps anything. That is why there is no
       per-round accumulator here, and why Spec C's deletion of spentThisRound
       stands. */
    if(!(to.displaced > 0)) return { error:`${to.name} is not asking for help.` };

    /* The same lower clamp /api/trade/offer shipped to production without: a
       negative give was a withdrawal from the other country once accepted
       (fixed in 803c6c5). Here it would be a theft from a country that has
       just been struck — the same bug in a new door. */
    const give  = { M:Math.max(0, Math.floor(+b.give?.M||0)), F:Math.max(0, Math.floor(+b.give?.F||0)) };
    const coins = Math.max(0, Math.floor(+b.coins||0));
    if(coins > team.coins) return { error:'Not enough coins.' };
    const fr = E.free(team);
    for(const k of ['M','F']) if(give[k] > 0 && give[k] > fr[k])
      return { error:`You only have ${Math.max(0,fr[k])} spare ${k==='M'?'Materials':'Food'} to send.` };
    if(!coins && !give.M && !give.F) return { error:'Send something — coins, Materials or Food.' };

    /* Clamped to what is actually left. The overshoot is simply not spent:
       the giver's screen shows the number still displaced so nobody has to
       guess, and charging for people who were already home would punish
       generosity for arriving second. */
    const raw = Math.floor((give.M + give.F) / E.AID_PER_PERSON)
              + Math.floor(coins / E.AID_COINS_PERSON);
    const n   = Math.min(raw, to.displaced);
    if(n <= 0) return { error:`That is not quite enough to rehouse anybody. One person needs ${E.AID_PER_PERSON} Materials or Food, or ${E.AID_COINS_PERSON} coins.` };

    /* Charge only what the rehousing actually used, in the same units it was
       offered in — goods first, because a giver who sent Materials or Food
       meant them to do the work; coins cover whatever people are left once
       the goods have claimed as many as they can.

       usedGoods is rounded DOWN to a whole multiple of AID_PER_PERSON before
       it is ever charged — not left as the raw min() — because a person
       costs a whole AID_PER_PERSON, never a fraction of one. A mixed gift
       (say M1 alongside enough coins to cover both people alone) has
       `Math.min(give.M+give.F, left*AID_PER_PERSON)` land on a number that
       credited nobody — floor(1/2) is 0 people — and charging that
       uncredited remainder anyway is exactly the "punish generosity for
       arriving second" the comment above warns against, just paid in
       Materials instead of coins. */
    let left = n;
    const rawGoods = Math.min(give.M + give.F, left * E.AID_PER_PERSON);
    const goodsPeople = Math.floor(rawGoods / E.AID_PER_PERSON);
    const usedGoods = goodsPeople * E.AID_PER_PERSON;
    left -= goodsPeople;
    const usedCoins = Math.min(coins, left * E.AID_COINS_PERSON);
    const takeM = Math.min(give.M, usedGoods);
    const takeF = Math.min(give.F, usedGoods - takeM);

    team.stock.M = (team.stock.M||0) - takeM;
    team.stock.F = (team.stock.F||0) - takeF;
    team.coins  -= usedCoins;

    to.displaced = Math.max(0, to.displaced - n);
    if(to.struck) to.struck.displaced = to.displaced;
    clearIfRecovered(to);

    /* Sized by people actually rehoused, never by what was spent. An alliance
       scores double — that, plus being told first, is what an alliance buys
       here. */
    const ally = (team.allies||[]).includes(to.pid);
    team.meters = E.applyFx(team.meters, ally ? { H:2*n, S:1*n } : { H:1*n });

    team.log.unshift({ round:room.round, coins:-usedCoins,
                       note:`Sent help to ${to.name} — ${n} rehoused` });
    team.log = team.log.slice(0,30);
    to.log.unshift({ round:room.round, note:`${team.name} sent help — ${n} rehoused` });
    to.log = to.log.slice(0,30);
    say(room, `${ally ? '🤝' : '🤲'} ${team.name} sent help to ${to.name} — ${n} rehoused.`, '🤲');
    return { ok:true, rehoused:n };
  },

  /* The Leader's one lever over their own cabinet. A flag moves only for a
     literal boolean, so a partial or stale body leaves every flag it does not
     mention exactly as it was — a device echoing an old copy of the country
     can never close a door the Leader did not close. */
  'POST /api/team/mandate': async (b) => {
    const f = findTeam(b.code); const no = writable(f, 'mandate'); if(no) return no;
    const { room, team } = f;
    const m = (b.mandate && typeof b.mandate === 'object') ? b.mandate : {};
    for(const k of E.MANDATE_FLAGS) if(typeof m[k] === 'boolean') team.mandate[k] = m[k];
    bump(room);
    return { ok:true, team:publicTeam(team) };
  },

  'GET /api/state': async (b) => {
    const f = findTeam(b.code); if(!f) return { error:'Country code not found.' };
    const { room, team, role } = f;
    const used = String(b.code||'').toUpperCase().trim();
    /* A device receives the code it arrived with and no other. Before
       ministries this was one swap for the class code; the rule generalises
       rather than growing a branch per role — team.code becomes whatever
       opened this request, and the other five credentials come out entirely.

       The leader is the documented exception, for the reason they always
       were: they are the one who reads the class code and the ministry codes
       out to their group, and who reissues one when a slip goes missing. */
    let mine = team;
    if(role !== 'leader'){
      mine = { ...team, code:used };
      delete mine.viewCode;
      delete mine.minCodes;
    }
    return {
      room:room.code, kind:room.kind, phase:room.phase, round:room.round, maxRounds:room.maxRounds,
      role: role === 'view' ? 'member' : role,
      timerEndsAt:room.timerEndsAt, timerSecs:room.timerSecs, now:Date.now(),
      scenario:room.scenario, decideAt:room.decideAt || 0, card:publicCard(room, team), team:mine, income:E.roundIncome(team), score:E.score(team), free:E.free(team),
      board:board(room), feed:room.feed.slice(0,12),
      offers:room.offers.filter(o=> o.to===team.pid || o.from===team.pid).slice(0,20),
      tradeSlots:E.tradeSlots(team),
      /* keyed on the code that was used, not the country — leader and member
         get different bodies and must not share a cache entry */
      __etag:`"s${room.code}-${used}-${room.rev}"`
    };
  },

  'GET /api/room': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    return {
      room:room.code, phase:room.phase, round:room.round, maxRounds:room.maxRounds,
      timerEndsAt:room.timerEndsAt, timerSecs:room.timerSecs, now:Date.now(),
      scenario:room.scenario, decideAt:room.decideAt || 0, card:publicCard(room), board:board(room), feed:room.feed.slice(0,20),
      /* what moved, not just that something did — /screen animates from this */
      trades:(room.trades||[]).slice(0,12),
      /* Spec D. The console draws the projected announcement from this and
         nothing else — no joining against board(). public/screen.html gets it
         too and does nothing with it; that is deliberate, not an oversight.
         `|| null` because a room restored from a snapshot written before Spec D
         has no such field, and a hall mid-session is when that would first
         be noticed. */
      lastStrike: room.lastStrike || null,
      count:Object.values(room.teams).filter(t=>String(t.name||'').trim()).length,
      ready:Object.values(room.teams).filter(t=>t.ready).length,
      decided:Object.values(room.teams).filter(t=>t.chosen).length,
      committed:Object.values(room.teams).filter(t=>t.locked).length,
      kind:room.kind, label:room.label, openJoin:room.openJoin !== false,
      practiceLeft:room.practiceLeft || 0,
      slots:Object.keys(room.teams).length,
      __etag:`"r${room.code}-${room.rev}"`
    };
  },

  /* One country's city, for another country's device.

     Two doors, and they grant the same thing. `code` is a country's own leader
     or class code, exactly as /api/state proves room membership — that is the
     student app's door. `room` is a room code, which is the projector's:
     /screen has no country and no host key, and a room code already reads the
     whole leaderboard through /api/room, which is public and unauthenticated.
     So this widens nothing; it only adds the four layout fields boardRow
     leaves out.

     Either way the pid is resolved INSIDE that one room. There is deliberately
     no global pid lookup here: without that, one class could read every other
     class in the building. */
  'GET /api/city': async (b) => {
    let room = null;
    if(b.code){ const f = findTeam(b.code); if(!f) return { error:'Country code not found.' }; room = f.room; }
    else if(b.room){ room = getRoom(b.room); if(!room) return { error:'Room not found.' }; }
    else return { error:'No room.' };
    const t = teamByPid(room, b.pid);
    if(!t) return { error:'No country in this room has that ID.' };
    return { city: cityRow(t) };
  },

  /* The cards this room may deal, for the host console's picker.

     Titles only. A picker draws an icon and a title; it has no use for the
     story or the choices, and a hall host reading the stories in advance is
     part of what this whole change is about. Holding a room's host key already
     lets you PLAY any of its cards, so listing their titles grants nothing that
     key did not already carry — and grants nothing more, either. */
  'GET /api/host/scenarios': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    /* Only the cards still to be dealt. A thrown card leaves the console's list
       and does not come back until the game master resets the deck — `used` is
       what tells the console whether that reset button is worth showing. Still
       titles only: the stories never leave this file. */
    const used = room.usedScenarios || [];
    return { cards: deckFor(room).filter(s => !used.includes(s.key))
                                 .map(s => ({ key:s.key, icon:s.icon, title:s.title })),
             used: used.length };
  },

  /* What each card the hall played was decided by, for the wrap-up.

     Host key AND phase, both checked here rather than only on the page. The
     console is projected in front of the whole cohort, so a tab left open
     from an earlier phase — or a direct call — has to hit the same wall the
     hidden button does. Same reasoning as deckreset being hall-only on the
     server below.

     The join to the deck happens here because the deck is here. room.results
     holds choice keys and numbers and nothing else; the icons and labels a
     chart needs come out of hall-scenarios.js at read time and go no further
     than this response. fx, coin, tag and story are not in it: a bar chart
     has no use for them, and the effects table has never left this file.

     Every choice appears, including ones nobody picked. A card where nobody
     led the pact is a result, and an absent bar reads as a missing option. */
  'GET /api/host/results': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    if(room.phase !== 'final')
      return { error:'The hall\'s decisions are shown once the game has been called.' };
    const deck = deckFor(room);
    return { cards: (room.results || []).map(row => {
      const sc = deck.find(s => s.key === row.key);
      if(!sc) return null;
      return {
        key:row.key, icon:sc.icon, title:sc.title, round:row.round,
        total:row.total, undecided:row.undecided,
        choices: sc.choices.map(c => ({
          key:c.key, icon:c.icon, label:c.label, count:row.counts[c.key] || 0
        }))
      };
    }).filter(Boolean) };
  },

  'POST /api/host/act': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    if(b.act === 'phase'){
      if(b.phase === 'game' && room.kind === 'class')
        return { error:'This is a classroom room. Open a separate hall room for the mass game.' };
      room.phase = b.phase;
      if(b.phase === 'game' && room.round === 0){ advanceRound(room); }
      say(room, b.phase==='game' ? 'The mass game begins!' : b.phase==='final' ? 'Final results are in.' : 'Nation-building stage.', '📣');
    }
    if(b.act === 'round'){
      /* A classroom is exactly what a student's self-made room is, and
         advanceRound() pays coins — which pillars() reads as Wealth directly.
         Refusing it here is what actually closes the farming hole; the
         maxRounds cap below only bounds a legitimate hall. */
      if(room.kind === 'class')
        return { error:'A classroom does not run rounds. Use Deal trade materials.' };
      if(room.round >= room.maxRounds)
        return { error:'The mass game is over — all rounds have been played.' };
      advanceRound(room);
    }
    if(b.act === 'yield'){
      if(room.kind !== 'class')
        return { error:'Trade materials are dealt in a classroom, not the hall.' };
      dealMaterials(room);
    }
    if(b.act === 'scenario'){
      if(room.kind === 'class'){
        /* The drill is a readiness check, not a lesson. It only means anything
           once every group has finished building and committed — and running it
           earlier would make the snapshot below meaningless, because a country
           still being edited has no settled meters to put back. */
        const built = Object.values(room.teams).filter(t => String(t.name||'').trim());
        if(!built.length) return { error:'No countries have joined yet.' };
        if(built.some(t => !t.locked))
          return { error:'Every group must commit their country before the test scenario.' };
        if((room.practiceLeft || 0) <= 0) return { error:'The test scenario has already been run.' };
        room.practiceLeft -= 1;
        /* Committing recomputes a country's meters, which is what made the OLD
           practice cards free — they ran BEFORE commit. This one runs after, so
           nothing wipes it and it would ride into the hall.

           A snapshot, not a recompute. Recomputing foundingMeters would wipe
           classroom trade gains (an accepted trade is +2 Economy to each side);
           reversing the card's own fx cannot be exact, because applyFx clamps
           every meter at 0 and 100. */
        for(const t of built) t.preDrill = { ...t.meters };
      }
      /* A named card must exist in THIS room's deck. Without the check
         pushScenario's fallback quietly deals something else, so a typo — or a
         hall key posted at a classroom — comes back looking like it worked. */
      if(room.kind !== 'class' && b.key && !deckFor(room).some(s => s.key === b.key))
        return { error:'No such scenario card.' };
      /* A card the hall has already played must not come back round, even from
         a console tab left open since before the deck was reset — the list on
         screen is a convenience, this is the rule. */
      if(room.kind !== 'class' && b.key && (room.usedScenarios||[]).includes(b.key))
        return { error:'That card has already been thrown. Reset the deck to use it again.' };
      const dealt = pushScenario(room, room.kind === 'class' ? E.DRILL.key : b.key);
      /* What was actually dealt, not what was asked for: pushScenario falls back
         to the round's card when no key is given, and recording the request
         would then mark the wrong card used — or nothing at all. */
      if(room.kind !== 'class' && dealt && !room.usedScenarios.includes(dealt.key))
        room.usedScenarios.push(dealt.key);
    }
    /* The way back to a full deck. Hall-only on the server rather than merely
       hidden on the console, for the same reason openjoin is classroom-only
       below: a hall console is projected in front of the whole cohort, so the
       guard has to hold against a direct API call too. */
    if(b.act === 'deckreset'){
      if(room.kind === 'class') return { error:'A classroom has one test scenario, not a deck.' };
      room.usedScenarios = [];
      say(room, 'All scenario cards are available again.', '↺');
    }
    /* Spec D. Hall-only on the server rather than merely hidden on the
       console, for the same reason deckreset and openjoin are: a hall console
       is projected in front of the whole cohort, so the guard has to hold
       against a direct API call too. */
    if(b.act === 'strike'){
      if(room.kind === 'class')
        return { error:'A classroom has no game master to strike with. Strikes belong to the hall.' };
      /* Not `!== 'final'`. A country in prep is still being founded and its
         meters are not settled; a country in final has already been scored and
         read out. Only the mass game is strikeable. */
      if(room.phase !== 'game')
        return { error:'Strikes land during the mass game, between the cards.' };
      const kind = STRIKES.find(s => s.key === b.kind);
      /* Refused, never a fallback. pushScenario's fallback taught this lesson:
         a typo that quietly deals something else comes back looking like it
         worked. */
      if(!kind) return { error:'No such kind of strike.' };

      const named = Object.values(room.teams).filter(t => String(t.name||'').trim());
      let targets;
      if(Number(b.random) > 0){
        /* Fisher-Yates on a copy, then take N. Shuffling rather than picking N
           times is what guarantees no country is struck twice, which the test
           asserts directly. Asking for more than exist takes everyone. */
        const pool = named.slice();
        for(let i = pool.length - 1; i > 0; i--){
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        targets = pool.slice(0, Math.min(pool.length, Math.floor(Number(b.random))));
      } else {
        const want = Array.isArray(b.pids) ? b.pids.map(p => String(p||'').toUpperCase().trim()) : [];
        targets = named.filter(t => want.includes(t.pid));
      }
      if(!targets.length) return { error:'Nobody was named, and no number was given to strike at random.' };

      const hits = targets.map(t => strikeCountry(t, kind, room.round));
      /* One field, so the console draws the roll without joining board()
         against anything. Public by definition — it is on a projector. Names,
         never pids or codes: this is the one place a human reads it rather
         than a script. Untouched by the feed cap below — the projected
         overlay (Task 12) reads every hit from here, never from the feed, so
         folding the feed loses nothing. */
      room.lastStrike = { kind:kind.key, icon:kind.icon, title:kind.title, line:kind.line,
                          at:Date.now(), round:room.round, hits };
      /* strikeFeedLines (below strikeCountry) decides what the feed shows —
         see its own comment for the cap and the ordering. Every line it
         returns is said here, in the order given, so the headline (last in
         that order) ends up newest-on-top. */
      for(const ln of strikeFeedLines(kind, hits)) say(room, ln.text, ln.icon);
      return { ok:true, struck:hits };
    }
    if(b.act === 'clear'){
      /* Closing the drill is what makes it free: put every snapshot back and
         drop the decision, so a country carries into the hall exactly as it was
         committed, plus whatever it legitimately traded for. */
      if(room.kind === 'class'){
        for(const t of Object.values(room.teams)){
          if(t.preDrill){ t.meters = t.preDrill; delete t.preDrill; }
          t.chosen = null;
        }
      }
      closeCard(room);
      room.scenario = null; room.timerEndsAt = null;
      say(room, room.kind === 'class' ? 'Test scenario closed — meters put back.' : 'Scenario closed.', '🔚');
    }
    if(b.act === 'timer'){
      const secs = Math.max(0, Math.min(3600, Math.floor(Number(b.secs)||0)));
      if(!secs){ room.timerEndsAt = null; room.timerSecs = 0; say(room,'Timer stopped.','⏹️'); }
      else { room.timerSecs = secs; room.timerEndsAt = Date.now() + secs*1000;
        say(room, `${Math.round(secs/60*10)/10} minutes on the clock.`, '⏱️'); }
    }
    if(b.act === 'reset')  { dropRoom(room); return { ok:true, reset:true }; }
    /* The rollback lever: a teacher who provisioned groups and closed joining
       (host/groups does this automatically) needs a way back if a device was
       lost or a group needs re-adding by hand — this just flips the switch
       /api/join already checks. Scoped to a classroom room on the server, not
       just hidden on the console: a hall room is projected in front of the
       whole cohort with its room code on screen, so this must not be
       flippable there even by a direct API call — that is exactly the
       extra-country hole Tasks 4 and 12 closed. */
    if(b.act === 'openjoin'){
      if(room.kind !== 'class') return { error:'Open joining only applies to a classroom room.' };
      room.openJoin = !room.openJoin;
      say(room, room.openJoin ? 'Open joining is ON.' : 'Open joining is OFF.', '🚪');
    }
    /* "Finish session" on the console is a checklist, not an action: it must
       never lock or delete anything itself (every country still gets there
       through its own commit), it only records that the teacher looked at a
       fully-committed roster and told the class what to do next. */
    if(b.act === 'finish'){
      say(room, `${room.label ? room.label + ' — ' : ''}every group is committed. Ready for the hall.`, '🏁');
    }
    return { ok:true, phase:room.phase, round:room.round, scenario:room.scenario };
  },

  /* The teacher's own safety net. The server already keeps the room, but a
     file on the teacher's laptop cannot be lost to a Railway accident, and it
     is the one thing that makes a day-one/day-two game genuinely safe. */
  'GET /api/host/export': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    return { file:`republic2126-${room.code}.json`, snapshot:snapshot(room) };
  },

  'POST /api/host/import': async (b) => {
    const s = b.snapshot;
    if(!s || !s.code || !s.teams || !s.hostKey) return { error:'That file is not a Republic 2126 backup.' };
    const live = ROOMS.get(s.code);
    /* This used to be `if(live && live.hostKey !== s.hostKey)` — the hostKey
       check only ever ran when a room with this code happened to be live,
       so a code that was NOT live accepted any snapshot from anyone, no
       authentication at all: an attacker only has to pick a room code
       nothing currently holds. Measured against this build: 300 anonymous
       rooms planted in well under a second, rooms.json growing from 42 KB to
       51 MB, and — because this is also where a snapshot's fields land
       without the validation POST /api/team/save applies — the enabling half
       of the stored-XSS finding elsewhere in this review (a hostile col1 or
       emblem team/save would refuse outright).

       A first pass at this fix required a LIVE room whose hostKey matches,
       full stop — but that quietly deleted the backup safety net README.md
       and the setup screen's own "Have a backup file from last lesson?"
       button both promise: restoring after the room's volume was lost, an
       /admin wipe, or a teacher's own act:'reset' (dropRoom() — the one
       accident a backup exists to undo) all landed on a room that is, by
       definition, not live, and "open it first" is not something host/create
       can even do at a chosen code with a chosen hostKey. The carve-out
       below is the fix: a room that is NOT live can still be restored, but
       only with ADMIN_KEY — keeping the unauthenticated write surface shut
       (adminOk() fails closed exactly like every /api/admin/* route) while
       keeping cold recovery genuinely possible for whoever runs the server. */
    if(!live && !adminOk(b.key))
      return { error:`Room ${s.code} is no longer open. Restoring a closed room needs the admin key — ask whoever runs the server.` };
    if(live && live.hostKey !== s.hostKey)
      return { error:`Room ${s.code} is already open with a different host key. Close it first.` };
    /* A backup's country codes may have been re-issued elsewhere since it was
       written — the ordinary way this happens is a group committing and
       migrating to the hall between the backup being taken and the teacher
       restoring it. Repointing the code would hand one room's group another
       room's live country, silently, so this refuses and names the clash
       instead. The wording is deliberately careful: this is the single
       highest-consequence sentence in the app. A previous version named the
       clashing room and told the teacher to "close" it first — sound advice
       for two classrooms sharing a stale code, but when the clash is with
       the hall (300 students, mid-lesson) "close it" means "destroy the
       live mass game", and a teacher reading fast, mid-lesson, would follow
       it. So: name the group, say nothing was touched, never suggest
       closing anything — but still name the clashing room when it is NOT
       the hall, or a teacher with two classrooms sharing a stale code is
       left with nothing to act on at all. */
    for(const t of Object.values(s.teams)){
      /* regRoom() registers all six of a team's codes — the leader code, the
         class code, and all four minCodes — so the clash guard has to check
         all six too, or a restore can silently repoint a live room's ministry
         credential at whatever this snapshot's team claims. Reproduced live
         before this fix: a live room's Defence code, resubmitted inside an
         unrelated import, resolved to the importing snapshot's country
         afterward with ok:true — the live Defence Minister's slip stopped
         working with nothing telling anyone why. */
      for(const c of [t.code, t.viewCode, ...Object.values(t.minCodes||{})]){
        const owner = c && CODES.get(c);
        if(owner && owner.room !== s.code){
          const ownerRoom = ROOMS.get(owner.room);
          const who = String(t.name||'').trim() ? `Group ${t.name}` : 'A group in this backup';
          const where = ownerRoom && ownerRoom.kind === 'hall' ? 'the hall' : `room ${owner.room}`;
          return { error:`${who} has already moved to ${where}. Restoring would create a second copy, so nothing was changed.` };
        }
      }
    }
    if(live){
      /* The object about to replace this room, a few lines down, is the
         submitted snapshot itself — a host who holds their own room's
         hostKey can press Save backup, edit origin (and kind) in a text
         editor, then Restore from file, and both existing checks above
         still pass because it genuinely is their own live room. origin and
         kind are decided by how a room was made, never by what a file
         claims, so they are pinned back from the room actually running
         right now before the snapshot is installed over it. */
      s.origin = live.origin; s.kind = live.kind;
      unregRoom(live);
    }
    delete s._board; delete s._boardRev;
    s.touched = Date.now();
    s.rev = (Number(s.rev) || 1) + 1;
    /* A backup can be older than pid, or newer than it but exported a moment
       before this fix — either way it may still have leader codes sitting in
       allies/offers, or teams with no pid at all. Migrate it exactly as a
       restart would, or the teacher's safety net hands back a room where
       every trade is silently refused.

       regRoom() runs BEFORE migrateRoom() for the same reason restore() does:
       migrateRoom() can mint a fresh pid, and freePid() can only exclude a
       code that is already registered — this room's own codes have to be in
       CODES before that draw happens, or the pid can collide with one of
       them. */
    regRoom(s);
    migrateRoom(s);
    ROOMS.set(s.code, s);
    say(s, 'Room restored from a backup file.', '↩️');
    return { ok:true, room:s.code, hostKey:s.hostKey, count:Object.keys(s.teams).length };
  },

  'POST /api/host/groups': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    /* Hall countries are supposed to arrive by migration (Task 8), not by
       provisioning — a stray call here would mint empty countries in a room
       nothing ever names, orphaned forever. */
    if(room.kind !== 'class') return { error:'Only a classroom room has groups to set up.' };
    /* Number(undefined) and Number('') are both 0, and Number('six') is NaN
       — `|| 0` on either turned every one of those into a silently accepted
       n=1, which deletes every slot above 1 with no error. This is the only
       thing standing between a blank console field and destroying leader
       codes already printed on paper, so an absent or non-numeric n must be
       refused before anything is touched, not coerced. */
    const raw = Number(b.n);
    if(!Number.isFinite(raw) || raw < 1) return { error:'Say how many groups you need.' };
    const n = Math.max(1, Math.min(40, Math.floor(raw)));
    const teams = Object.values(room.teams);
    const named = t => !!String(t.name||'').trim();

    if(n < teams.length){
      /* A name is the whole test: commit requires one, so a locked country
         always has one, and a slot without one has never been used. */
      const empty = teams.filter(t=>!named(t)).sort((x,y)=> (y.slot||0) - (x.slot||0));
      const drop  = teams.length - n;
      if(empty.length < drop){
        const busy = teams.filter(named).map(t=>t.slot).sort((x,y)=>x-y);
        return { error:`Only ${empty.length} empty group${empty.length===1?'':'s'} can be removed. Group${busy.length===1?'':'s'} ${busy.join(', ')} ${busy.length===1?'has':'have'} already started — remove those one at a time.` };
      }
      for(const t of empty.slice(0, drop)){ unregTeam(t); delete room.teams[t.code]; }
    } else {
      /* Slots are never renumbered — these numbers get printed and read aloud. */
      let slot = teams.reduce((m,t)=> Math.max(m, t.slot||0), 0);
      for(let i = teams.length; i < n; i++){
        slot++;
        const t = E.blankCountry();
        t.code = freeCode(5);
        t.viewCode = freeCode(5);
        t.slot = slot;
        /* Dealt to the least-used homeland in the room right now (see
           dealHomeland above) — not to slot number — so shrinking and then
           growing again still ends up with a full spread of shortages,
           which is what keeps trade worth doing. */
        t.homeland = dealHomeland(Object.values(room.teams));
        t.meters = E.foundingMeters(t);
        room.teams[t.code] = t;
        reg(room.code, t.code, t.code, 'leader');
        reg(room.code, t.code, t.viewCode, 'view');
        /* Four more, each with its own role, minted in the same window as the
           leader and class codes and for the same reason: freePid() below
           excludes only what is already in CODES/PIDS, so a pid drawn before
           these are registered can come back equal to one of them — publishing
           a live ministry credential on the leaderboard. */
        t.minCodes = {};
        for(const m of MINISTRIES){
          t.minCodes[m] = freeCode(5);
          reg(room.code, t.code, t.minCodes[m], m);
        }
        /* t.code and t.viewCode must be registered before pid is drawn —
           freePid() excludes only CODES/PIDS entries that already exist, and
           until reg() runs above, this team's own codes are not among them.
           Drawing the pid first could mint it equal to this very team's
           leader or class code, republishing a live credential on the
           leaderboard the moment the board loads. Same ordering discipline
           as /api/join, and freePid() (not freeCode()) so the pid is
           reserved immediately — the next iteration of this same loop must
           not be able to draw it again either. */
        t.pid = freePid();
      }
    }
    room.openJoin = false;
    say(room, `${Object.keys(room.teams).length} groups set up.`, '👥');
    return { ok:true, roster:rosterOf(room) };
  },

  'POST /api/host/roster': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    return { ok:true, kind:room.kind, label:room.label, openJoin:room.openJoin !== false,
             practiceLeft:room.practiceLeft || 0, roster:rosterOf(room) };
  },

  'POST /api/host/country': async (b) => {
    const room = getRoom(b.room); if(!room) return { error:'Room not found.' };
    if(b.hostKey !== room.hostKey) return { error:'Not the host.' };
    const tc = String(b.code||'').toUpperCase().trim();
    if(b.act === 'pull') return pullCountry(room, tc);
    const team = room.teams[tc];
    if(!team) return { error:'No country in this room has that code.' };

    if(b.act === 'rename'){
      const name = String(b.name||'').trim().slice(0,28);
      if(!name) return { error:'Give the country a name.' };
      team.name = name; team.renameAsked = false; team.rejectedName = '';
      say(room, `A country was renamed to ${name}.`, '✏️');
    }
    else if(b.act === 'askRename'){
      /* Name moderation belongs to the classroom, before anything is
         projected. A hall roster has no Identity pane for the banner to
         land on and no prep-phase toast to carry it (both are classroom-
         only), and blanking team.name here also drops the country from
         board()'s name filter — on a hall console that is not "clear the
         name field", it is "make the country vanish from the projected
         leaderboard mid-game", with no student-side notice and no route
         back (the group's own retype is refused by the rejectedName guard
         below). Refuse it server-side, not just by hiding the console
         button, the same discipline as the openjoin guard above. */
      if(room.kind !== 'class')
        return { error:'Ask-to-rename only applies to a classroom room. Do it there, before the country migrates to the hall.' };
      /* Unlocking matters: a committed group that is asked to rename cannot
         change anything, so leaving it locked would strand them.
         rejectedName remembers what is being cleared — team/save below
         needs it to tell a genuine rename apart from the leader's own stale
         autosave silently handing the same, just-rejected name straight
         back the moment doCommit() calls save() before committing. */
      team.rejectedName = team.name;
      team.name = ''; team.renameAsked = true; team.locked = false; team.ready = false;
      say(room, 'A country has been asked to choose a different name.', '↩️');
    }
    else if(b.act === 'reopen'){
      team.locked = false; team.ready = false;
      say(room, `${team.name || 'A country'} was reopened for editing.`, '🔓');
    }
    else if(b.act === 'remove'){
      const started = !!String(team.name||'').trim();
      /* A classroom teacher owns their own roster: a duplicate group, a test
         country made while setting up, a group that merged into another. They
         had to ask ↩️ first and then bin the emptied row, and the refusal
         pointed at 🔓 — which unlocks but keeps the name, so it never worked.
         The console confirms by name before it gets here.

         A hall is different and stays shut: a country there is on a projected
         leaderboard mid-game, and removing it is the same "make it vanish with
         no notice and no route back" that askRename is refused for above. */
      if(started && room.kind !== 'class')
        return { error:'That country is playing in the hall. Remove it from its classroom room instead — taking it off a projected leaderboard mid-game is not something this can undo.' };
      unregTeam(team); delete room.teams[tc];
      say(room, started ? `${team.name} was removed from the class.` : 'An empty group was removed.', '🗑️');
    }
    else return { error:'Unknown action.' };

    return { ok:true, roster:rosterOf(room) };
  },

  'POST /api/scenario/choose': async (b) => {
    const f = findTeam(b.code); if(!f) return { error:'Country code not found.' };
    /* The classroom drill is the one card a committed country may still answer.
       Narrow on purpose: this room, this card, nothing else. */
    const isDrill = f.room.kind === 'class' && f.room.scenario === E.DRILL.key;
    const no = writable(f, 'choose', isDrill); if(no) return no;
    return chooseScenario(f.room, f.team, b.choice);
  },

  'POST /api/team/commit': async (b) => {
    const f = findTeam(b.code); if(!f) return { error:'Country code not found.' };
    /* Committing and taking a country to the hall stay the Leader's alone —
       no ministry may do either, so this is a role gate, not a writable()
       call (writable()'s allowCommitted branch has nothing to say about a
       route whose entire job is flipping locked to true). */
    if(!mayAct(f.role, 'commit')) return { error: refusal(f.role, 'commit') };
    const { room, team } = f;
    if(team.locked) return { ok:true, already:true, team:publicTeam(team) };
    if(team.renameAsked) return { error:'Your teacher has asked you to choose a different name first.' };
    if(!String(team.name||'').trim()) return { error:'Your country needs a name.' };
    if(!String((team.members||{}).leader||'').trim()) return { error:'Name your Leader before you commit.' };
    const fr = E.free(team);
    if(fr.W < 0 || fr.M < 0 || fr.F < 0)
      return { error:'Your country is using more than it has. Fix Build or Industry first.' };
    /* Founding meters are recomputed from the country as committed, which is
       what makes a practice card free: whatever a rehearsal did to the meters
       is gone the moment the group commits. */
    team.meters = E.foundingMeters(team);
    team.chosen = null;
    team.ready = true;
    team.locked = true;
    say(room, `${team.name} is committed and ready.`, '🔒');
    return { ok:true, team:publicTeam(team) };
  },

  'POST /api/team/join-hall': async (b) => {
    const f = findTeam(b.code); if(!f) return { error:'Country code not found.' };
    /* Same reasoning as commit above: taking the country to the hall is the
       Leader's alone, a role gate rather than a writable() call. */
    if(!mayAct(f.role, 'hall')) return { error: refusal(f.role, 'hall') };
    const hall = getRoom(b.room);
    if(!hall) return { error:'No room with that code. Check the code on the screen.' };
    if(hall.kind !== 'hall') return { error:'That is a classroom code, not the hall.' };
    if(f.room.code === hall.code) return { ok:true, already:true, room:hall.code };
    /* Already in a hall — a stray rehearsal-room code on a slide must not be
       able to move a live country out of the real mass game. */
    if(f.room.kind === 'hall') return { error:'Your country is already in a hall — it cannot be moved to a different one.' };
    /* This is the door ~300 students actually walk through — pullCountry()
       above is only the teacher's rescue console. Same guard, same
       position relative to the locked check (before it, so an untrusted
       country is never told its commit status), so a room somebody opened
       themselves at /host still cannot get a country onto the hall
       leaderboard by having its own leader type the hall code in. */
    if(!trusted(f.room)) return { error:'That country is not from a registered class room.' };
    if(!f.team.locked) return { error:'Commit your country before joining the hall.' };
    moveTeam(f.team, f.room, hall);
    return { ok:true, room:hall.code, team:publicTeam(f.team) };
  },

  'POST /api/trade/offer': async (b) => {
    const f = findTeam(b.code); const no = writable(f, offerAct(b)); if(no) return no;
    const { room, team } = f;
    /* Only the alliance half. Goods and coins are deliberately never gated:
       a trade needs the other country's consent, and it is the act that gets
       students out of their chairs. */
    if(offerAct(b) === 'ally'){
      const shut = mandateBlock(team, f.role, 'ally');
      if(shut) return { error:shut };
    }
    /* The minute belongs to the card. Ally choices scale with allies and
       alliances are struck right here, so this is the exact scramble the
       window exists to postpone — not to ban. It opens again in seconds. */
    if(discussing(room, Date.now()))
      return { error:`The region is discussing the card. Trading opens in ${Math.ceil((room.decideAt - Date.now())/1000)}s.` };
    const to = teamByPid(room, b.to);
    if(!to) return { error:'No country in this room has that ID.' };
    if(to.pid === team.pid) return { error:'You cannot trade with yourself.' };
    /* Clamped the same way coins already was below — a negative give/want is
       not a trade, it is a withdrawal from the other country's stock once
       accepted (the transfer arithmetic in /api/trade/respond does exactly
       `- offer.give[k] + offer.want[k]`, which runs backwards under a
       negative value), and the affordability guard two lines down only
       tests the positive branch (`give[k] > 0 && ...`), so it never sees a
       negative coming. Any code can reach this route from a phone's browser
       console, not just the UI's number inputs, which never produced a
       negative in the first place — so this was reachable in production
       before ministries existed at all. */
    const give = { W:Math.max(0,+b.give?.W||0), M:Math.max(0,+b.give?.M||0), F:Math.max(0,+b.give?.F||0) };
    const want = { W:Math.max(0,+b.want?.W||0), M:Math.max(0,+b.want?.M||0), F:Math.max(0,+b.want?.F||0) };
    const coins = Math.max(0, +b.coins||0);
    const fr = E.free(team);
    for(const k of ['W','M','F']) if(give[k] > 0 && give[k] > fr[k])
      return { error:`You only have ${Math.max(0,fr[k])} spare ${k==='W'?'Workers':k==='M'?'Materials':'Food'} to give.` };
    if(coins > team.coins) return { error:'Not enough coins.' };
    const offer = { id:code(6), from:team.pid, fromName:team.name, to:to.pid, toName:to.name,
      give, want, coins, ally:!!b.ally, status:'pending', t:Date.now() };
    room.offers.unshift(offer); room.offers = room.offers.slice(0,120);
    say(room, `${team.name} sent an offer to ${to.name}.`, '📨');
    return { ok:true, offer };
  },

  'POST /api/trade/respond': async (b) => {
    const f = findTeam(b.code);
    if(!f) return { error:'Country code not found.' };
    const { room, team } = f;
    /* Offers sent BEFORE the card must not become a way through the minute. */
    if(discussing(room, Date.now()))
      return { error:`The region is discussing the card. Trading opens in ${Math.ceil((room.decideAt - Date.now())/1000)}s.` };
    const offer = room.offers.find(o=>o.id === b.id);
    if(!offer) return { error:'Offer not found.' };
    if(offer.to !== team.pid) return { error:'That offer is not addressed to you.' };
    if(offer.status !== 'pending') return { error:'Offer already handled.' };
    /* The act depends on what is being answered, which is why this gate sits
       below the lookup rather than at the top with every other route's: an
       alliance is the Defence Minister's to accept, goods are the Trade
       Minister's, a combined offer is the Leader's alone (offerAct — same
       reasoning as /api/trade/offer above), and the same route serves all
       three. Everything above this line (the discussion-window check and the
       offer lookup) is read-only, so moving the gate here costs nothing. */
    const no = writable(f, offerAct(offer));
    if(no) return no;
    /* Both ends, or the door is shut on one side only: without this a country
       could not PROPOSE an alliance its Leader had closed but could still JOIN
       one. Declining is never gated — refusing an alliance needs no
       permission — so this asks about b.accept too. */
    if(b.accept && offerAct(offer) === 'ally'){
      const shut = mandateBlock(team, f.role, 'ally');
      if(shut) return { error:shut };
    }
    if(!b.accept){ offer.status = 'declined'; say(room, `${team.name} declined ${offer.fromName}'s offer.`, '❌'); return { ok:true, status:'declined' }; }
    const from = teamByPid(room, offer.from);
    if(!from) return { error:'The other country has left.' };
    /* Prep only. The case this guards against is genuinely a prep-room one:
       A sends an offer, A commits, B accepts — B's acceptance would move
       resources on a country whose free() was validated at commit and is
       not meant to move again before it carries into the hall. Once phase
       is 'game', locked is just the historical "this country committed
       properly" marker (Task 8's moveTeam does not, and must not, clear
       it), and must not block trading — that is the entire mass game,
       refused for every country, in every session. */
    if(from.locked && room.phase === 'prep') return { error:'They have committed their country — that offer can no longer be paid.' };
    const frMe = E.free(team), frThem = E.free(from);
    for(const k of ['W','M','F']){
      if(offer.want[k] > 0 && offer.want[k] > frMe[k])  return { error:'You do not have enough spare resources to accept.' };
      if(offer.give[k] > 0 && offer.give[k] > frThem[k]) return { error:'They no longer have those resources spare.' };
    }
    if(offer.coins > from.coins) return { error:'They no longer have those coins.' };
    for(const k of ['W','M','F']){
      from.stock[k] = (from.stock[k]||0) - offer.give[k] + offer.want[k];
      team.stock[k] = (team.stock[k]||0) + offer.give[k] - offer.want[k];
    }
    from.coins -= offer.coins; team.coins += offer.coins;
    // trading is good for both economies
    from.meters = E.applyFx(from.meters, { E:2 });
    team.meters = E.applyFx(team.meters, { E:2 });
    if(offer.ally){
      if(!from.allies.includes(team.pid)) from.allies.push(team.pid);
      if(!team.allies.includes(from.pid)) team.allies.push(from.pid);
      from.meters = E.applyFx(from.meters, { D:3, H:2, S:2 });
      team.meters = E.applyFx(team.meters, { D:3, H:2, S:2 });
      say(room, `🤝 ALLIANCE: ${from.name} and ${team.name} are now allies.`, '🤝');
    } else {
      say(room, `${from.name} ⇄ ${team.name} traded.`, '🔁');
    }
    /* A structured record of what moved, alongside the prose in the feed. The
       projector cannot tell from "Alpha ⇄ Beta traded." what to animate, and
       widening say() would change every screen that reads the feed as text.

       Public data only — pids, never codes, the same discipline as boardRow.
       Capped the way room.feed is: this is a thing to watch, not a ledger.

       `|| []` because a room restored from a snapshot written before this
       field existed has no trades array, and a hall mid-session is exactly
       when that would first be noticed. */
    room.trades = room.trades || [];
    room.trades.unshift({ t:Date.now(), id:offer.id, a:from.pid, b:team.pid,
                          give:offer.give, want:offer.want, coins:offer.coins,
                          ally:!!offer.ally });
    room.trades = room.trades.slice(0,40);
    offer.status = 'accepted';
    return { ok:true, status:'accepted' };
  },

  'POST /api/admin/list': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    /* No host keys, no country codes. This is for triage, not for reading over
       somebody's shoulder. round is coerced to a number here, not merely
       escaped on the way out in public/admin.html — POST /api/host/import
       now requires either a live room's matching hostKey or the admin key
       (final-review finding 5, and its own follow-up "NEW-2"), but neither
       check validates the SHAPE of the snapshot's fields, only who is
       allowed to submit one — a teacher's own backup file can be hand-edited
       or simply corrupted, and can still hand this route a room whose round
       is an arbitrary string. A number is all round is ever supposed to be
       regardless of what that snapshot claims. */
    const rooms = [...ROOMS.values()].map(r=>({
      code:r.code, kind:r.kind || 'hall', label:r.label || '',
      origin:r.origin,
      countries:Object.values(r.teams).filter(t=>String(t.name||'').trim()).length,
      committed:Object.values(r.teams).filter(t=>t.locked).length,
      slots:Object.keys(r.teams).length,
      phase:r.phase, round:Number(r.round) || 0, created:r.created, touched:r.touched
    })).sort((x,y)=> x.touched - y.touched);
    return { ok:true, rooms };
  },

  'POST /api/admin/export': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    return { file:`republic2126-all-${new Date().toISOString().slice(0,10)}.json`,
             rooms:[...ROOMS.values()].map(snapshot) };
  },

  'POST /api/admin/delete': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    const want = (Array.isArray(b.rooms) ? b.rooms : []).map(x=>String(x||'').toUpperCase());
    let gone = 0;
    for(const c of want){ const r = ROOMS.get(c); if(r){ dropRoom(r); gone++; } }
    /* Written straight through, not on the usual 1.5-second debounce: a crash
       inside that window would bring the rooms back from disk. */
    persistNow();
    return { ok:true, deleted:gone };
  },

  'POST /api/admin/wipe': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    if(b.confirm !== 'DELETE') return { error:'Type DELETE to confirm.' };
    let gone = 0;
    for(const r of [...ROOMS.values()]){ dropRoom(r); gone++; }
    persistNow();
    return { ok:true, deleted:gone };
  }

  ,'POST /api/admin/rooms': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    /* Forty is the same ceiling the group stepper clamps to — a cohort bigger
       than that is a second event, not a longer list. */
    const labels = (Array.isArray(b.labels) ? b.labels : [])
      .map(x => String(x||'').trim().slice(0,24)).filter(Boolean).slice(0,40);
    if(!labels.length) return { error:'Give at least one class name.' };
    const rooms = labels.map(label => {
      const r = newRoom('class', label, 'admin');
      say(r, `Classroom room opened for ${label}. Set the number of groups.`, '🚀');
      return { room:r.code, hostKey:r.hostKey, label:r.label };
    });
    /* Straight through, not on the 1.5s debounce: these codes get written on a
       whiteboard the moment they appear, and a crash inside that window would
       hand teachers codes for rooms that no longer exist. */
    persistNow();
    return { ok:true, rooms };
  }

  /* One room's host key, asked for by name.

     The list above deliberately carries no host keys, and that stays true: a
     key is a credential, /admin is the screen most likely to be photographed
     or shared, and a list of thirty keys is thirty credentials leaked by one
     screenshot. But a hall whose key is lost is a hall nobody can run — the
     console keeps no session in the URL or in storage, so closing that tab
     with the key unwritten strands every country in the room.

     So: one key, one room, one deliberate press. Same admin gate as everything
     else on this route. The alternative already existed — POST /api/admin/export
     hands back whole snapshots, host keys included — but reading a key out of a
     downloaded JSON file is not something anyone will manage with a hall
     waiting. */
  ,'POST /api/admin/key': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    const room = getRoom(String(b.room||''));
    if(!room) return { error:'No room with that code.' };
    return { ok:true, room:room.code, kind:room.kind, label:room.label || '', hostKey:room.hostKey };
  }

  ,'POST /api/admin/trust': async (b) => {
    if(!adminOk(b.key)) return adminDeny();
    const room = getRoom(String(b.room||''));
    if(!room) return { error:'No room with that code.' };
    /* One-way on purpose. There is a real, dated scenario for promoting a room a
       teacher opened by mistake — their class has a lesson's work inside it — and
       none at all for demoting one, which would strand exactly the countries this
       route exists to rescue. */
    room.origin = 'admin';
    persistNow();
    return { ok:true, room:room.code, origin:room.origin };
  }
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const key = req.method + ' ' + u.pathname;

  if(u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if(u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  /* Ahead of the routes table because that table answers in JSON and this
     answers in JPEG. See cardArt() for why it takes no card key. */
  if(req.method === 'GET' && u.pathname === '/api/card-art') return cardArt(req, res, u);

  if(routes[key]){
    try{
      const body = req.method === 'GET' ? Object.fromEntries(u.searchParams) : await readBody(req);
      const out = await routes[key](body);
      return json(res, out, out && out.error ? 400 : 200, req);
    }catch(err){ return json(res, { error:'Server error: '+err.message }, 500, req); }
  }

  // static
  let file = u.pathname === '/' ? '/index.html'
           : u.pathname === '/host' ? '/host.html'
           : u.pathname === '/play' ? '/index.html'
           : u.pathname === '/screen' ? '/screen.html'
           : u.pathname === '/slides' ? '/slides.html'
           : u.pathname === '/admin' ? '/admin.html'
           : u.pathname === '/setup' ? '/setup.html' : u.pathname;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if(!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()){
    res.writeHead(404, { 'Content-Type':'text/plain' }); return res.end('Not found');
  }
  /* The page is one big self-contained file. Compress it and let the browser
     revalidate it, so 250 phones opening at once do not each pull 250 KB. */
  const ext  = path.extname(full);
  const stat = fs.statSync(full);
  const tag  = `"f${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  const head = { 'Content-Type': MIME[ext] || 'application/octet-stream',
                 'ETag':tag, 'Cache-Control':'public, max-age=0, must-revalidate' };

  if(req.headers['if-none-match'] === tag){ res.writeHead(304, head); return res.end(); }

  const text = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.svg';
  if(text && String(req.headers['accept-encoding']||'').includes('gzip')){
    head['Content-Encoding'] = 'gzip';
    head['Vary'] = 'Accept-Encoding';
    res.writeHead(200, head);
    return res.end(gzip(fs.readFileSync(full), 'static:' + full + ':' + tag));
  }
  res.writeHead(200, head);
  fs.createReadStream(full).pipe(res);
});

/* Every existing test spawns `node server.js` as its own process — this is
   still exactly what happens then, unchanged. The only new path is a test
   that `require()`s this file directly, in-process, to call a handful of
   internals (moveTeam, PIDS, …) directly. That is the one way to prove an
   invariant about a specific value inside a ~33-million-value random
   alphabet without either guessing at collision odds or adding a debug
   HTTP route that would leak process internals onto the network. */
if(require.main === module){
  /* Railway sends SIGTERM before a restart — take the last 1.5 seconds with
     us. Registered only here: require()ing this file must not install a
     handler in the requiring process — a test harness that requires
     server.js in-process would otherwise have its own Ctrl-C call
     persistNow()/process.exit(0) on this module's behalf, exiting the test
     with code 0 and skipping its own teardown. */
  for(const sig of ['SIGTERM','SIGINT']) process.on(sig, () => { persistNow(); releaseInstance(); process.exit(0); });
  /* Before restore(), so the warning is the first thing in the log rather than
     buried under "restored N rooms". unref() so a heartbeat never keeps the
     process alive on its own. */
  claimInstance();
  setInterval(writeInstance, BEAT_EVERY).unref?.();
  restore();
  server.listen(PORT, () => {
    console.log('🌏 Republic 2126 running on port ' + PORT);
    console.log('💾 rooms saved to ' + STORE + ' · kept for ' + TTL_DAYS + ' days');
    /* Said at boot, in the deploy log, because the alternative is finding out
       in a hall with three hundred students in it. */
    if(setupNeeded()){
      const where = process.env.RAILWAY_PUBLIC_DOMAIN
        ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN + '/setup' : 'the /setup page on this site';
      console.log('');
      console.log('🔑 ============================================================');
      console.log('🔑  FIRST-RUN SETUP — no admin password is set yet.');
      console.log('🔑  Open ' + where + ' and enter this code:');
      console.log('🔑');
      console.log('🔑      SETUP CODE: ' + SETUP_CODE);
      console.log('🔑');
      console.log('🔑  (Or set ADMIN_KEY and HALL_KEY in Railway\'s Variables.)');
      console.log('🔑 ============================================================');
      console.log('');
    }
    const shortHall = process.env.HALL_KEY && !HALL_ON;
    if(shortHall)
      console.warn(`⚠️  HALL_KEY is only ${String(process.env.HALL_KEY).length} characters — it needs at least 8, so it is being ignored.`);
    if(!HALL_ON && !ADMIN_ON)
      console.warn('⚠️  Neither HALL_KEY nor ADMIN_KEY is set — NO HALL ROOM CAN BE OPENED on this server.');
    else if(!HALL_ON)
      console.warn('⚠️  HALL_KEY is not set — a hall can only be opened with the admin key.');
  });
}
module.exports = { newRoom, reg, unregTeam, moveTeam, pullCountry, findTeam, getRoom, regRoom, CODES, PIDS, ROOMS, persist, persistNow, trusted, stockpile, dealMaterials, tallyCard, closeCard,
  discussionEnd, discussing, DISCUSS_MS, DECIDE_FLOOR_MS,
  claimInstance, releaseInstance, writeInstance, readInstance, BEAT_FILE, BEAT_STALE,
  /* ACT_ROLES is exported for one reason: tests/minister-client.test.js
     compares it, key set and value, against the client's copy in
     public/index.html. A hand-typed list of acts in the test could not see a
     row that exists on only one side, which is exactly how `programme` came to
     be server-only. Nothing at runtime reads it through this export. */
  MINISTRIES, ACT_ROLES, mayAct, mayWrite, mayPick, refusal };
