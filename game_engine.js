/* ============================================================
   REPUBLIC 2126 — shared game engine
   Used by: student app, host console, and the Railway server.
   Zero dependencies. Deterministic.
   ============================================================ */

const GAME = {
  name: 'Republic 2126',
  teamSize: 5,
  pointPool: 24,        // nation-building points the Leader splits between ministries
  minMinistry: 3,
  maxMinistry: 12,
  rounds: 5,            // mass-game rounds
  startCoins: 20,
  startMeters: { E: 50, H: 50, S: 50, K: 50, D: 50, G: 50 }
};

/* ---------- the five people in a group ---------- */
const ROLES = [
  { key:'leader', icon:'👑', name:'Leader',
    job:'Names the country, designs the flag, and decides how many nation-building points each ministry gets. Breaks ties.' },
  { key:'edu', icon:'📚', name:'Minister of Education',
    job:'Chooses how the country teaches its people. Builds Knowledge — which unlocks the best industries.' },
  { key:'def', icon:'🛡️', name:'Minister of Defence',
    job:'Keeps the country safe. Builds Defence and Stability, but weapons cost money.' },
  { key:'trade', icon:'⚖️', name:'Minister of Trade & Industry',
    job:'Spends the country\'s resources to run industries that earn coins. Leads all trading in the mass game.' },
  { key:'infra', icon:'🏗️', name:'Minister of Infrastructure & Home Affairs',
    job:'Builds homes, transport and power — and keeps every community living together in peace.' }
];

/* ---------- resources ---------- */
const RES = [
  { key:'W', icon:'🧑‍🏭', name:'Workers',   blurb:'Human resource — people to run your industries.' },
  { key:'M', icon:'⛏️', name:'Materials',  blurb:'Natural resource — ore, timber, stone, fuel.' },
  { key:'F', icon:'🌾', name:'Food',       blurb:'Agricultural resource — feeds your people.' }
];

/* ---------- homelands: every country starts different ---------- */
const HOMELANDS = [
  { key:'delta',  icon:'🌾', name:'River Delta',  res:{W:8,  M:3,  F:11}, gift:'Rich farmland — food to spare.',      bonus:{G:4} },
  { key:'high',   icon:'⛰️', name:'Highlands',    res:{W:6,  M:12, F:4 }, gift:'Mountains full of ore and stone.',    bonus:{D:4} },
  { key:'port',   icon:'⚓', name:'Port City',    res:{W:12, M:4,  F:5 }, gift:'A crowded, busy harbour full of people.', bonus:{E:4} },
  { key:'isles',  icon:'🏝️', name:'Green Isles',  res:{W:7,  M:5,  F:8 }, gift:'Beautiful islands and clean seas.',   bonus:{G:8} },
  { key:'forest', icon:'🌳', name:'Forest Belt',  res:{W:7,  M:9,  F:7 }, gift:'Timber, rivers and space to grow.',   bonus:{H:3} },
  { key:'dry',    icon:'🏜️', name:'Dry Plains',   res:{W:10, M:9,  F:3 }, gift:'Oil and minerals under dry ground.',  bonus:{E:3} }
];

