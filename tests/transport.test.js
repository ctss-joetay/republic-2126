/* Everything about transport that is a number rather than a pixel. The
   painting is checked by rendering a frame (see "The render gate" in
   docs/superpowers/plans/2026-08-02-transport-and-trade.md); these are the
   decisions that were got wrong while prototyping and can be pinned. */
const assert = require('assert');
const { CityView } = require('../city.js');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

/* a unit square on the grid, wound anticlockwise */
const SQ = [{ x:0, y:0 }, { x:1, y:0 }, { x:1, y:1 }, { x:0, y:1 }];

check('a prism has one side wall per edge of its outline', () => {
  assert.strictEqual(CityView.prismFaces(SQ).length, 4);
  assert.strictEqual(CityView.prismFaces(SQ.slice(0, 3)).length, 3);
});

check('side walls come out sorted back to front', () => {
  /* screen depth is gx + gy, and the painter draws in order, so a wall that
     comes out later must never be further away than one that came out first */
  const f = CityView.prismFaces(SQ);
  for (let i = 1; i < f.length; i++)
    assert.ok(f[i].depth >= f[i - 1].depth,
      `wall ${i} at depth ${f[i].depth} is painted after ${f[i - 1].depth}`);
});

check('the nearest wall is painted last, whichever way the outline was wound', () => {
  const back = SQ.slice().reverse();
  const near = (fs) => fs[fs.length - 1].depth;
  assert.strictEqual(near(CityView.prismFaces(SQ)), near(CityView.prismFaces(back)));
});

check('every wall is labelled left or right, and both walls exist', () => {
  const sides = CityView.prismFaces(SQ).map(f => f.side);
  for (const s of sides) assert.ok(s === 'a' || s === 'b', 'unknown side ' + s);
  assert.ok(sides.indexOf('a') >= 0 && sides.indexOf('b') >= 0,
    'a square prism must show both a left-facing and a right-facing wall');
});

check('a long hull pointing along the grid still splits left from right', () => {
  /* screen x is (gx - gy): a shape stretched along +gx leans right, and its
     two long walls must still be told apart or the hull paints flat */
  const hull = [{ x:0, y:0 }, { x:4, y:0 }, { x:4, y:1 }, { x:0, y:1 }];
  const sides = CityView.prismFaces(hull).map(f => f.side);
  assert.ok(sides.indexOf('a') >= 0 && sides.indexOf('b') >= 0,
    'a hull drawn along the grid shows only one wall colour');
});

check('shipping on a coast stays out at sea', () => {
  /* the whole point of SHORE is that anything at a greater depth is water.
     A hull half on the beach is the same bug class as the cars that drove
     into the sea on the last branch. */
  for (let i = 0; i < 4; i++)
    assert.ok(CityView.shipDepth('coast', i) > CityView.SHORE + 1,
      `ship ${i} sails at depth ${CityView.shipDepth('coast', i)}, on top of the shoreline at ${CityView.SHORE}`);
});

check('shipping round an island sails on the water, not in the sky or on the land', () => {
  /* Two walls, close together, and the fleet has to fit between them. The
     drawn sea starts at HORIZON — anything shallower is painted sky. Depth 0
     is the back corner of the built grid — anything deeper is the country. */
  for (let i = 0; i < 4; i++) {
    const d = CityView.shipDepth('island', i);
    assert.ok(d > CityView.HORIZON, `ship ${i} at depth ${d} is drawn above the horizon, in the sky`);
    assert.ok(d < 0, `ship ${i} at depth ${d} is on the built grid`);
  }
});

check('a vessel\'s sweep covers the frame and not much more', () => {
  /* A vessel crosses the frame by varying u = gx - gy, and a grid point's
     screen x is ox + u*hw with ox = W/2. So half the canvas is W/(2*hw).
     Using W/hw doubles the sweep and parks the whole fleet off-screen more
     than half the time — which is exactly what shipped past this file until
     a frame was rendered and looked at. */
  for (const [W, hw] of [[640, 27.4], [1200, 40], [360, 14]]) {
    const span = CityView.shipSpan(W, hw);
    const edge = W / (2 * hw);                 /* u at the left/right edge */
    assert.ok(span > edge, `a sweep of ${span} never reaches the frame edge at ${edge}`);
    assert.ok(span < edge * 2,
      `a sweep of ${span} is more than twice the ${edge} it needs — the fleet is off-frame most of the time`);
  }
});

check('ships do not stack on one line', () => {
  for (const form of ['coast', 'island']) {
    const d = [0, 1, 2, 3].map(i => CityView.shipDepth(form, i));
    assert.strictEqual(new Set(d).size, d.length, `two ${form} ships sail at the same depth`);
  }
});

check('the arrival lane is one of the roads the city already has', () => {
  /* freight arriving down a lane that is not a road drives across gardens */
  assert.strictEqual(CityView.LANE, 6);
});

