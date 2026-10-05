/* The trade ID is chosen from a list of country names, not typed.

   Typing a 5-letter ID meant reading it off another screen mid-negotiation,
   and a mistyped one was refused with no hint of what went wrong. Both send
   panels — the classroom Build pane and the hall Trade tab — now pick the
   country from a <select> whose option values are the same pids the server
   already takes in `to`, so nothing on the server changes.

   The risk worth pinning is the repaint. renderTrade() runs on every ~2.2s
   poll; a <select> rebuilt from scratch each time would snap back to the
   placeholder in the student's hand, or close itself while open. So the
   options are only rewritten when the list of countries actually changes,
   and the chosen country survives the rewrite while it is still in the room. */
const assert = require('assert');
const fs = require('fs');
const { loadFn, APP } = require('./helpers');

let fails = 0, ran = 0;
const check = (name, fn) => {
  ran++;
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' — ' + e.message); fails++; }
};

const realEsc = loadFn('esc', {});
const fill = loadFn('fillCountryPicker', { esc: realEsc });
const SRC = fs.readFileSync(APP, 'utf8');

/* Just enough of a <select> for fillCountryPicker: innerHTML, value, dataset.
   Setting innerHTML resets value to the first option, as a browser does; a
   value is only kept if an option carries it. */
function fakeSelect(){
  const sel = { dataset:{}, _html:'', _value:'' };
  Object.defineProperty(sel, 'innerHTML', {
    configurable: true,
    get(){ return this._html; },
    set(h){ this._html = h; this._value = ''; }
  });
  Object.defineProperty(sel, 'value', {
    get(){ return this._value; },
    set(v){ this._value = this._html.includes(`value="${v}"`) ? v : ''; }
  });
  return sel;
}

const board = [
  { pid:'AAAAA', name:'Bakau' },
  { pid:'BBBBB', name:'Merlion' },
  { pid:'MEMEM', name:'Us' },
];

check('both send panels pick the country from a <select>, not a typed box', () => {
  assert.ok(/<select id="t_to"/.test(SRC), 'the hall Trade tab still types the trade ID');
  assert.ok(/<select id="bt_to"/.test(SRC), 'the classroom Build pane still types the trade ID');
  assert.ok(!/<input id="t_to"/.test(SRC) && !/<input id="bt_to"/.test(SRC), 'a typed trade-ID box is still in the page');
});

check('every other country is offered by name, with its pid as the value, and never your own', () => {
  const sel = fakeSelect();
  fill(sel, board, 'MEMEM', []);
  assert.ok(sel.innerHTML.includes('value="AAAAA"') && sel.innerHTML.includes('Bakau'), 'Bakau is missing');
  assert.ok(sel.innerHTML.includes('value="BBBBB"') && sel.innerHTML.includes('Merlion'), 'Merlion is missing');
  assert.ok(!sel.innerHTML.includes('MEMEM'), 'your own country is offered as a trading partner');
  assert.ok(/<option value="">/.test(sel.innerHTML), 'there is no empty first choice, so a country is pre-picked by accident');
});

check('an ally is marked in the list', () => {
  const sel = fakeSelect();
  fill(sel, board, 'MEMEM', ['BBBBB']);
  const merlion = sel.innerHTML.slice(sel.innerHTML.indexOf('value="BBBBB"'));
  assert.ok(/ally/i.test(merlion.slice(0, merlion.indexOf('</option>'))), 'Merlion is an ally but the list does not say so');
});

check('a repaint with the same countries does not touch the list, so the choice in hand survives', () => {
  const sel = fakeSelect();
  fill(sel, board, 'MEMEM', []);
  sel.value = 'BBBBB';
  let writes = 0;
  const html = sel.innerHTML;
  Object.defineProperty(sel, 'innerHTML', { get(){ return html; }, set(){ writes++; } });
  fill(sel, board, 'MEMEM', []);
  assert.strictEqual(writes, 0, 'the list was rebuilt on a poll where nothing changed');
  assert.strictEqual(sel.value, 'BBBBB');
});

check('a country joining keeps the chosen country selected', () => {
  const sel = fakeSelect();
  fill(sel, board, 'MEMEM', []);
  sel.value = 'BBBBB';
  fill(sel, board.concat([{ pid:'CCCCC', name:'Temasek' }]), 'MEMEM', []);
  assert.ok(sel.innerHTML.includes('Temasek'), 'the new country did not appear');
  assert.strictEqual(sel.value, 'BBBBB', 'the chosen country was lost when the list grew');
});

check('a country name is escaped', () => {
  const sel = fakeSelect();
  fill(sel, [{ pid:'AAAAA', name:'<b>x</b>' }], 'MEMEM', []);
  assert.ok(!sel.innerHTML.includes('<b>x</b>'), 'a raw name reached the markup');
});

check('an empty room says so instead of offering nothing', () => {
  const sel = fakeSelect();
  fill(sel, [{ pid:'MEMEM', name:'Us' }], 'MEMEM', []);
  assert.ok(/no other countries/i.test(sel.innerHTML), 'an empty list gives no explanation');
});

check('sending with no country chosen is stopped on the device with a reason', () => {
  for (const fn of ['sendOffer', 'sendBuildOffer']) {
    const body = SRC.slice(SRC.indexOf(`async function ${fn}(`));
    const head = body.slice(0, body.indexOf('/api/trade/offer'));
    assert.ok(/Choose a country/.test(head), `${fn}() posts an offer with no country chosen`);
  }
});

check('the alliance list greys out a country you are already allied with, but still lists it', () => {
  const sel = fakeSelect();
  fill(sel, board, 'MEMEM', ['AAAAA'], true);
  const bakau = sel.innerHTML.slice(sel.innerHTML.indexOf('value="AAAAA"'));
  assert.ok(/^value="AAAAA" disabled/.test(bakau), 'an existing ally can be proposed to again');
  assert.ok(!/value="BBBBB" disabled/.test(sel.innerHTML), 'a country that is not an ally was greyed out');
  const goods = fakeSelect();
  fill(goods, board, 'MEMEM', ['AAAAA']);
  assert.ok(!goods.innerHTML.includes('disabled'), 'the goods list greyed out an ally — you can still trade with one');
});

{
  /* The Trade tab's number. Only offers sent TO this country, still pending,
     and of a kind this device's role may answer — a Trade Minister is not
     told about an alliance it cannot accept. */
  const forRole = role => loadFn('offersWaiting', {
    roleCan: act => ({ trade:['leader','trade'], ally:['leader','def'] })[act].includes(role)
  });
  const offers = [
    { status:'pending',  to:'MEMEM', from:'AAAAA', ally:true },
    { status:'pending',  to:'MEMEM', from:'BBBBB', ally:false },
    { status:'accepted', to:'MEMEM', from:'BBBBB', ally:false },
    { status:'pending',  to:'AAAAA', from:'MEMEM', ally:false },
  ];
  check('the Trade tab counts only offers waiting on this device', () => {
    assert.strictEqual(forRole('leader')(offers, 'MEMEM'), 2, 'the Leader should see both waiting offers');
    assert.strictEqual(forRole('def')(offers, 'MEMEM'), 1, 'Defence should see only the alliance');
    assert.strictEqual(forRole('trade')(offers, 'MEMEM'), 1, 'Trade should see only the goods offer');
    assert.strictEqual(forRole('edu')(offers, 'MEMEM'), 0, 'Education cannot answer either');
  });
}

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