/* ---------- policy cards ----------
   fx  : effect on meters  E economy, H harmony, S stability, K knowledge, D defence, G green
   up  : coins of upkeep charged each round
   tag : short line shown on the card
   Divisive / short-sighted cards are cheaper on purpose — the trade-off is the lesson.
------------------------------------ */
const CARDS = {
  edu: [
    { key:'free',    icon:'🏫', name:'Free school for all',      cost:4, tag:'Every child learns, whoever they are.',        fx:{K:12,H:6},        up:2 },
    { key:'biling',  icon:'🗣️', name:'Learn each other\'s tongue', cost:3, tag:'Students learn a second language of the land.', fx:{K:7,H:10},      up:1 },
    { key:'tech',    icon:'🤖', name:'Science & AI institute',   cost:5, tag:'Trains the engineers of tomorrow.',             fx:{K:16,E:5},        up:2 },
    { key:'skills',  icon:'🔧', name:'Factory skills training',  cost:2, tag:'Quick job training for industry.',              fx:{K:5,E:9,G:-2},    up:1 },
    { key:'elite',   icon:'🏛️', name:'Elite schools only',       cost:2, tag:'Teach the top few, save the money.',           fx:{K:11,E:5,H:-12},  up:0 },
    { key:'ban',     icon:'🚫', name:'Teach one culture only',   cost:1, tag:'One story, one history, one people.',           fx:{K:3,S:7,H:-16},   up:0 }
  ],
  def: [
    { key:'ns',      icon:'🎖️', name:'National Service',         cost:4, tag:'Everyone serves together, side by side.',       fx:{D:13,H:8,S:5},    up:2 },
    { key:'coast',   icon:'🚢', name:'Coast guard',              cost:3, tag:'Keeps sea lanes and trade safe.',               fx:{D:9,E:5},         up:2 },
    { key:'cyber',   icon:'💻', name:'Cyber defence unit',       cost:3, tag:'Stops attacks you cannot see.',                 fx:{D:10,K:4},        up:2 },
    { key:'buy',     icon:'🚀', name:'Buy foreign weapons',      cost:4, tag:'Powerful, fast — and expensive.',               fx:{D:18,E:-3},       up:5 },
    { key:'peace',   icon:'🕊️', name:'Treaties & diplomacy',     cost:2, tag:'Make friends instead of enemies.',              fx:{D:5,H:7,S:6},     up:0 },
    { key:'spy',     icon:'👁️', name:'Watch the people',         cost:2, tag:'Cameras, informers, no protests.',              fx:{D:7,S:14,H:-15},  up:1 }
  ],
  trade: [
    { key:'port',    icon:'🛳️', name:'Open trade port',          cost:4, tag:'Ships from everywhere dock here.',              fx:{E:13,H:3},        up:2 },
    { key:'sme',     icon:'🛍️', name:'Small business grants',    cost:2, tag:'Hawkers, shops and startups get a start.',      fx:{E:7,H:6},         up:1 },
    { key:'fdi',     icon:'🏦', name:'Invite foreign investors',  cost:3, tag:'Money floods in — with conditions.',            fx:{E:15,G:-5,H:-6},  up:0 },
    { key:'tour',    icon:'🏖️', name:'Tourism drive',            cost:2, tag:'Show the world your festivals and food.',       fx:{E:8,H:5,G:-3},    up:1 },
    { key:'protect', icon:'🚧', name:'Protect local jobs',       cost:2, tag:'Local workers first, imports taxed.',           fx:{E:-3,S:10,H:4},   up:0 },
    { key:'strip',   icon:'⛏️', name:'Dig up everything now',    cost:1, tag:'Sell the land\'s riches while prices are high.', fx:{E:16,G:-18},     up:0 }
  ],
  infra: [
    { key:'mixed',   icon:'🏘️', name:'Mixed housing estates',    cost:4, tag:'Every race lives on the same block.',           fx:{H:16,S:7},        up:2 },
    { key:'water',   icon:'🚰', name:'Clean water & sanitation', cost:3, tag:'Safe taps and drains in every home.',           fx:{H:8,S:7,G:5},     up:2 },
    { key:'mrt',     icon:'🚇', name:'Mass rapid transit',       cost:5, tag:'The whole island, twenty minutes apart.',       fx:{E:11,G:7,H:5},    up:3 },
    { key:'faith',   icon:'🛕', name:'Space for every faith',    cost:2, tag:'Temple, mosque, church, gurdwara — side by side.', fx:{H:14,S:5},     up:1 },
    { key:'solar',   icon:'☀️', name:'Solar & wind farms',       cost:4, tag:'Costs more now, cleaner forever.',              fx:{E:4,G:16},        up:2 },
    { key:'coal',    icon:'🏭', name:'Cheap coal power',         cost:1, tag:'Power tonight, smoke tomorrow.',                fx:{E:12,G:-16},      up:0 }
  ]
};

/* ---------- industries: run with resources, not points ---------- */
const INDUSTRIES = [
  { key:'farm',  icon:'🌾', name:'Farms',            need:{W:2,M:0,F:0}, out:{coin:3,  F:3},  fx:{H:2},        req:null,
    tag:'Feeds your people and makes a little money.' },
  { key:'mine',  icon:'⛏️', name:'Mines',            need:{W:3,M:0,F:1}, out:{coin:5,  M:3},  fx:{G:-7},       req:null,
    tag:'Digs up materials fast. Scars the land.' },
  { key:'fact',  icon:'🏭', name:'Factories',        need:{W:3,M:2,F:0}, out:{coin:10},       fx:{G:-6,E:3},   req:null,
    tag:'The biggest earner — and the biggest polluter.' },
  { key:'port',  icon:'⚓', name:'Port & logistics', need:{W:2,M:1,F:0}, out:{coin:7},        fx:{E:3},        req:null,
    tag:'Moves other people\'s goods. +1 trade deal each round.', trade:1 },
  { key:'tech',  icon:'💻', name:'Tech park',        need:{W:2,M:1,F:0}, out:{coin:12},       fx:{K:2,E:2},    req:{K:60},
    tag:'Needs Knowledge 60+. Clean, rich, hard to build.' },
  { key:'tour',  icon:'🏖️', name:'Tourism',          need:{W:2,M:0,F:1}, out:{coin:8},        fx:{H:2},        req:{G:55},
    tag:'Needs Green 55+. Visitors will not come to a smoggy country.' },
  { key:'care',  icon:'🏥', name:'Care & services',  need:{W:2,M:0,F:1}, out:{coin:3},        fx:{H:5,S:3},    req:null,
    tag:'Hospitals, childcare, eldercare. Holds society together.' }
];