check('nothing is ever built on the arrival lane', () => {
  /* LANE is one of ROADY, so no plot should sit on it. Pin that, because the
     day somebody widens the plot list is the day lorries drive through a
     factory. */
  for (const f of ['island', 'coast', 'inland'])
    for (const s of CityView.buildSlots(f))
      assert.notStrictEqual(s.y, CityView.LANE,
        `${f} has a plot at (${s.x},${s.y}), on the arrival lane`);
});

check('the dock is seaward of every plot a coastal country may build on', () => {
  const dock = CityView.dockAt('coast');
  for (const s of CityView.buildSlots('coast'))
    assert.ok(dock + CityView.LANE > s.x + s.y,
      `the dock is at depth ${dock + CityView.LANE}, behind the plot at (${s.x},${s.y})`);
});

check('a coastal dock sits exactly on the waterline', () => {
  /* short of the shore it is a jetty to nowhere; past it the lorries drive
     out of the sea. The ship comes in to the line and the porters start from
     it, so it has to be the same number for both. */
  assert.strictEqual(CityView.dockAt('coast') + CityView.LANE, CityView.SHORE);
});

check('an island docks beyond its own coastline, not on its beach', () => {
  /* _coast caps the shore ring at sq = R / max(|cos t|, |sin t|), where
     R = N/2 + PAD — so the coastline reaches further out on a diagonal than
     straight ahead. The dock sits on LANE, so measure that same reach in the
     dock's own direction from the middle of the grid. A dock inside it draws
     the delivery freighter sitting on sand. */
  const d = CityView.dockAt('island');
  const dx = d - 4, dy = CityView.LANE - 4, len = Math.hypot(dx, dy);
  const mx = Math.max(Math.abs(dx / len), Math.abs(dy / len));
  const reach = (9 / 2 + 1.2) / mx;
  assert.ok(len > reach,
    `the dock is ${len.toFixed(2)} from the middle of the grid, but the coastline can reach ${reach.toFixed(2)}`);
});

check('a docked vessel floats entirely on its own side of the waterline', () => {
  /* dockAt is where the BOW stops. Put the vessel's CENTRE there instead and
     the whole front half of the hull sits on the beach — which is exactly what
     the first render of this animation showed, with every assertion green. */
  const nose = CityView.dockAt('coast') + CityView.LANE;
  const stern = CityView.dockAt('coast') + CityView.noseOffset('coast') * 2 + CityView.LANE;
  assert.ok(nose >= CityView.SHORE - 1e-9, `the bow is at depth ${nose}, landward of the shore`);
  assert.ok(stern > CityView.SHORE, 'the stern is aground');
});

check('a docked lorry sits on ground its country actually has', () => {
  /* the same failure one map over: an inland lorry parked at the grid edge
     hangs its tail off the end of the shelf and floats in the sky */
  const tail = CityView.dockAt('inland') + CityView.noseOffset('inland') * 2;
  const dx = tail - 4, dy = CityView.LANE - 4, len = Math.hypot(dx, dy);
  const mx = Math.max(Math.abs(dx / len), Math.abs(dy / len));
  assert.ok(len < (9 / 2 + 1.2) / mx,
    `the lorry's tail is ${len.toFixed(2)} from the middle, past the ${((9/2+1.2)/mx).toFixed(2)} the ground reaches`);
});

check('an inland lorry still stops clear of the civic square', () => {
  assert.ok(CityView.dockAt('inland') > 5.5,
    'the lorry parks on the edge of the square');
});

check('workers arrive as people and nothing else does', () => {
  const c = CityView.cargoList({ W:2, M:2, F:2 });
  assert.strictEqual(c.filter(x => x.person).length, 2, 'exactly the workers walk');
  for (const x of c)
    assert.strictEqual(x.person, x.res === 'W', `${x.res} has person=${x.person}`);
});

check('one entry per unit moved, in a fixed order', () => {
  const c = CityView.cargoList({ W:1, M:3, F:2 });
  assert.strictEqual(c.length, 6);
  assert.deepStrictEqual(c.map(x => x.res), ['W','M','M','M','F','F']);
});

check('nothing moved draws nothing', () => {
  assert.deepStrictEqual(CityView.cargoList({ W:0, M:0, F:0 }), []);
  assert.deepStrictEqual(CityView.cargoList(null), []);
  assert.deepStrictEqual(CityView.cargoList({}), []);
});

check('a huge deal does not become a column of identical boxes', () => {
  assert.strictEqual(CityView.cargoList({ W:40, M:40, F:40 }).length, 8);
});

check('a fraction or a negative is not half a crate', () => {
  assert.strictEqual(CityView.cargoList({ W:2.7, M:-3, F:0 }).length, 2);
});

check('each resource has its own colour', () => {
  const col = {};
  CityView.cargoList({ W:1, M:1, F:1 }).forEach(x => { col[x.res] = x.col; });
  assert.strictEqual(new Set(Object.values(col)).size, 3,
    'two resources are drawn the same colour — the goods stop being legible');
});

