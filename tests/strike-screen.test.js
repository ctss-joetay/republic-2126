/* Spec D §4. The projected announcement is the most visible thing this
   feature puts in a room, and the least testable — it is a full-screen
   overlay laid out in vh/vw. What CAN be pinned is the logic around it: that
   it paints once per strike rather than once per 2.2-second poll, that
   dismissing it is local and never touches the room, and that it does not
   fight the card overlay it sits on top of.

   Functions are pulled straight out of public/host.html rather than retyped,
   the same way console.test.js and minister-client.test.js pull theirs. */
const assert = require('assert');
const path = require('path');
const { loadFn, extractFn } = require('./helpers');

const PAGE = path.join(__dirname, '..', 'public', 'host.html');
let pass = 0, fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; } };

const strikeRoll = loadFn('strikeRoll', { esc:(s)=>String(s) }, PAGE);

const HITS = [
  { name:'Bakau',   displaced:7, coins:22, held:false },
  { name:'Selat',   displaced:3, coins:9,  held:false },
  { name:'Merlion', displaced:0, coins:0,  held:true }
];

check('the roll names who was hit and what it cost them', () => {
  const html = strikeRoll(HITS);
  assert.ok(html.includes('Bakau') && html.includes('7'), 'a struck country is missing from the roll');
  assert.ok(html.includes('22'), 'the coin loss is missing');
});

check('the roll names who HELD THE LINE — the whole point of putting it on a wall', () => {
  const html = strikeRoll(HITS);
  assert.ok(html.includes('Merlion'), 'a shielded country was left off the roll entirely');
  assert.ok(/held/i.test(html), 'a shielded country is listed but not as holding the line');
});

check('a single displaced person is phrased in the singular, not "1 lost their homes"', () => {
  /* strikeRoll's own copy of the same wording server.js's lostHomesPhrase
     settles on (host.html has no way to import that helper — see the
     comment on strikeRoll itself). Both used to write `${h.displaced} lost
     their homes` unconditionally, so a lightly-defended country's own row on
     the wall read "1 lost their homes". */
  const html = strikeRoll([{ name:'Solo', displaced:1, coins:4, held:false }]);
  assert.ok(html.includes('1 person lost their home,'),
    'a single displaced person was not phrased in the singular: ' + html);
});

check('an empty roll does not throw', () => {
  assert.strictEqual(typeof strikeRoll([]), 'string');
  assert.strictEqual(typeof strikeRoll(undefined), 'string');
});

check('a country name that looks like HTML is escaped', () => {
  /* The REAL esc — public/host.html carries its own, at :965. An identity
     stub cannot tell an escaped interpolation from an unescaped one, so every
     check above would stay green with esc() deleted from the roll. */
  const realEsc = loadFn('esc', {}, PAGE);
  const strict = loadFn('strikeRoll', { esc: realEsc }, PAGE);
  const html = strict([{ name:'<img src=x onerror=alert(1)>', displaced:1, coins:0, held:false }]);
  assert.ok(!html.includes('<img'), 'a country name was injected as markup');
  assert.ok(html.includes('&lt;img'), 'the name was dropped rather than escaped');
});

/* renderHostStrike drives the DOM, so it is exercised against a stub $ that
   records what it was asked for — the same trick console.test.js uses.
   classList tracks real class membership in a Set, keyed by whatever class
   name add()/remove()/contains() are actually called with — the same shape
   makeDom() in console.test.js uses for its 'hidden' toggle, generalised to
   any class name because this file has two different classes to watch
   (#hstrike's 'on', #showStrikeBtn's 'hidden') on stubs built from the same
   el(). Fix round 1 (review): the previous version tracked one inverted
   boolean (_on) that add() and remove() had backwards relative to real DOM
   semantics, and nothing in the file ever asserted against it — a dead stub
   that let the #showStrikeBtn desync bug through unnoticed. */
const mkStub = () => {
  const els = {};
  const el = () => ({
    classList: {
      _set: new Set(),
      add(cls){ this._set.add(cls); },
      remove(cls){ this._set.delete(cls); },
      contains(cls){ return this._set.has(cls); },
      toggle(cls, force){
        const want = force === undefined ? !this._set.has(cls) : !!force;
        if(want) this._set.add(cls); else this._set.delete(cls);
        return want;
      }
    },
    innerHTML:'', textContent:''
  });
  return { $:(id)=> els[id] || (els[id] = el()), els };
};

check('a strike paints once, not once per poll', () => {
  const stub = mkStub();
  let paints = 0;
  const R = {};
  const render = loadFn('renderHostStrike',
    { R, $:stub.$, paintHostStrike:()=>{ paints++; } }, PAGE);
  const d = { lastStrike:{ at:1000, hits:HITS } };
  render(d); render(d); render(d);
  assert.strictEqual(paints, 1, `painted ${paints} times for one strike — the projector would flash every 2.2s`);
  render({ lastStrike:{ at:2000, hits:HITS } });
  assert.strictEqual(paints, 2, 'a NEW strike did not raise the overlay');
});

check('a room with no strike yet paints nothing and does not throw', () => {
  const stub = mkStub();
  let paints = 0;
  const R = {};
  const render = loadFn('renderHostStrike', { R, $:stub.$, paintHostStrike:()=>{ paints++; } }, PAGE);
  render({});
  render({ lastStrike:null });
  assert.strictEqual(paints, 0);
});