/* ---------- what the Infrastructure ministry builds ----------
   Industries employ people; buildings are what let a country employ them at
   all. A country starts with only about half its workforce housed, so homes
   are the first thing most groups need — and they cost Materials and Food,
   which nothing else in the game consumed.

   `card` is the Infrastructure policy card that unlocks this building, so the
   choice a group made at the Policies step becomes a thing they can place.
   Homes have no card: a group that spent nothing on Infrastructure must still
   be able to house people.
   `housed` is how many workers this building makes employable.
   `fx` folds into the meters exactly as an industry's does — the card was the
   decision, the buildings are its scale, so three coal plants cost more Green
   than one.
-------------------------------------------------------------- */
const BUILDINGS = [
  { key:'home',   icon:'🏠', name:'Homes',            need:{M:2,F:2}, housed:2, card:null,
    tag:'Somewhere for your people to live. Always available.' },
  { key:'estate', icon:'🏘️', name:'Housing estate',   need:{M:3,F:2}, housed:4, card:'mixed',
    tag:'Dense blocks where every race lives on the same landing.' },
  { key:'mrt',    icon:'🚇', name:'MRT station',      need:{M:3,F:1}, housed:3, card:'mrt',
    tag:'People can live further out and still reach work.' },
  { key:'solar',  icon:'☀️', name:'Solar farm',       need:{M:3,F:0}, housed:2, card:'solar', fx:{G:5},
    tag:'Clean power for the homes it lights.' },
  { key:'coal',   icon:'🏭', name:'Coal plant',       need:{M:1,F:0}, housed:3, card:'coal',  fx:{G:-6},
    tag:'Powers more homes for less. The air pays for it.' },
  { key:'park',   icon:'🌳', name:'Public park',      need:{M:1,F:1}, housed:0, card:'water', fx:{H:4,G:4},
    tag:'Clean water, drains and green space between the blocks.' },
  { key:'faith',  icon:'🛕', name:'Place of worship', need:{M:2,F:1}, housed:0, card:'faith', fx:{H:5},
    tag:'Temple, mosque, church and gurdwara, side by side.' }
];

/* ---------- what the Education ministry runs ----------
   The hall's only real coin sink. `advanceRound` only ever adds coins; the
   only outflows before this were scenario costs and trade, so a country's
   treasury grew all game with almost nothing to spend it on.

   Programmes convert coins into METERS, deliberately never into resources.
   Trading is the only way to get Materials in the hall, and that scarcity is
   what sends the Trade Minister across the floor to talk to somebody — a
   programme that sold Materials for coins would quietly close the one thing
   this whole feature exists to open.

   One-off: each is buyable once per country. Repeatable-at-flat-cost was
   rejected because five rounds of income would grind Knowledge to 100 and the
   industry gates would stop meaning anything.

   No FOUND_SCALE is applied to these, unlike hall buildings. A building has a
   prep equivalent, so an unscaled hall build would reward delaying it; a
   programme exists only in the hall, so there is nothing to arbitrage and the
   numbers below are exactly what they do.

   There is deliberately no Defence programme — that stays Defence's identity,
   which is alliances.

   All six together cost 196 coins against a five-round income of roughly
   100-200. Nobody buys them all; that is the point of the pricing.

   NOTE: names and tags are placeholder copy, to be rewritten before the hall.
-------------------------------------------------------- */
const PROGRAMMES = [
  { key:'literacy', icon:'📖', name:'Adult literacy drive',      cost:28, fx:{K:9,H:3},
    tag:'Night classes for the grown-ups who never got to finish.' },
  { key:'heritage', icon:'🏮', name:'Mother tongue & heritage',  cost:26, fx:{H:9,K:3},
    tag:'Every child learns the language their grandparents think in.' },
  { key:'science',  icon:'🔬', name:'Science scholarships',      cost:42, fx:{K:11,E:6},
    tag:'Sends your brightest abroad, on the condition they come home.' },
  { key:'green',    icon:'🌱', name:'Environmental education',   cost:30, fx:{G:9,K:3},
    tag:'A generation that will not accept a smoggy sky.' },
  { key:'civics',   icon:'🗳️', name:'Civics & national education', cost:32, fx:{S:8,H:6},
    tag:'How the country is run, and why everyone has a stake in it.' },
  { key:'retrain',  icon:'🔧', name:'Skills retraining',         cost:38, fx:{E:8,K:5,S:3},
    tag:'For workers whose industry closed while they were still in it.' }
];

/* ---------- what a Leader may close ----------
   Spec B gave three ministers a screen each. This is the Leader's answer:
   four switches saying who may act without asking first. Switches, not
   budgets — an allowance would ask a 14-year-old to hold a figure, what has
   been spent, and what refills when, in a loud hall on a shared iPad.

   Open is the default everywhere, and that is load-bearing: a Leader who
   never finds the Cabinet screen must change nothing about how the hall
   already plays.

   MANDATE_WHAT lives here rather than in server.js because the refusal
   sentence is built on BOTH sides — the server returns it from a route, the
   client draws it as a banner. Two copies would drift, which is exactly what
   happened to the client's ACT_ROLES mirror during Spec B. Each phrase is the
   tail of "<name> has closed ___", so it is lower case and unpunctuated.
------------------------------------------------ */
const MANDATE_FLAGS = ['build', 'site', 'programme', 'ally'];
const MANDATE_WHAT = {
  build:     'building',
  site:      'new industry',
  programme: 'spending on programmes',
  ally:      'alliances'
};

