# 🏙️ Republic 2126

A classroom mass game for Secondary 3–4. Groups of five run a country: they appoint five
ministers, split a fixed pool of nation-building points between four ministries, spend
limited land, workers and food on industries, then take their country through five rounds of
scenario cards — trading and forming alliances with the other countries in the room.

**The winner is not the richest country. It is the most well-rounded one.**
Wealth, Harmony, Stability, Knowledge, Defence and Green are all scored, and the overall
score is pulled down by whichever pillar is weakest. A country that strips its forests and
divides its people will finish with the most coins and near the bottom of the table.

---

## What is in the box

| File | What it is |
|---|---|
| `server.js` | The whole back end. Node's built-in `http` only — **zero npm dependencies**. |
| `game_engine.js` | The rules: cards, industries, scenarios, meters, income and scoring. |
| `city.js` | The isometric city renderer — buildings, traffic, crowd, weather, drawn from the meters. |
| `public/index.html` | The student app (one self-contained file, engine and city renderer inlined). |
| `public/host.html` | The teacher console (one self-contained file, engine inlined). |
| `public/slides.html` | The briefing deck at `/slides` — four run-sheets: form teacher, game master, class, admin. |

Rooms live in memory and are mirrored to `data/rooms.json` (or a Railway volume at `/data`), so
a cohort can build their countries one day and play the mass game the next. No database, no
accounts, no student data — just a country's own details and the six 5-letter codes the server
dealt it. Idle rooms are swept after 14 days; set `ROOM_TTL_DAYS` to change that.

---

## Running the lesson

The lesson runs across two sessions, each in its own room. `/host` offers a choice of **🏫
Classroom room →** or **🏟️ Hall room →** the moment you open it.

**Session 1 — your classroom, your room**

1. Open a **classroom room** and label it with your class, e.g. "3E". This room is yours
   alone.
2. Type how many groups you have and press **Set**. The server mints codes and deals
   homelands for you.
3. Hand each group its six codes — leader code to one iPad only, one ministry code to each of
   the other four, class code to a sixth device or a spare. See *Six codes, five roles*, below.
4. Throw up to **three practice cards** whenever you like, to let groups feel the meters
   move before anything counts.
5. Vet the names as they come in: ✏️ to fix one yourself, ↩️ to ask a group to choose a
   different one.
6. Finish the session once every group shows 🔒 (committed).

**Session 2 — the hall**

7. Open a **hall room** and project its room code — one hall room for the whole cohort.
8. Groups type their leader code, then the hall room code, and their committed country
   arrives exactly as they left it.
9. Play as normal: throw a scenario card, let the cabinets argue and decide, give them time
   to trade and form alliances, press **Next round ▶**. Five rounds, roughly 25 minutes,
   then **3 · Final results** to reveal every country's title and the final table.

   The first minute after a card lands is discussion only — the server refuses every
   decision, trade and alliance until it passes, and every phone counts it down. Read the
   story aloud into that minute. If you have set a short card clock, the window shortens
   itself so there are always fifteen seconds left to decide.
10. Press **📊 How the hall voted**, which appears beside it once the game is called. One
    screen per card: how many countries chose each option, and how many could not agree in
    time. Arrow keys step through it, `Esc` closes it. Nothing is shown before the game is
    called, on the server as well as on the page — the console is projected, and a live
    tally tells a group what everyone else picked.

### Two sessions

A classroom room and a hall room are deliberately separate rooms, not two modes of one room.
A classroom room's console carries the setup tools — set groups, throw practice cards, vet
names — because that work belongs to one class at a time. A hall room's console drops those
and gains one the classroom console does not have: pulling a stranded country in by its
leader code, because that is the rescue a hall session actually needs. Committed countries
move from a classroom room into a hall room by request, not automatically — see step 8 above
— so a class can finish building today and the whole cohort can still meet in the hall on a
different day.

### Creating class rooms in advance