const DOCK = CityView.dockAt('coast');
const SECS = () => CityView.DELIVERY_SECS;

check('a delivery starts off the map and ends off the map', () => {
  const a = CityView.deliveryAt(0, DOCK);
  assert.ok(a, 'nothing at all happens at t=0');
  assert.ok(a.u > DOCK + 4, 'the vessel starts already at the dock');
  assert.strictEqual(CityView.deliveryAt(SECS(), DOCK), null, 'the delivery never finishes');
  assert.strictEqual(CityView.deliveryAt(SECS() + 60, DOCK), null);
  assert.strictEqual(CityView.deliveryAt(-1, DOCK), null,
    'a delivery that has not started yet is already drawing');
});

check('the vessel never comes further in than the dock', () => {
  /* landward of the dock is the beach, and then somebody's factory. This is
     the same bug the cars had on the last branch, one lane over. */
  for (let el = 0; el < SECS(); el += 0.1) {
    const s = CityView.deliveryAt(el, DOCK);
    assert.ok(s.u >= DOCK - 1e-9,
      `at ${el.toFixed(1)}s the vessel is at ${s.u.toFixed(2)}, past the dock at ${DOCK}`);
  }
});

check('it arrives, it unloads, it leaves — in that order', () => {
  const S = SECS();
  assert.strictEqual(CityView.deliveryAt(S * 0.1, DOCK).phase, 'in');
  assert.strictEqual(CityView.deliveryAt(S * 0.5, DOCK).phase, 'unload');
  assert.strictEqual(CityView.deliveryAt(S * 0.9, DOCK).phase, 'out');
  assert.ok(Math.abs(CityView.deliveryAt(S * 0.5, DOCK).u - DOCK) < 1e-9,
    'the vessel is not at the dock while it is unloading');
});

check('the vessel comes in and goes out, never doubling back', () => {
  const S = SECS();
  let prev = Infinity;
  for (let el = 0; el < S * 0.32; el += 0.1) {           /* inbound */
    const u = CityView.deliveryAt(el, DOCK).u;
    assert.ok(u <= prev + 1e-9, 'the vessel reverses on its way in'); prev = u;
  }
  prev = -Infinity;
  for (let el = S * 0.69; el < S; el += 0.1) {           /* outbound */
    const u = CityView.deliveryAt(el, DOCK).u;
    assert.ok(u >= prev - 1e-9, 'the vessel reverses on its way out'); prev = u;
  }
});

check('the goods leave the vessel and reach the square', () => {
  const S = SECS();
  assert.strictEqual(CityView.deliveryAt(S * 0.1, DOCK).walk, 0,
    'porters are walking before the vessel has docked');
  const mid = CityView.deliveryAt(S * 0.5, DOCK);
  assert.ok(mid.walk > 0 && mid.walk < 1, 'the unload does not progress');
  assert.strictEqual(CityView.deliveryAt(S * 0.9, DOCK).walk, 1,
    'the goods never get all the way in');
  assert.ok(CityView.deliveryAt(S * 0.1, DOCK).carry > 0.9, 'the vessel arrives already empty');
  assert.ok(CityView.deliveryAt(S * 0.66, DOCK).carry < 0.1,
    'the vessel is still full when the unload ends');
});

check('the ship arrives loaded, empties, and leaves with what was paid', () => {
  /* Three different answers, and deriving them from one `carry` multiplier
     sails the ship away empty — the payment never appears, and no assertion
     in this file noticed until a frame of second 17 was looked at. */
  const S = SECS();
  const inb = CityView.cargoList({ W:2, M:3, F:2 });   /* 7 units arriving */
  const out = CityView.cargoList({ M:1 });             /* 1 unit paid */
  const at = (t) => CityView.aboardAt(CityView.deliveryAt(t, DOCK), inb, out);

  assert.strictEqual(at(S * 0.1).length, 7, 'the ship arrives half empty');
  const mid = at(S * 0.5).length;
  assert.ok(mid > 0 && mid < 7, `the unload does not drain the deck (${mid} aboard)`);
  assert.deepStrictEqual(at(S * 0.9), out, 'the ship leaves without the payment aboard');
  assert.notDeepStrictEqual(at(S * 0.9), inb, 'the ship leaves carrying what it just delivered');
});

check('a delivery that was paid for with nothing leaves an empty deck', () => {
  const inb = CityView.cargoList({ F:2 });
  assert.deepStrictEqual(CityView.aboardAt(CityView.deliveryAt(SECS() * 0.9, DOCK), inb, []), []);
  assert.deepStrictEqual(CityView.aboardAt(null, inb, []), [], 'a finished delivery still draws cargo');
});

check('an inland delivery stops at the inland dock', () => {
  const d = CityView.dockAt('inland');
  assert.ok(Math.abs(CityView.deliveryAt(SECS() * 0.5, d).u - d) < 1e-9,
    'an inland delivery does not stop at its own dock');
});

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