/* ---------- what it costs to not decide at all ----------
   A cabinet that runs out of time and agrees on nothing is not neutral. On five
   of the eight scenario cards every option costs coins, so before this a group
   that simply said nothing kept its money and took no meter damage — silence
   was the cheapest play, and a group that disengaged was never pulled up on it.

   Deliberately smaller than the worst real choice: this should make indecision
   cost something, not frighten groups into picking at random to avoid it. It
   takes no coins — the lesson is about governing, not about money.
-------------------------------------------------------- */
const INDECISION = { fx:{ S:-4, H:-3 }, note:'could not agree in time' };

/* ---------- the classroom drill ---------------------------------------------
   One card, for one purpose: to prove that every group in a classroom knows
   what happens when a scenario appears in the hall. It shows up, the cabinet
   argues, the Leader picks, the meters move.

   It is deliberately NOT one of the hall's eight. A teacher rehearsing used to
   spend three real cards and got to pick which three from a list showing every
   card's full story — which is one of the ways the hall deck leaked.

   It carries `ally:true` on its co-operative choice on purpose: an alliance
   changing what a choice is worth is the one mechanic that costs a group most
   to meet cold in the hall.

   It costs nothing. The coin component is zeroed for a classroom in
   chooseScenario(), and the meters are put back from a snapshot when the card
   is closed. */
const DRILL = {
  key:'clinic', icon:'🏥', title:'A Neighbour Offers Doctors',
  story:'Your clinics are short-staffed. A neighbouring country offers to send doctors for a year.',
  choices:[
    { key:'a', icon:'🤝', label:'Accept, and send your nurses to train there', tag:'Both countries end up better.', fx:{H:6,K:5,D:2}, coin:-3, ally:true },
    { key:'b', icon:'💼', label:'Hire private doctors instead', tag:'Faster. Expensive. Yours alone.', fx:{K:3,E:-2}, coin:-11 },
    { key:'c', icon:'⏳', label:'Wait for your own graduates',  tag:'Free. Three years away.',         fx:{K:2,H:-5}, coin:0 }
  ]
};


/* ============================================================
   MATHS
   ============================================================ */
const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, v));
const METER_KEYS = ['E','H','S','K','D','G'];
/* `from` names the ministry whose policy cards raise this pillar, so a locked
   industry card can tell a group where to go. Read off the card effects in
   CARDS below. Only K and G gate an industry today; the rest are filled in so
   the line stays correct if one ever does. */
const METER_INFO = {
  E:{ icon:'📈', name:'Economy',   blurb:'How much your country produces and earns.',        from:'Trade & Industry policies' },
  H:{ icon:'🤝', name:'Harmony',   blurb:'How well every race and religion lives as one people.', from:'Infrastructure policies' },
  S:{ icon:'🏛️', name:'Stability', blurb:'How steady and law-abiding daily life feels.',     from:'Defence policies' },
  K:{ icon:'📚', name:'Knowledge', blurb:'How skilled and educated your people are.',        from:'Education policies' },
  D:{ icon:'🛡️', name:'Defence',   blurb:'How safe your country is from threats.',           from:'Defence policies' },
  G:{ icon:'🌿', name:'Green',     blurb:'How healthy your land, air and water are.',        from:'Infrastructure policies' }
};

/* Spec D. What it takes to put one person back in a home.

   A Home costs M2 F2 and houses 2, so materials rehouse at exactly the price
   of building — no arbitrage either way. Coins are crisis relief, bought at
   crisis prices, and cost more.

   Here rather than in server.js so the button label ("Send 3 Materials —
   rehouses 3") and the server's arithmetic read one number. Spec B shipped
   exactly this drift once already: the client's ACT_ROLES mirror fell out of
   step with the server's and no test could see it. */
const AID_PER_PERSON   = 2;   // Materials or Food
const AID_COINS_PERSON = 6;   // coins

function blankCountry(){
  return {
    name:'', motto:'', col1:'#0f5c8c', col2:'#f4c542', emblem:'🦁',
    stripe:'diag', empos:'left',
    homeland:'delta',
    viewCode:'',                   // the class code — members watch, they do not drive
    /* one per ministry — the four students who used to hold nothing but the
       class code. Empty string, not absence, exactly as viewCode is: a saved
       country still holding '' is one restore() has to backfill. */
    minCodes:{ edu:'', def:'', trade:'', infra:'' },
    pid:'',                        // public id: safe to put on a leaderboard
    slot:0,                        // group number the teacher provisioned
    locked:false,                  // committed; editing is closed
    renameAsked:false,             // the teacher bounced the name back
    rejectedName:'',               // what the name was at the moment it was
                                    // bounced, so a stale autosave (or a
                                    // resubmission of the exact same name)
                                    // can be told apart from a genuine rename
    origin:null,                   // the class room this country was built in
    arrived:null,                  // hall round this country migrated in on — exempts it
                                    // from indecision penalties for a card it was never asked
    members:{ leader:'', edu:'', def:'', trade:'', infra:'' },
    split:{ edu:6, def:6, trade:6, infra:6 },
    picks:{ edu:[], def:[], trade:[], infra:[] },
    industries:{},                 // key -> number of sites
    buildings:{},                  // key -> number built
    /* Education programmes already bought — one-off, so this is a set kept as
       an array. Empty string entries are impossible: only a key from
       PROGRAMMES ever reaches it, checked server-side. */
    programmes:[],
    /* Which ministries may act without asking the Leader first. All four open,
       because open is what the hall did before this existed. Only an explicit
       false ever closes a door — see mandateBlock() in server.js. */
    mandate:{ build:true, site:true, programme:true, ally:true },
    meters:{ ...GAME.startMeters },
    coins:GAME.startCoins,
    stock:{ W:0, M:0, F:0 },       // spare resources gained from trade / yields
    /* People whose homes a strike destroyed. Server-owned: no client ever
       posts it and /api/team/save never reads it. That is deliberate and it
       is load-bearing — buildings merge UPWARD in the hall (growCounts), so
       damage recorded as a lower building count would be read back as new
       construction by the next autosave echo, restoring the homes free and
       paying a meter bonus for being bombed. An integer nothing on a device
       can write cannot be undone by a device. */
    displaced:0,
    allies:[],
    log:[],
    round:0,
    ready:false
  };
}