check('a dismissed strike is not raised again by the next poll', () => {
  const stub = mkStub();
  let paints = 0;
  const R = {};
  const render = loadFn('renderHostStrike', { R, $:stub.$, paintHostStrike:()=>{ paints++; } }, PAGE);
  const d = { lastStrike:{ at:1000, hits:HITS } };
  render(d);
  R._strikeUp = null; R._strikeOff = 1000;      // what hideStrike() does
  render(d); render(d);
  assert.strictEqual(paints, 1, 'a teacher who dismissed the announcement had it thrown back at them');
});

/* Fix round 2 (review, Important): room.lastStrike is never cleared — not by
   clear, not by advanceRound, not at final — and it survives a server
   restart via snapshot(). On a genuinely fresh page load R._strikeUp is
   undefined, exactly like the R={} fixtures above, so without a round check
   the very first poll after ANY console reload would raise whatever strike
   is sitting in room.lastStrike, however old, full-screen over the projected
   leaderboard — a teacher's instinct on a misbehaving console is to refresh,
   and that refresh would put a stale disaster on the wall in front of the
   room. */
check('a strike from an earlier round does not auto-raise on a fresh console load', () => {
  const stub = mkStub();
  let paints = 0;
  const R = {};   // a fresh load: R._strikeUp is undefined, same as the real page
  const render = loadFn('renderHostStrike', { R, $:stub.$, paintHostStrike:()=>{ paints++; } }, PAGE);
  const d = { round:5, lastStrike:{ at:1000, round:2, hits:HITS } };
  render(d); render(d);
  assert.strictEqual(paints, 0,
    'a strike from three rounds ago full-screened itself over the projector on a console reload');
});

check('a strike from the CURRENT round still auto-raises on a fresh console load', () => {
  const stub = mkStub();
  let paints = 0;
  const R = {};
  const render = loadFn('renderHostStrike', { R, $:stub.$, paintHostStrike:()=>{ paints++; } }, PAGE);
  const d = { round:5, lastStrike:{ at:1000, round:5, hits:HITS } };
  render(d);
  assert.strictEqual(paints, 1, 'a genuinely current strike was suppressed along with the stale ones');
});

/* Fix round 1 (review, Important): renderHostStrike/paintHostStrike never
   touched #showStrikeBtn — only hideStrike() and showStrike() did. A normal
   hall sequence breaks that: a strike lands, the teacher dismisses it
   (revealing "Show the strike again"), then a NEW strike lands before they
   click it. The next poll's renderHostStrike auto-raises the overlay for the
   new strike, correctly, but nothing hid the button — so it sat on screen
   claiming the overlay was down while it was up in front of the room. This
   wires the REAL renderHostStrike, paintHostStrike and hideStrike together
   (not the paints-counter stub above, which cannot see button state at all)
   so the sequence is exercised exactly as tick() and hideStrike() drive it. */
check('showStrikeBtn is re-hidden when a NEW strike auto-raises the overlay after a dismissal', () => {
  const stub = mkStub();
  const R = {};
  const esc = (s) => String(s);
  const src = [
    extractFn('strikeRoll', PAGE),
    extractFn('renderHostStrike', PAGE),
    extractFn('paintHostStrike', PAGE),
    extractFn('hideStrike', PAGE)
  ].join('\n\n');
  const build = new Function('$', 'R', 'esc', `
    ${src}
    return { renderHostStrike, hideStrike };
  `);
  const { renderHostStrike, hideStrike } = build(stub.$, R, esc);

  renderHostStrike({ lastStrike:{ at:1000, hits:HITS } });          // 1. a strike lands, overlay up
  assert.strictEqual(stub.$('hstrike').classList.contains('on'), true,
    'the overlay did not come up for the first strike at all');

  hideStrike();                                                     // 2. the teacher dismisses it
  assert.strictEqual(stub.$('showStrikeBtn').classList.contains('hidden'), false,
    'hideStrike did not reveal "Show the strike again"');

  renderHostStrike({ lastStrike:{ at:2000, hits:HITS } });          // 3+4. a NEW strike auto-raises

  assert.strictEqual(stub.$('hstrike').classList.contains('on'), true,
    'the new strike did not raise the overlay');
  assert.strictEqual(stub.$('showStrikeBtn').classList.contains('hidden'), true,
    'a NEW strike auto-raised the overlay but left "Show the strike again" on screen — the button lies about the overlay\'s real state');
});

check('hideStrike is local — it never calls act() or touches the room', () => {
  const src = require('fs').readFileSync(PAGE, 'utf8');
  const fn = src.slice(src.indexOf('function hideStrike'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(!/act\(|api\(/.test(body),
    'hideStrike posts to the server — dismissing the wall would change the game');
});

check('the strike overlay never touches the card overlay\'s state', () => {
  const src = require('fs').readFileSync(PAGE, 'utf8');
  for (const name of ['renderHostStrike', 'paintHostStrike', 'hideStrike', 'showStrike']) {
    const fn = src.slice(src.indexOf('function ' + name));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.ok(!/_cardUp|_cardOff|'hcard'|"hcard"/.test(body),
      `${name} reaches into the card overlay — a strike must not dismiss an open card`);
  }
});

console.log('');
console.log(pass + '/' + (pass + fails) + ' passed');
process.exit(fails ? 1 : 0);