Class rooms are created from `/admin` before the event, one per class, and each teacher is
handed a **room code** and a **host key**. Only countries from these rooms can be brought into
a hall — a room somebody opens themselves at `/host` is stamped `self` and is refused at the
door (`pullCountry`, and the same guard on a group's own **Join the hall**). Rooms created
before this feature shipped carry no stamp and stay trusted, so wipe old test rooms from
`/admin` before an event.

If a class room does get opened from `/host` by mistake instead of `/admin`, its countries
are not stuck: open `/admin`, find the room in the list, and press **Trust this room** — from
then on it is treated exactly like a room `/admin` created, and its committed countries can
join the hall.

A classroom has no rounds and earns no coins. Its host presses **📦 Deal trade materials**,
which stockpiles what each country's industries produce so groups can trade, without paying
income — coins feed the score directly, trade materials do not.

### Six codes, five roles

Every group is dealt six 5-letter codes, all drawn independently of one another — none can be
derived from any other. Handed out, they turn a group of five into five people with something
to do rather than one leader and four spectators:

| Code | Who holds it | What it opens |
|---|---|---|
| Leader code | one device | Everything — see *Who may write what*, below. The one-iPad fallback: a group that never hands out the other five codes plays exactly as it always has. |
| `minCodes.edu` | Minister of Education | 📚 Education's own picks, and — once the hall opens — buying education programmes. See *Education programmes*, below. |
| `minCodes.def` | Minister of Defence | 🛡️ Defence's own picks, and proposing alliances. |
| `minCodes.trade` | Minister of Trade & Industry | ⚖️ Trade's own picks and sending goods. The server also grants this code write access to `industries` (see *Who may write what*, below); the minister screen has no industry-siting UI in prep, but once the hall opens this device gets its own Industry tab — see *The fifth tab*, below. |
| `minCodes.infra` | Minister of Infrastructure & Home Affairs | 🏗️ Infrastructure's own picks. The server also grants this code write access to `buildings` (see *Who may write what*, below); the minister screen has no build-land UI in prep, but once the hall opens this device gets its own Build tab — see *The fifth tab*, below. |
| Class code (`viewCode`) | a sixth student, or whoever's iPad died | A watching pass: the device shows the same country, but every change is refused. Unchanged from before ministries existed — the spare seat, not a sixth ministry. |

**The one rule:** a device receives the code it arrived with, and no other. `GET /api/state`
strips every code but the one the caller used to ask — a minister's device never sees the
other three ministries' codes, or the leader's, or even its own room's class code. There are
exactly two exceptions, and both belong to the leader alone: the leader receives `viewCode`
and all four `minCodes` alongside its own, because the leader is the one who reads them out to
the group and reissues one if a slip goes missing.

When the leader brings the country into the hall, every one of the six codes travels with it
automatically — nobody holding one needs to do anything.

### Who may write what

`/api/team/save` accepts a whole country in one POST, but each field has exactly one owner, and
a field the caller does not own is **dropped from the save silently**, never refused — a device
autosaving its own stale copy of the country is normal operation, not an attack.

| Field | Owner |
|---|---|
| `name`, `motto`, `emblem`, `col1`, `col2`, `stripe`, `empos` | Leader |
| `members`, `split`, `ready` | Leader |
| `picks.edu` † | Education |
| `picks.def` † | Defence |
| `picks.trade` † | Trade & Industry |
| `picks.infra` † | Infrastructure & Home Affairs |
| `buildings` | Infrastructure & Home Affairs |
| `industries` | Trade & Industry |
| `homeland`, `meters` | Nobody — dealt or computed by the server, writable by no caller, leader included |

† The four `picks.*` rows are not actually keys of `FIELD_OWNER` — they read the same in this
table because the ownership question is the same, but in the code they are gated by a separate
`mayPick(role, ministry)` function, because a ministry's picks need two things a flat field gate
cannot express: a per-key filter against that ministry's own `E.CARDS[m]`, and a post-merge check
against the budget its Leader set (below).

The **leader is a superset** of every ministry and may write every field above, including any
ministry's own `picks` — again, the one-iPad fallback. `picks` merges per ministry rather than
replacing wholesale: an Education device posting `picks.edu` cannot touch `picks.def`, whether
or not `picks.def` was even present in its request. Two refusals belong to this feature itself —
both loud, not silent, and both restore the whole country, not just the field that failed: a
`picks` change that pushes a ministry over the budget its Leader set, and any write at all to a
country that has already committed. (`industries` and `buildings` carried their own
refuse-and-restore checks — over-resource plans — before ministries existed, and a resubmitted
rejected name is refused the same way too; none of the three is new here.)

Nine further actions are routed by role rather than by field — `save`, `trade`, `ally`,
`ally+trade`, `choose`, `commit`, `hall`, `programme` and `mandate`. **Defence owns alliances and
Trade owns goods**: a single trade offer carries one act or the other, never both, from a ministry
device. Only the Leader may combine them in one offer — again the one-iPad fallback, and the
reason a group that never hands out ministry codes can still propose an allied trade in one tap.

| Act | Who |
|---|---|
| `save` (per field, above) | Leader, and each ministry for its own fields |
| `trade` — a goods offer, no alliance | Leader, Trade |
| `ally` — an alliance offer, no goods | Leader, Defence |
| `ally+trade` — one offer carrying both | Leader only |
| `choose` — answer a scenario card | Leader only |
| `commit` — lock the country for the hall | Leader only |
| `hall` — bring the country into the hall room | Leader only |
| `programme` — buy an education programme | Leader, Education |
| `mandate` — open or close a ministry's own door | Leader only. This is the one act that changes what everybody else may do, so it is the one act no ministry shares. |

### Two copies of one table

The role table above exists twice in the code — as `ACT_ROLES`/`FIELD_OWNER` in `server.js`,
and again as `ACT_ROLES` in `public/index.html`. That duplication is deliberate, not drift: the
student app has no build step and no import, and asking the server what a button may do would
put a round trip in front of every render. **The server's copy is the one that decides** — the
client's copy only stops a device from asking a question it already knows the answer to.
`tests/minister-roles.test.js` and `tests/minister-client.test.js` assert the same facts on both
copies, so the two cannot quietly drift apart.

### The fifth tab, in the hall

Once a country is in the hall (`phase === 'game'`), four of the six roles get a fifth tab
alongside the four everybody always has (My country, Scenario, Trade, Region). Its label depends
on the role signed in; Defence and a watching device get no fifth tab at all:

| Role | Fifth tab |
|---|---|
| Leader | 🏛️ Ministries — a switcher over four hall panes below (Build, Industry, Programmes, Cabinet), the first three writable and the one-iPad fallback again; the fourth, Cabinet, is where the Leader sets what everybody else may do — see *The Leader's cabinet*, below |
| Infrastructure & Home Affairs | 🏗️ Build |
| Trade & Industry | 🏭 Industry |
| Education | 📚 Programmes |
| Defence | none — their between-cards work is the alliance half of the Trade tab, which they already have |
| Class code, or a watching member | none — the city still animates on My country |

Build and Industry reuse the same land grid prep uses at the **Build** and **Industry** steps, so
a minister taps a plot exactly as they would there. Every non-Leader role is read-only on that
land grid in prep; in the hall that lock is lifted for exactly the one pane a role is allowed to
write — Infrastructure's Build pane, Trade's Industry pane — and stays locked everywhere else.
See *Building during the hall*, below, for what a tap there now does.

### Printing the codes

**From the teacher console (the usual way).** On a classroom room, press **🖨 Print slips**
beside *How many groups?*. It opens one A4 page per group, cut along the dashed lines into six
strips — Leader, the four ministers, and the spare class code — each with its own QR code that
opens `/play` with the code filled in. Each student gets only their own strip, so nobody has to
read codes off the projected roster. *Save as PDF* in the print dialog gives one file with every
group. The host key is never printed.

**From the command line (for a whole cohort at once).**
`tools/make-slips.js` prints six QRs per group's page — the leader code large at the top, the
four ministry codes in a labelled row beneath it, and the class code demoted to a small "spare
device" corner — plus, per class, a second summary sheet of the four ministry columns beside
the existing leader/class sheet, so any lost slip can be reissued from the front of the room
without a laptop. A printed page is now six working credentials, not two — treat it accordingly.

```bash
node tools/make-slips.js --in rooms.json --base https://your-app.up.railway.app
```

`--base` is the address students open. It has no default, so a slip can never point at
another school's copy.

### Committing

A group commits by pressing **We are ready ✓**. Committing locks the country's name, flag,
ministers, points, policy cards, buildings and industries. A teacher can reopen a committed
country from the console (🔓 *Reopen for editing*) — it then has to commit again before it
counts in the hall.

### If something goes wrong on the day

Two rollback levers, each scoped to the room kind that needs it:

- **A classroom console can re-enable joining by room code, at any time.** Setting the number
  of groups turns this off automatically, but *Allow open joining* flips it back on again —
  mid-lesson, after setup, whenever a teacher needs it — and immediately lets a new group mint
  itself a country with the room-code-and-name flow. This is deliberately unavailable on a hall
  console — a hall session has no use for anyone minting a fresh country mid-game.
- **A hall console can pull a stranded country in by its leader code.** If a device dies
  before its country migrates itself, type the leader code into *Bring them in* on the hall
  console and it joins the hall directly.

### The briefing deck

`/slides` is a projectable deck holding four run-sheets, one per person who needs briefing,
switched by a toggle at the top:

- **🎛️ Teacher** (`t`) — the form teacher running Session 1 in their own classroom: opening a
  classroom room, setting the group count, handing out leader and class codes, up to three
  practice cards, vetting names, the commit gate, and the debrief questions for afterwards.
- **🏟️ Hall** (`g`) — the game master running Session 2 for the whole cohort: opening the hall
  room and projecting its code, bringing committed countries across, the rhythm of a round
  (card, clock, trade, next round), rescuing a stranded country by leader code, calling
  final results whenever the room is ready to stop, and showing the hall what it decided.
- **🎮 Class** (`s`) — the leader and class codes, the five roles, the eight build steps,
  committing, and why the weakest pillar decides the winner.
- **🗝️ Admin** (`a`) — whoever sets the thing up: deploying to Railway, `ADMIN_KEY`, the
  `/admin` panel, backups and restore, and the one-replica rule.

**The deck has not been updated for the four ministry codes.** The Teacher run-sheet still talks
about "handing out leader and class codes" and the Class deck still teaches only those two — no
slide mentions `minCodes` or how a minister's code differs from the class code that predates it.
So the run-sheets a class actually reads off the projector are silent on the credential in four
of the five students' hands, and a teacher running this needs to explain the ministry codes some
other way — in words, or from the *Six codes, five roles* section above — until the deck itself
is updated to match.

Reach it from the console's setup screen — **📽️ Teacher run-sheet** sits beside the classroom
room button and opens straight to the teacher deck, **📽️ Game master run-sheet** sits beside the
hall room button and opens straight to the hall deck — or from **📽️ New here? How to play →** on
the student join screen, which opens the class deck. Both console links exist because `/host`
serves whichever room a person is about to open, classroom or hall, and a bare `/slides` link
would otherwise land a game master checking their run-sheet moments before a hall event on the
classroom deck instead. Arrow keys or space to advance, <kbd>F</kbd> for fullscreen, <kbd>T</kbd>
to cycle through all four decks, <kbd>P</kbd> to print or save as PDF — printing only ever
includes the deck currently open.

The join address is filled in from wherever the deck is served, so it always shows the right URL.
Two optional parameters: `/slides?track=` takes `s`/`student`, `t`/`teacher`, `g`/`gamemaster`/`hall`
or `a`/`admin`, and opens straight to that deck; `/slides?room=ABCD` prints that room code in large
type on the class deck's commit-and-hall-join slide — handy when projecting for session 2.

Both the class deck's **Get into the room** slide and its closing **Ready?** slide carry a QR
code beside the play address, and the join page carries one beside the how-to-play link.
They are generated in the browser by `public/qr.js` from `location.origin`, so they follow the
app to any domain without being regenerated. `tests/qr.test.js` pins the encoder's output
against fixtures produced by an independent generator.

---

## Deploy to Railway

### Deploy your own copy (for other schools)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/4G-wDK)

1. Press the button and sign in to Railway.
2. Type an **admin password** (16+ characters) and a **hall key** (8+ characters) into the two
   boxes Railway shows. Write both down.
3. Press **Deploy**, and open your site's address when it finishes.
4. Open **`/admin`**, enter the admin password, and create a class room for each class.

If the admin password was too short, the site sends you to **`/setup`** to choose again; the
code it asks for is `SETUP_CODE` in your service's Variables tab.

Your copy is entirely your own: its own rooms, its own passwords, nothing shared with any other
school. How the template is built is in [docs/RAILWAY_TEMPLATE.md](docs/RAILWAY_TEMPLATE.md).

### Passwords: Railway variables or the setup page

The server needs two keys. `ADMIN_KEY` (16+ characters) opens `/admin`. `HALL_KEY`
(8+ characters) opens a hall room. Each can come from a Railway variable or from the setup page,
which saves them to `keys.json` on the `/data` volume. A Railway variable always wins.

While there is no admin key, the server prints a one-time **setup code** to its deploy log, and
`/setup` accepts the keys only with that code. Without the code, whoever found the URL first
could claim the site. Set `SETUP_CODE` in Railway to choose the code yourself (the template does
this with a generated value). Once an admin key exists, `/setup` is shut for good. To start
again, delete `/data/keys.json` and redeploy.

### Setting one up from scratch

1. Push this folder to a new GitHub repository.
2. In Railway: **New Project → Deploy from GitHub repo** and pick it. If your repo does not
   appear, the Railway GitHub App has not been granted access to that account or organisation —
   authorise it from the repo picker, then try again.
3. Railway detects Node via NIXPACKS and runs `npm start`. No environment variables are
   needed to start — the server reads `process.env.PORT` automatically, and the passwords can
   be set afterwards at `/setup` (see above).
4. Under **Settings → Networking**, click **Generate Domain**. That URL is what the class uses.
5. Under **Settings → Volumes**, add a volume mounted at **`/data`**. The server finds it on
   its own. Without it, rooms survive a restart but not a redeploy.

### Option B — from the command line

```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```

### Checking it is alive

`GET /health` returns `ok`. Railway's health checks can point at that path.

### One replica, always

Rooms live in this process's memory. If Railway runs two copies of the server, half the class
lands on a copy that has never heard of the room code. Leave **Settings → Deploy → Replicas at
1** and do not switch on horizontal autoscaling. One replica carries the whole cohort
comfortably — see below.

### Why not Vercel

Vercel runs this as serverless functions, and a serverless function does not keep anything in
memory between requests. The room a teacher opens would be gone by the time the first group
tried to join. Hosting it there would mean rewriting the room store onto Redis or a database.
Railway runs one long-lived process, which is exactly what this game needs.

---

## Running it for a whole cohort

Measured on this code with fifty groups in one room and 250 devices polling together:

| | |
|---|---|
| One student poll, on the wire | **1.2 KB** (gzip) |
| One student poll when nothing has changed | **304, no body at all** |
| The whole page, first load | **39 KB** (gzip), then `304` on every reload |
| 250 devices polling at once | served in **253 ms**, 306 KB total |
| Server memory with 50 groups | **62 MB** |
| Egress for a 30-minute game, 250 devices | **under 0.1 GB** |

Three things make that work, and all three are already in the code:

- **Every response is gzipped.** 13 KB of leaderboard JSON goes down the wifi as 1.2 KB.
- **Unchanged answers cost nothing.** Each room carries a revision number; if a device already
  has the current revision the server replies `304 Not Modified` with an empty body.
- **Big rooms poll more slowly.** Above 30 countries the student app eases from every 2.5
  seconds to every 6, which nobody notices on a leaderboard and the hall wifi certainly does.

---

## Running it locally first

```bash
node server.js
# → http://localhost:3000/host   (teacher)
# → http://localhost:3000/play   (students)
```

Node 18 or newer. Nothing to install.

---

## Running the tests

```bash
npm test
```

Plain Node scripts, no dependencies — `engine-sync` guards against `game_engine.js` and its two inlined duplicates inside `public/index.html` and `public/host.html` drifting apart (there is no build step; see below). It extracts the shared engine block from each file and compares it byte-for-byte against `game_engine.js`, so it pins the code that actually ships rather than a copy of it. It does the same for `city.js`, which is inlined into `public/index.html` and — unlike `game_engine.js` — is never served, so a change made only to the master file runs nowhere at all. `flag-persistence` and `buildings-persistence` start a real server on a throwaway data directory and round-trip a country through the API.

After editing `game_engine.js` or `city.js`, run `node tools/sync-engine.js` to copy
each block into the pages that carry it, then `npm test` — the sync tests fail if
any copy disagrees.

---

## Changing the game

Everything a teacher would want to tune sits at the top of `game_engine.js`:

```js
const GAME = {
  pointPool: 24,     // nation-building points the Leader splits between four ministries
  minMinistry: 3,    // no ministry may be starved below this
  maxMinistry: 12,
  rounds: 5,
  startCoins: 20
};
```

Policy cards, industries, homelands and scenario cards are plain arrays just below —
add or reword them freely, keeping the same fields.

### The same card, different countries

A scenario choice can land differently depending on what a country built, which
policy cards it took, where it lives and how it is doing. *Shut the dirty
factories* costs a country with three factories far more than one with none, and
that country is told so — in words, before it commits — while the projector goes
on showing the neutral card to the room.

The variation is capped at the choice's own weight, so it always tilts a decision
and never reverses it, and no card can be ruinous however it is authored. Three
cards carry these today — *The Haze Returns*, *Raiders at Sea* and *The Water
Runs Low* — and the header of `hall-scenarios.js` explains how to write more.

### The decision clock and failing to decide

The console has a **Decision time** control — 1, 2 or 3 minutes, or Off. Once a
length is chosen, every scenario card you throw starts the clock automatically,
and the round ending stops it. The countdown shows on the console and on every
student device, counted from a server-supplied end instant so all of them agree.

**Running out advances nothing.** The clock turns red, says how many countries
are still deciding, and waits for you to press *Next round ▶*. Pacing stays
yours.

A country that never decided on the open card takes the `INDECISION` penalty in
`game_engine.js` — currently Stability −4 and Harmony −3, and no coins. Before
this, silence was free: on five of the eight cards every option costs coins, so
saying nothing was often the cheapest play. The penalty is deliberately milder
than the worst real choice, so groups are nudged into deciding rather than
panicked into picking at random; `tests/indecision.test.js` asserts that.

### Housing and industry

A country starts with only about half its workforce housed, and industries can
only employ workers who have somewhere to live. Buildings cost **materials and
food** — the two resources nothing else in the game consumes — which is what
makes trading two-sided: River Delta runs short of materials with food to spare,
Dry Plains the reverse.

Every building except Homes is unlocked by the Infrastructure policy card that
names it, so what a group picked at **Policies** decides what it can place at
**Build**. Homes are always available, so a group that skips Infrastructure is
never stranded — `tests/balance.test.js` asserts that for all six homelands.

Because some homelands genuinely cannot finish alone, **groups can trade during
nation-building**, from the Build step — not only once the mass game starts. The
server never gated `/api/trade` on the room phase; the panel simply used to be
reachable only from the mass game, which was no use to a country that could not
house its people without materials it did not have.

The buildings themselves are the `BUILDINGS` array near the top of
`game_engine.js`; add or retune them there, then run `node tools/sync-engine.js`
and `npm test`. A new building also needs a tile in `BUILD_TILE` in `city.js`,
or it will simply never appear on the island; `tests/housing.test.js` fails if
you forget.

### Building during the hall

Buildings and industries were never locked at commit — `writable()`'s committed refusal is
scoped to `phase === 'prep'` (`server.js`), and the save handler has never had a phase gate on
either field. What the hall was missing was a screen to build from and a meter effect when you
did. Both now exist: once `phase === 'game'`, a tap on the Infrastructure Minister's Build pane
or the Trade Minister's Industry pane (see *The fifth tab*, above) posts to `/api/team/save` like
everything else — unless the Leader has closed that minister's door, see *The Leader's cabinet*,
below — but the hall applies the result differently from prep: a posted count only ever
grows a country's stock, never shrinks it — the server keeps `max(stored count, posted count)`
per building or industry key, so a stale echo from a device that has not caught up with a
teammate's build can never undo it, and nothing already standing can be taken back from a hall
pane. Only the newly-added units move the meters — `applyFx(fx × unitsAdded × FOUND_SCALE)`, the
same `FOUND_SCALE` prep's founding-meters pass already applies to every building and industry, so
a hall unit is scaled by exactly the factor a prep unit is. That equalises the *nominal* delta,
not the outcome: `nudge()` multiplies what actually lands by `min(1, (100−v)/38)`, so a building
applied to a meter that scenarios have pushed down still moves it further than the same building
would at a high prep value (a Solar farm, `fx {G:5}`, is worth about +3.1 at Green 30 and about
+1.6 at Green 80). Once the host calls `phase = 'final'`, both fields are ignored outright — a
country cannot build its way up a leaderboard that has already been read out, and `renderHall`
refuses to draw a land at all in that phase so a device rejoining late is told so rather than
tapping into silence.

### Education programmes

Coins have almost nothing to spend on before the hall — scenario costs and trade aside, a
country's treasury only ever grows. Once `phase === 'game'`, the Education Minister — unless their
Leader has closed that door, see *The Leader's cabinet*, below — or the Leader, who is never bound
by their own mandate, can spend it down one tap at a time, on six one-off programmes — each buyable
once per country, converting coins straight into meters rather than resources:

| Programme | Cost | Effect |
|---|---|---|
| 📖 Adult literacy drive (`literacy`) | 28 | Knowledge +9, Harmony +3 |
| 🏮 Mother tongue & heritage (`heritage`) | 26 | Harmony +9, Knowledge +3 |
| 🔬 Science scholarships (`science`) | 42 | Knowledge +11, Economy +6 |
| 🌱 Environmental education (`green`) | 30 | Green +9, Knowledge +3 |
| 🗳️ Civics & national education (`civics`) | 32 | Stability +8, Harmony +6 |
| 🔧 Skills retraining (`retrain`) | 38 | Economy +8, Knowledge +5, Stability +3 |

Economy is the `E` meter (`METER_INFO` in `game_engine.js`), which is *not* the Wealth pillar:
`pillars()` derives Wealth from `wealthScore(c.coins)` alone, so every programme in the table
raises the pillars named above and lowers Wealth by its price. That trade is the point.

(The names and one-line tags above are placeholder copy in the code today, flagged there to be
rewritten before the hall.)

There is deliberately no Defence programme — alliances stay Defence's identity. All six together
cost 196 coins against a five-round income of roughly 100-200, so no country affords all of them;
which to buy, and when, is the decision this feature exists to create. Unlike a hall building, a
programme applies its effect with plain `applyFx(fx)` — no `FOUND_SCALE` — because a programme has
no prep equivalent to stay level with.

`POST /api/edu/programme` takes `{ code, key }` and is the only door: coins are deliberately
absent from the `save` field table above, so no client can spend them through a bulk save. It
refuses outside `phase === 'game'`, on a key that names no programme, on a key the country has
already run, and when the country cannot afford the cost — none of the four refusals touch the
country's coins.

### The Leader's cabinet

A country's four ministries answer to WHO may act (the roles and fields above); the mandate
answers whether their Leader has left that particular door open. The two gates are orthogonal
and they stack.

`team.mandate` holds four booleans, one per switch:

| Switch | What it gates | Route |
|---|---|---|
| `build` | Infrastructure's hall Build pane | `POST /api/team/save` with a `buildings` field |
| `site` | Trade's hall Industry pane | `POST /api/team/save` with an `industries` field |
| `programme` | buying an education programme | `POST /api/edu/programme` |
| `ally` | proposing or accepting an alliance | `POST /api/trade/offer` and `POST /api/trade/respond`, on both ends — a Leader who closes `ally` blocks their Defence Minister from proposing one AND from accepting one someone else offers. Declining an offer is never gated; refusing needs no permission. |

**Sending goods and coins is never gated.** A trade offer's goods/coins half moves resources only
with the other country's consent already, and it is the act that gets students out of their
chairs — closing it would have nothing to do with what a mandate is for. Only the alliance half
of a trade offer checks the `ally` flag.

The Leader moves these four switches with `POST /api/team/mandate`, taking
`{ code, mandate:{ flag:boolean } }` — code must be the Leader's own, checked the same way every
other route checks who is calling. Only booleans move a flag; a partial body leaves every flag it
does not mention exactly as it was, and a non-boolean value is ignored rather than coerced, so a
stale or malformed echo from a device can never close a door the Leader did not close.

**The default is open, and every door stays open until a Leader closes it.** A country that starts
before this feature shipped, or one whose Leader never opens the Cabinet screen at all, has all
four switches reading open, and three separate things make sure of it. `blankCountry()`
(`game_engine.js`) writes all four as `true` the moment a country exists. `migrateTeam()`
(`server.js`) walks `E.MANDATE_FLAGS` and backfills any key that is not a boolean to `true`, per
key independently, so a country saved before this feature shipped — or one carrying a half-written
`{mandate:{build:false}}` — comes back with every other door open; that runs from `migrateRoom()`
on **both** paths a room re-enters the process, `restore()` at startup and `POST /api/host/import`.
And behind both of those, the check itself is `!== false` rather than `=== false`, so anything
absent, missing or malformed that still reaches a gate reads as open. A Leader who never finds the
Cabinet screen changes nothing about how the hall already plays.

**The Leader is never bound by their own mandate.** `mandateBlock()` returns immediately for
`role === 'leader'` before it even reads the flag — a Leader who has closed every door can still
build, site industry, buy a programme and propose or accept an alliance, all four, the whole time.
This is deliberate, not an oversight: the Leader set the mandate, so binding them to it would be
circular, and it would break the one-iPad fallback that a group who never hands out ministry codes
depends on.

**Closing a door never undoes anything already done.** The mandate gates new writes only; a
building already standing, an industry already open, a programme already bought or an alliance
already struck stays exactly as it was no matter what a Leader switches off afterwards.

A minister blocked by a closed door is refused by name, not left guessing: the server's error and
the client's own banner read the same sentence — `"<Leader's name> has closed <what>. Go and ask
<Leader's name>."` (falling back to "Your Leader" / "them" if the group never typed a Leader name)
— built from one shared table, `MANDATE_WHAT` in `game_engine.js`, so the two copies cannot drift
apart. On the minister's own hall tab this banner is drawn before anything on it is tappable — for
Build and Industry that is the very top of the pane, above the card; on Programmes the anchor sits
*inside* the card, under its heading and blurb but above the list of programmes. On the shared
Trade tab, where Defence's alliance checkbox lives rather than on a tab of its own, a closed `ally`
door draws the same banner at the top of the pane instead. An open door draws no banner at all —
silence is the normal state, not something a student has to read past every time.

**The Leader never sees a banner.** `mandateBanner()` short-circuits on `S.role === 'leader'` the
same way `mandateBlock()` does server-side, so a Leader who has closed Build and then opens their
own 🏗️ Build chip is not handed a red line telling them to go and ask themselves — the tap works,
and the screen says so by staying quiet. The two short-circuits are bound together by a check in
`tests/cabinet-screen.test.js` that drives the real client and the real server function over every
flag and every role and compares the two answers directly.

#### The Cabinet screen

Reached from a fourth chip, 🏛️ Cabinet, on the Leader's fifth hall tab, beside Build, Industry and
Programmes (see *The fifth tab*, above) — a minister has no switcher to reach it with, and it is
gated by role a second time on top of that, so a stale or rejoined tab state can never open
somebody else's screen.

The screen has two shapes. When at least one ministry is actually held, it lists all four —
🏗️ Build things, ⚖️ Open industry, 📚 Spend on programmes, 🛡️ Make alliances — each with the
holding minister's name beside it and a switch **labelled with the door's current state** — an open
door reads `open` and is highlighted, a closed one reads `closed` and is not. The *tap* does the
opposite of what the label says: tapping a switch reading `open` closes that door. (Whether a
control on a shared iPad should read its state or its action is an open question for the browser
pass; the state-label above is what ships today and `tests/cabinet-screen.test.js` pins both the
word and the highlight, so either answer stays defended.) A ministry nobody holds shows "— no one"
instead of a switch; there is nothing to close if there is nobody to close it on.

When **no** ministry is held at all — a country played by one student, with every `members` slot
but the Leader's blank — the screen shows a different message entirely: *"Nobody is holding these
jobs, so you are doing all four,"* the four jobs restated with no switches at all, and the four
ministry codes (`minCodes.infra`, `.trade`, `.edu`, `.def`) printed on one line as icon-then-code
(🏗️ **ABCDE** &nbsp; ⚖️ **FGHIJ** …), in the same order as the four jobs listed above it — the
ministry *icon* is what identifies each code, not a repeat of the job label — so a Leader can hand
one out and have someone start immediately. There is nothing to switch off when
the Leader is the only one doing the switching.

### What a group can change about its flag

Two colours, an emblem from sixteen, one of four patterns (single colour,
across, down, diagonal) and one of five emblem positions (centre, left, right,
top left, top right). All of it lives in `flagSVG()` in `public/index.html`;
the position table `FLAG_POS` is tuned so the emblem disc never crosses the
flag edge, which `tests/flag-geometry.test.js` checks for all twenty
combinations.

There is no build step: `game_engine.js` is the source of truth, but the student app and
teacher console each need the rules in the browser, so the same engine block is also pasted
verbatim into `public/index.html` and `public/host.html`. After editing `game_engine.js`,
hand-copy the block — from the `REPUBLIC 2126 — shared game engine` comment down to the
`const ENGINE = {...}` export — into both files, then run `npm test`. `engine-sync` fails
immediately, naming the file and the first differing line, if a copy is left out of date.

---

## Running many classes in one hall

Use **one hall room for everything**. Each class builds in its own classroom room, on its own
day if you like, but every class should send its countries into the same hall room. The teacher
console throws a scenario card to every country in a room at once, so one hall room means one
person controls the whole hall and one leaderboard ranks the entire cohort — which is what makes
the final reveal land.

Groups build in their classroom room during their own class period, then bring their committed
country across by typing their leader code and the hall room code — see **Committing** and
**Session 2** above. The classroom room is still there afterwards, so a device that never made it
across can still be pulled straight into the hall by its leader code.

Groups keep both their codes throughout. A flat battery, a closed tab, a different device next
week — the leader code brings the country straight back, in either room.

---

## Building on one day, playing on another

Every change is written to `rooms.json` about a second later, and read back when the server
starts, so a room outlives any restart. Mount a Railway volume at `/data` and it outlives a
redeploy too.

On day two the teacher opens `/host`, types the **room code** and **host key**, and presses
**Resume**. Both are shown when the room is first opened — write them down, they are the only
way back in.

As a belt-and-braces backup, **💾 Save backup** on the console downloads the whole room as a
JSON file, and **📂 Restore from file** on the setup screen puts it back with the same room code
and the same country codes. Worth doing at the end of day one.

While the room is still open, restoring its own backup needs nothing extra — the file's host key
matches the room's own. If the room has actually closed (the server restarted past
`ROOM_TTL_DAYS`, an `/admin` wipe, or the teacher's own **Reset**), restoring it needs the
**admin key** too, entered alongside the file — ask whoever runs the server for it. This is
deliberate: it keeps `Restore from file` from being a way for anyone to plant an arbitrary room
under a code nothing currently holds.

| Variable | Default | What it does |
|---|---|---|
| `DATA_DIR` | `/data` if it exists, else `./data` | Where `rooms.json` is written |
| `ROOM_TTL_DAYS` | `14` | How long an untouched room is kept |
| `ADMIN_KEY` | unset | Unset or under 16 characters and `/admin` loads, but every action refuses |

---

## Classroom notes

- One device per group is enough, and better than five — the argument around that one screen
  is the lesson.
- Cheap cards are cheap for a reason. Nothing is marked "bad"; groups only discover the cost
  when the meters move. Resist the urge to warn them.
- Harmony is not decoration. It multiplies the income every industry earns, so a divided
  country literally collects less money from the same factories.
- Countries start with different amounts of workers, materials and food on purpose. No group
  can build everything alone, and trade is the only way out.
- Good debrief questions: *Which decision felt cheap at the time and expensive later? Who did
  you trade with, and why them? What would you change if you started again?*