function homelandOf(c){ return HOMELANDS.find(h=>h.key===c.homeland) || HOMELANDS[0]; }

/* points spent per ministry */
function spent(c, m){
  return (c.picks[m]||[]).reduce((s,k)=>{ const card=CARDS[m].find(x=>x.key===k); return s+(card?card.cost:0); },0);
}
function totalSplit(c){ return ['edu','def','trade','infra'].reduce((s,m)=>s+(c.split[m]||0),0); }

/* resources available: homeland + traded stock */
function pool(c){
  const h = homelandOf(c).res;
  return { W:h.W + (c.stock.W||0), M:h.M + (c.stock.M||0), F:h.F + (c.stock.F||0) };
}
function used(c){
  const u = { W:0, M:0, F:0 };
  for(const key of Object.keys(c.industries||{})){
    const n = c.industries[key]||0; if(!n) continue;
    const ind = INDUSTRIES.find(i=>i.key===key); if(!ind) continue;
    u.W += ind.need.W*n; u.M += ind.need.M*n; u.F += ind.need.F*n;
  }
  /* buildings cost Materials and Food but no workers — you build them once,
     you do not staff them */
  for(const key of Object.keys(c.buildings||{})){
    const n = c.buildings[key]||0; if(!n) continue;
    const b = BUILDINGS.find(x=>x.key===key); if(!b) continue;
    u.M += (b.need.M||0)*n; u.F += (b.need.F||0)*n;
  }
  return u;
}
/* Workers are counted against how many are HOUSED, not how many exist —
   an unhoused worker cannot be employed. Materials and Food still come
   from the pool. */
function free(c){
  const p=pool(c), u=used(c);
  return { W:housed(c)-u.W, M:p.M-u.M, F:p.F-u.F };
}

/* How many of a country's workers COULD have somewhere to live — what the
   homes hold, before anything is taken away. Capped at the workforce that
   actually exists, so over-building homes is visibly wasted rather than
   silently banked.

   Split out of housed() by Spec D. The strike arithmetic has to size damage
   against the workforce a country HAS, not the one a previous strike left it:
   feeding housed() back into its own damage formula makes the cap
   uncomputable, and a country struck twice could be ground below the floor
   the cap exists to hold. */
function capacity(c){
  const base = Math.ceil(homelandOf(c).res.W / 2);
  let extra = 0;
  for(const key of Object.keys(c.buildings||{})){
    const n = c.buildings[key]||0; if(!n) continue;
    const b = BUILDINGS.find(x=>x.key===key); if(!b) continue;
    extra += (b.housed||0)*n;
  }
  return Math.min(pool(c).W, base + extra);
}

/* Workers are counted against how many are HOUSED, not how many exist — an
   unhoused worker cannot be employed. Materials and Food still come from the
   pool.

   People whose homes were destroyed by a strike are unhoused in exactly the
   same sense, which is the whole of Spec D's damage model: one integer, and
   every consequence falls out of this subtraction. `|| 0` because a country
   restored from a snapshot written before Spec D carries no such key. */
function housed(c){
  return Math.max(0, capacity(c) - (c.displaced || 0));
}

/* ---------- baseline meters from the founding decisions ---------- */
const FOUND_SCALE = 0.62;   // keeps founding scores off the ceiling so later play still matters

/* diminishing returns: the last ten points of any pillar are the hardest to win,
   and a pillar already near zero cannot fall much further */
const FLOOR = 6;
function nudge(v, d){
  if(d >= 0) return clamp(v + d*Math.min(1, (100-v)/38), FLOOR, 100);
  return clamp(v + d*Math.min(1, Math.max(0, v-FLOOR)/34), FLOOR, 100);
}

function foundingMeters(c){
  const m = { ...GAME.startMeters };
  const add = (k, v) => { m[k] = nudge(m[k]==null?50:m[k], v*FOUND_SCALE); };
  const h = homelandOf(c);
  for(const k in (h.bonus||{})) add(k, h.bonus[k]);
  for(const min of ['edu','def','trade','infra']){
    for(const key of (c.picks[min]||[])){
      const card = CARDS[min].find(x=>x.key===key); if(!card) continue;
      for(const k in card.fx) add(k, card.fx[k]);
    }
  }
  for(const key of Object.keys(c.industries||{})){
    const n=c.industries[key]||0; if(!n) continue;
    const ind=INDUSTRIES.find(i=>i.key===key); if(!ind) continue;
    for(const k in (ind.fx||{})) add(k, ind.fx[k]*n);
  }
  for(const key of Object.keys(c.buildings||{})){
    const n=c.buildings[key]||0; if(!n) continue;
    const b=BUILDINGS.find(x=>x.key===key); if(!b) continue;
    for(const k in (b.fx||{})) add(k, b.fx[k]*n);
  }
  METER_KEYS.forEach(k=>m[k]=clamp(Math.round(m[k]*10)/10));
  return m;
}

/* upkeep charged each round */
function upkeep(c){
  let u = 0;
  for(const min of ['edu','def','trade','infra'])
    for(const key of (c.picks[min]||[])){
      const card = CARDS[min].find(x=>x.key===key); if(card) u += card.up||0;
    }
  return u;
}

/* trade slots — how many deals a team may strike per round */
function tradeSlots(c){
  let t = 2;
  for(const key of Object.keys(c.industries||{})){
    const ind=INDUSTRIES.find(i=>i.key===key);
    if(ind && ind.trade) t += ind.trade*(c.industries[key]||0);
  }
  return Math.min(6, t);
}

/* ---------- one round of production ---------- */
function roundIncome(c){
  const m = c.meters;
  const harmonyPull  = 0.62 + (m.H/100)*0.55;     // divided countries waste what they earn
  const stabilityPull= 0.72 + (m.S/100)*0.40;
  const econPull     = 0.70 + (m.E/100)*0.55;
  let gross = 0, detail = [];
  for(const key of Object.keys(c.industries||{})){
    const n = c.industries[key]||0; if(!n) continue;
    const ind = INDUSTRIES.find(i=>i.key===key); if(!ind) continue;
    let ok = true;
    if(ind.req) for(const k in ind.req) if(m[k] < ind.req[k]) ok = false;
    const raw = (ind.out.coin||0)*n;
    const val = ok ? raw : Math.round(raw*0.35);
    gross += val;
    detail.push({ key, n, coins:val, stalled:!ok });
  }
  const allyBonus = 1 + Math.min(3, (c.allies||[]).length)*0.07;
  /* A fourth pull, alongside harmony/stability/econ. Until Spec D a worker
     shortage cost a country nothing at all: the industry gate above tests
     ind.req against METERS, never against workers, so a country whose people
     had been displaced kept producing exactly as before and the only symptom
     was the next save being refused.

     Inert for normal play. Every path that could push free().W negative
     already refuses to — /api/team/save reverts, and both trade routes clamp
     on free() — so shortfall is 0 for any country that has never been struck.
     tests/balance.test.js pins that rather than trusting it.

     The 0.35 floor is the same number a stalled industry already uses a few
     lines above: a struck country's factories behave like stalled ones, which
     is a shape the game has already taught. */
  const usedW      = used(c).W;
  const shortfall  = Math.max(0, usedW - housed(c));
  const workerPull = usedW ? Math.max(0.35, 1 - shortfall/usedW) : 1;
  const net = Math.round(gross*harmonyPull*stabilityPull*econPull*allyBonus*workerPull) - upkeep(c);
  return { gross, net, detail, allyBonus, workerPull, upkeep:upkeep(c) };
}

/* ---------- drift: what your country becomes if you just keep going ---------- */
function drift(c){
  const m = { ...c.meters };
  // pollution from industry accumulates
  let dirty = 0, clean = 0;
  for(const key of Object.keys(c.industries||{})){
    const ind = INDUSTRIES.find(i=>i.key===key); if(!ind) continue;
    const n = c.industries[key]||0;
    if((ind.fx||{}).G) { if(ind.fx.G<0) dirty += -ind.fx.G*n*0.17; else clean += ind.fx.G*n*0.22; }
  }
  m.G = nudge(m.G, clean - dirty);
  // low harmony eats stability; low green eats harmony and health
  if(m.H < 45) m.S = nudge(m.S, -(45-m.H)*0.18);
  if(m.G < 40) { m.H = nudge(m.H, -(40-m.G)*0.11); m.E = nudge(m.E, -(40-m.G)*0.09); }
  if(m.S < 40) m.E = nudge(m.E, -(40-m.S)*0.15);
  // a knowledgeable, harmonious country slowly compounds
  if(m.K > 60 && m.H > 60) m.E = nudge(m.E, 2.2);
  if(m.H > 65) m.S = nudge(m.S, 1.6);
  return m;
}

function applyFx(meters, fx){
  const m = { ...meters };
  for(const k in (fx||{})) m[k] = nudge(m[k]==null?50:m[k], fx[k]);
  return m;
}

/* ============================================================
   SCORING — the well-rounded country wins
   ============================================================ */
function wealthScore(coins){
  // 0 coins -> 20, 100 -> 62, 200 -> 79, 400 -> 96
  return clamp(Math.round(20 + 42*Math.log(1 + Math.max(0,coins)/100)/Math.log(2)));
}

function pillars(c){
  const m = c.meters;
  return {
    Wealth:    wealthScore(c.coins),
    Harmony:   Math.round(m.H),
    Stability: Math.round(m.S),
    Knowledge: Math.round(m.K),
    Defence:   Math.round(m.D),
    Green:     Math.round(m.G)
  };
}

function score(c){
  const p = pillars(c);
  const vals = Object.values(p);
  const mean = vals.reduce((s,v)=>s+v,0)/vals.length;
  const geo = Math.pow(vals.reduce((s,v)=>s*Math.max(1,v),1), 1/vals.length);
  const lowest = Math.min(...vals), highest = Math.max(...vals);
  const balance = Math.round(100 - (highest - lowest));
  // a country is only as strong as its weakest pillar
  const wellRounded = 0.70 + 0.30*(lowest/Math.max(1, mean));
  const overall = Math.round(Math.min(mean, mean*wellRounded));
  return { pillars:p, mean:Math.round(mean), geo:Math.round(geo), balance, overall, lowest, highest };
}

function title(c){
  const s = score(c), p = s.pillars;
  if(s.balance >= 78 && s.overall >= 72) return { tag:'🏆 The Complete Nation', line:'Strong everywhere, weak nowhere. This is what a well-rounded country looks like.' };
  if(p.Wealth >= 75 && p.Harmony < 45)   return { tag:'💔 The Rich but Divided', line:'The money came. The people never became one nation.' };
  if(p.Green < 35 && p.Wealth >= 65)     return { tag:'🏭 The Smoky Boomtown',   line:'Full wallets, empty skies. The bill arrives later.' };
  if(p.Harmony >= 72 && p.Wealth < 45)   return { tag:'🕊️ The Happy but Poor',   line:'A warm, united people — with too little to build on.' };
  if(p.Defence >= 70 && p.Harmony < 52)  return { tag:'🏰 The Fortress',         line:'Safe from outside. Not safe from inside.' };
  if(s.overall >= 62)                    return { tag:'🌱 The Rising Republic',  line:'A solid country with real momentum. Not finished — but on its way.' };
  if(s.balance >= 62)                    return { tag:'🧭 The Steady Middle',    line:'Nothing is broken — but nothing is strong yet either. Pick something to be great at.' };
  return { tag:'🧱 The Struggling State', line:'Too many gaps at once. Every pillar needs the others.' };
}

/* ---------- what the city looks like (drives the 2D visual) ---------- */
/* NOT what draws the island. The isometric city is CityView._plan() in
   city.js; this is a plain tile list kept for anything that wants the shape of
   a country without a canvas. Change both, or change the one you meant. */
function cityPlan(c){
  const m = c.meters, tiles = [];
  const add = (icon, n, kind) => { for(let i=0;i<n;i++) tiles.push({ icon, kind }); };
  const ind = c.industries || {};
  add('🏭', Math.min(6, ind.fact||0), 'fact');
  add('⛏️', Math.min(4, ind.mine||0), 'mine');
  add('🌾', Math.min(6, ind.farm||0), 'farm');
  add('⚓', Math.min(3, ind.port||0), 'port');
  add('💻', Math.min(4, ind.tech||0), 'tech');
  add('🏖️', Math.min(3, ind.tour||0), 'tour');
  add('🏥', Math.min(3, ind.care||0), 'care');
  /* what the Infrastructure ministry actually built, not merely what it voted
     for — a group with five estates should see five */
  const bld = c.buildings || {};
  for(const b of BUILDINGS){
    const n = bld[b.key]||0; if(!n) continue;
    add(b.icon, Math.min(6, n), 'infra');
  }
  const picks =[].concat(c.picks.edu||[], c.picks.def||[], c.picks.trade||[], c.picks.infra||[]);
  const map = { free:'🏫', tech:'🔬', mixed:'🏘️', mrt:'🚇', solar:'☀️', coal:'🏭', faith:'🛕',
                water:'🚰', ns:'🎖️', buy:'🚀', port:'🛳️', tour:'🏖️', sme:'🛍️', cyber:'📡',
                spy:'📹', elite:'🏛️', biling:'🗣️', peace:'🕊️', coast:'🚢' };
  picks.forEach(k=>{ if(map[k]) tiles.push({ icon:map[k], kind:'civic' }); });
  while(tiles.length < 12) tiles.push({ icon:'🏠', kind:'home' });
  return {
    tiles: tiles.slice(0, 24),
    smog:  clamp(Math.round((55 - m.G)*1.6), 0, 90) / 100,
    glow:  clamp(Math.round((m.E + m.H)/2)) / 100,
    crack: m.S < 45,
    happy: m.H >= 65,
    night: false
  };
}

/* ---------- helpers used by the server ---------- */
function makeCode(n, seedFn){
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for(let i=0;i<n;i++) s += A[Math.floor(seedFn()*A.length)];
  return s;
}

/* A country's name, motto, emblem and two colours are typed by a group and
   shown to the whole room — on their own screen, on the shared leaderboard and
   on the teacher's console. Everything a group types goes through this before
   it reaches markup. The quote matters as much as the angle bracket: a colour
   of `#fff" onload="…` escapes a fill="…" attribute without ever using `<`. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Colours land inside SVG fill="…". Anything that is not a plain #rrggbb is
   not a colour a group could have picked with the swatch control, so it is
   replaced rather than escaped — a broken flag is better than a broken room. */
function safeColour(v, fallback){
  return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : fallback;
}

/* ============================================================
   BITES — the same card, landing differently on different countries
   ============================================================
   A choice may carry a `bite` array. Each entry is a condition, an effect and
   a sentence, and the same entry produces both the arithmetic and the warning
   a phone shows — one source of truth, so the two cannot drift apart.

   Returns the TILT ONLY, never the total. chooseScenario adds it to the base
   it has already ally-scaled.

   Nothing here throws. The deck is hand-edited and a mistyped condition must
   cost a nuance, not a hall in front of 300 people. */

/* How many of an industry a country runs — 0 for anything it never built. */
function ownedCount(c, key){
  const ind = (c && c.industries) || {};
  return Math.max(0, ind[key] || 0);
}
/* True when this country satisfies one condition. Unknown shapes are false,
   which is what makes a typo inert rather than fatal. */
function biteMatches(cond, c){
  if(!cond || typeof cond !== 'object') return false;
  if(cond.industry != null) return ownedCount(c, cond.industry) >= (cond.min == null ? 1 : cond.min);
  if(cond.pick != null){
    const picks = (c && c.picks) || {};
    return Object.keys(picks).some(m => Array.isArray(picks[m]) && picks[m].includes(cond.pick));
  }
  if(cond.homeland != null) return (c && c.homeland) === cond.homeland;
  if(cond.meter != null){
    const v = ((c && c.meters) || {})[cond.meter];
    if(typeof v !== 'number') return false;
    if(cond.below != null) return v < cond.below;
    if(cond.above != null) return v > cond.above;
    return false;
  }
  return false;
}
const fxWeight = (fx) => Object.keys(fx || {}).reduce((s,k)=>s + Math.abs(fx[k]||0), 0);

function biteChoice(choice, c){
  const out = { fx:{}, coin:0, notes:[] };
  const list = (choice && Array.isArray(choice.bite)) ? choice.bite : [];
  if(!list.length) return out;

  const hits = [];
  for(const b of list){
    if(!b || typeof b !== 'object') continue;
    if(!biteMatches(b.if, c)) continue;
    const n = b.per ? ownedCount(c, b.per) : 1;
    if(!n) continue;
    const fx = {}; let weight = 0;
    for(const k in (b.fx || {})){ fx[k] = (b.fx[k] || 0) * n; weight += Math.abs(fx[k]); }
    const coin = (b.coin || 0) * n;
    weight += Math.abs(coin);
    hits.push({ fx, coin, weight, note: b.note ? String(b.note).replace(/\{n\}/g, n) : '' });
  }
  if(!hits.length) return out;

  for(const h of hits){
    for(const k in h.fx) out.fx[k] = (out.fx[k] || 0) + h.fx[k];
    out.coin += h.coin;
  }

  /* The cap, and the whole reason a bite can never be ruinous. Meter tilt is
     bounded by the choice's own meter weight and coin tilt by its own coin
     cost, so a bite intensifies what a card already does and cannot invent a
     consequence the card does not have — a choice costing no coins never grows
     a coin cost. Scaled proportionally, so the shape of the tilt survives
     being shrunk. */
  const budget = fxWeight(choice.fx);
  const got = fxWeight(out.fx);
  if(got > budget){
    const k = budget / got;
    for(const m in out.fx) out.fx[m] = Math.round(out.fx[m] * k);
  }
  const coinBudget = Math.abs((choice && choice.coin) || 0);
  /* NOT Math.sign(x) * 0 — that is -0, and Object.is(-0, 0) is false, so a
     strictEqual against 0 fails on a value that is zero by every other
     measure. The same trap is why the zero keys below are deleted rather than
     left sitting at -0: Math.round(-0.2) is -0 too. */
  if(Math.abs(out.coin) > coinBudget) out.coin = coinBudget === 0 ? 0 : Math.sign(out.coin) * coinBudget;
  if(out.coin === 0) out.coin = 0;
  /* A meter scaled to nothing is a meter that did not move. Leaving the key
     behind at 0 (or -0) would make a no-op tilt look like a tilt. */
  for(const m in out.fx) if(out.fx[m] === 0) delete out.fx[m];

  /* Heaviest first, at most two: three warnings under three choices is a wall
     of text on a phone with forty seconds left on the clock. */
  out.notes = hits.filter(h => h.note).sort((a,b) => b.weight - a.weight).slice(0,2).map(h => h.note);
  return out;
}

const ENGINE = {
  GAME, ROLES, RES, HOMELANDS, CARDS, INDUSTRIES, BUILDINGS, PROGRAMMES, MANDATE_FLAGS, MANDATE_WHAT, DRILL, INDECISION,
  METER_KEYS, METER_INFO, clamp, blankCountry, homelandOf, spent, totalSplit,
  pool, used, free, foundingMeters, upkeep, tradeSlots, roundIncome, drift,
  applyFx, FOUND_SCALE, biteChoice, wealthScore, pillars, score, title, cityPlan, makeCode, esc, safeColour, housed, capacity,
  AID_PER_PERSON, AID_COINS_PERSON
};

if(typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
