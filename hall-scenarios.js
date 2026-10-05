/* ===========================================================================
   The twelve cards the mass game is actually played with.

   Array order is the order they appear on the host console, so it is the order
   a game master reads down the list on the day — the four written for the
   7 August 2026 hall sit at the top for that reason, not by accident. It is
   also the order pushScenario() falls back through when no card is named.

   These live here, and NOT in game_engine.js, for one reason: tools/sync-engine.js
   copies the whole game_engine.js block verbatim into public/index.html and
   public/host.html, so anything in that file is downloaded by every student's
   phone and readable with View Source. These cards were, until this file existed.

   Required by server.js alone. It is deliberately NOT in any `into` list in
   tools/sync-engine.js and deliberately has no start-comment or end-regex pair
   for that tool to match on. Do not give it one.

   tests/scenario-secrecy.test.js fails if any of this reaches a page.

   ---------------------------------------------------------------------------
   BITES — how a choice lands differently on different countries

   A choice may carry `bite: [...]`. Each entry is a condition, an effect and a
   sentence, and the same entry produces both the arithmetic and the warning the
   group sees before it commits.

     { if:{industry:'fact', min:1}, per:'fact', fx:{E:-2}, coin:-3,
       note:'You run {n} factories — this costs you more than most.' }

   `if` is exactly one of:
     {industry:'fact', min:1}   owns at least min of that industry
     {pick:'coast'}             took that policy card, in any ministry
     {homeland:'dry'}           was dealt that homeland
     {meter:'G', below:40}      that meter is under (or `above`) a value

   `per:'fact'` multiplies the effect by how many are owned and fills {n}.
   Without it the effect applies once and the note must not say {n}.

   Two rules that are not visible in the data:

   1. THE CAP. Meter tilt can never exceed the choice's own meter weight, and
      coin tilt can never exceed its own coin cost. A choice costing no coins
      can never grow one. Write a bite as hard as it deserves — it cannot make
      a card ruinous, and it will be scaled down rather than allowed to.

   2. AT MOST TWO NOTES per choice reach a phone, the two heaviest. A third is
      still applied; it is simply not explained. Do not write four.

   Notes are read by fifteen-year-olds with a clock running. One plain sentence,
   second person, no numbers except {n}. tests/bite-deck.test.js enforces the
   mechanical half of all of this.

   Remember that industries are limited by what a homeland can afford — a River
   Delta cannot pay for two factories — so a bite keyed on a large count of
   something will fire for nobody. Check against game_engine.js before writing
   a min above 2.
   =========================================================================== */
/* ---------- scenario cards for the mass game ---------- */
const HALL = [
  /* ---- the four written for the 7 August 2026 hall, first on the list ----
     Same grammar as the eight below: three choices, no option strictly best,
     and one co-operative choice per card carrying `ally` — which
     chooseScenario weakens to 55% and fines 4 coins for a country with no
     friends, so these cards punish having stayed alone rather than merely
     rewarding having made allies. */
  { key:'service', icon:'🎖️', title:'Should Service Be a Choice?',
    story:'A popular campaign says National Service should be optional — that those who want to serve should serve, and the rest should be free to work.',
    choices:[
      /* The optional choice PAYS, and that is the point. Fewer to train is
         real money saved and more young people earning, so a group chasing
         the leaderboard has an honest reason to take it; what it costs is the
         thing that cannot be bought back in a round — everyone carrying the
         same load. A version where the tempting option merely cost coins
         would not be a temptation at all. */
      { key:'a', icon:'🛡️', label:'Keep service for all, and explain why it matters', tag:'Everyone carries it, or no one does.', fx:{D:8,H:6,S:5},      coin:-5 },
      { key:'b', icon:'✍️', label:'Make it optional',                                 tag:'Popular today. Fewer hands tomorrow.', fx:{E:8,D:-9,H:-8,S:-3}, coin:6 },
      { key:'c', icon:'🎓', label:'Keep it, but shorten it and teach real skills',     tag:'Serves twice — the country and them.', fx:{D:3,K:8,H:4},      coin:-9 }
    ]},
  { key:'exercise', icon:'🪖', title:'The Exercise You Were Not Invited To',
    story:'Two neighbours hold a joint military exercise near your waters. Nobody told you it was happening.',
    choices:[
      { key:'a', icon:'🤝', label:'Ask to join the next one, and offer your ports', tag:'Swallow the slight, gain a seat.',  fx:{D:6,H:4,S:3},  coin:-4, ally:true },
      { key:'b', icon:'🛡️', label:'Hold a bigger exercise of your own',             tag:'Nobody will overlook you twice.',   fx:{D:9,S:5,E:-4}, coin:-13 },
      { key:'c', icon:'📞', label:'Quiet phone calls, no public fuss',              tag:'Dignified. Changes little.',        fx:{D:2,S:4,K:2},  coin:-2 }
    ]},
  { key:'cyber', icon:'💻', title:'The Websites Go Dark',
    story:'Government websites are hacked overnight. Fake stories about your leaders spread faster than the denials.',
    choices:[
      { key:'a', icon:'🔒', label:'Rebuild the systems and tell the public everything', tag:'Slow, costly, and it holds.',     fx:{S:8,K:6,H:5},     coin:-14 },
      { key:'b', icon:'📢', label:'Flood the feeds with your own version',              tag:'Cheap. Nobody believes anyone now.', fx:{S:3,H:-8,K:-3}, coin:-3 },
      { key:'c', icon:'🤝', label:'Ask your allies to trace the source together',       tag:'Needs friends. Finds who did it.', fx:{S:6,D:6,K:4,H:3}, coin:-6, ally:true }
    ]},
  { key:'shadow', icon:'🕳️', title:'A Base in Your Own Country',
    story:'A terrorist group has quietly set up a base inside your borders. The money arriving with them is enormous, and none of it is clean.',
    choices:[
      { key:'a', icon:'🚔', label:'Raid them, freeze the accounts, warn the region', tag:'Costly, and it makes enemies.',    fx:{S:9,D:7,H:4,E:-4}, coin:-15 },
      { key:'b', icon:'💵', label:'Look the other way while the money builds roads', tag:'Rich today. Theirs tomorrow.',     fx:{E:12,S:-9,H:-7,D:-5}, coin:30 },
      { key:'c', icon:'🤝', label:'Work with neighbouring police to shut it down',   tag:'Slower, and it actually holds.',   fx:{S:8,D:6,H:3},      coin:-8, ally:true }
    ]},
  { key:'haze', icon:'🌫️', title:'The Haze Returns',
    story:'Thick smoke from burning forests blankets the whole region. Schools close. Tourists cancel.',
    choices:[
      { key:'a', icon:'🚨', label:'Shut the dirty factories for a month', tag:'Lose coins now, clear the air.',      fx:{G:12,H:6,E:-5}, coin:-12,
        bite:[
          { if:{industry:'fact', min:1}, per:'fact', fx:{E:-2}, coin:-3,
            note:'You run {n} factories — a month of silence costs you more than most.' },
          { if:{pick:'strip'}, fx:{E:-3}, coin:-4,
            note:'You stripped the pollution rules to grow. Putting them back is expensive.' }
        ] },
      { key:'b', icon:'😷', label:'Hand out masks and carry on',           tag:'Cheap. Nothing really changes.',       fx:{H:-4,G:-3},     coin:-3,
        bite:[
          { if:{meter:'G', below:40}, fx:{H:-2},
            note:'Your air was already bad. People notice that nothing is being fixed.' }
        ] },
      { key:'c', icon:'🤝', label:'Lead a regional clean-air pact',        tag:'Slow, needs allies, fixes the cause.', fx:{G:9,H:8,S:4,D:2}, coin:-6, ally:true,
        bite:[
          { if:{industry:'fact', min:2}, fx:{S:-2},
            note:'Your own chimneys make it harder to lecture the neighbours.' }
        ] }
    ]},
  { key:'boom', icon:'📈', title:'A Foreign Firm Comes Knocking',
    story:'A giant company will build a plant in your country tomorrow — if you drop your pollution rules.',
    choices:[
      { key:'a', icon:'✍️', label:'Sign it — take the money',      tag:'Instant riches.',                    fx:{E:10,G:-14,H:-5}, coin:34 },
      { key:'b', icon:'⚖️', label:'Sign, but keep the rules',      tag:'They pay less, the land survives.',  fx:{E:5,G:-3},        coin:16 },
      { key:'c', icon:'🙅', label:'Say no thanks',                 tag:'Invest in your own people instead.', fx:{K:6,H:5,G:3},     coin:0 }
    ]},
  { key:'riot', icon:'⚡', title:'A Rumour Spreads Online',
    story:'A fake video claims one community is getting special treatment. Angry crowds gather in two towns.',
    choices:[
      { key:'a', icon:'🚔', label:'Send in the riot police',           tag:'Quiet by tonight. Anger underneath.', fx:{S:9,H:-13,D:3}, coin:-5 },
      { key:'b', icon:'🎤', label:'Leaders of every faith speak together', tag:'Slower. Heals the real wound.',   fx:{H:15,S:6},      coin:-3 },
      { key:'c', icon:'🤐', label:'Shut down the internet',            tag:'Stops the video. Stops everything.',  fx:{S:6,H:-9,E:-7}, coin:-2 }
    ]},
  { key:'quake', icon:'🌊', title:'Disaster Next Door',
    story:'A neighbouring country is hit by a tsunami. Thousands need shelter and food right now.',
    choices:[
      { key:'a', icon:'🚁', label:'Send food, medics and rescue teams', tag:'Costs you. Friends remember.',   fx:{H:8,D:4,S:3}, coin:-14, ally:true, giveF:3 },
      { key:'b', icon:'💵', label:'Send a small donation',              tag:'Polite, safe, forgettable.',      fx:{H:2},         coin:-4 },
      { key:'c', icon:'🚪', label:'Close the border, look after our own', tag:'Save every cent. Lose every friend.', fx:{S:4,H:-7,D:-3}, coin:0 }
    ]},
  { key:'brain', icon:'🎓', title:'The Brain Drain',
    story:'Your brightest graduates are being offered double the pay overseas. A third are packing.',
    choices:[
      { key:'a', icon:'💰', label:'Pay them to stay',              tag:'Expensive, but the talent stays.', fx:{K:9,E:4},        coin:-16 },
      { key:'b', icon:'🏫', label:'Train twice as many at home',   tag:'Slow burn. Pays off later.',       fx:{K:12,H:4,E:-2},  coin:-9 },
      { key:'c', icon:'🛂', label:'Ban them from leaving',         tag:'Keeps bodies, loses hearts.',      fx:{K:4,S:5,H:-12},  coin:0 }
    ]},
  { key:'water', icon:'💧', title:'The Water Runs Low',
    story:'A long drought. Reservoirs are at 30%. Farms, factories and homes all want the same water.',
    choices:[
      { key:'a', icon:'🏭', label:'Give it to industry first',        tag:'Keeps the money flowing.',     fx:{E:7,H:-10,G:-4}, coin:10,
        bite:[
          { if:{homeland:'dry'},   fx:{H:-3}, coin:-3, note:'Dry Plains. Your reservoirs were low before this drought started.' },
          { if:{homeland:'delta'}, fx:{H:2},           note:'Your rivers hold longer than most. This is survivable.' },
          { if:{industry:'farm', min:1}, per:'farm', coin:-2,
            note:'You run {n} farms, and a farm sent to the back of the queue earns nothing.' }
        ] },
      { key:'b', icon:'🏠', label:'Ration fairly — everyone the same', tag:'Everyone shares the pain.',    fx:{H:11,S:5,E:-4},  coin:-4,
        bite:[
          { if:{homeland:'dry'},   fx:{H:-3}, note:'Dry Plains. Your reservoirs were low before this drought started.' },
          { if:{homeland:'delta'}, fx:{H:2},  note:'Your rivers hold longer than most. This is survivable.' }
        ] },
      { key:'c', icon:'🔬', label:'Build recycling plants',            tag:'Big bill now, never again.',   fx:{G:12,K:5,E:2},   coin:-18,
        bite:[
          { if:{homeland:'dry'}, fx:{G:3},
            note:'Dry Plains. Nowhere in the region needs this more than you do.' },
          { if:{meter:'K', below:45}, coin:-4,
            note:'Nobody at home knows how to build one yet, so you are paying outsiders.' }
        ] }
    ]},
  { key:'pirate', icon:'🏴‍☠️', title:'Raiders at Sea',
    story:'Armed raiders are seizing cargo ships in the strait. Insurance costs are soaring.',
    choices:[
      { key:'a', icon:'🛡️', label:'Send your navy alone',            tag:'Shows strength. Costs plenty.', fx:{D:10,S:5,E:-2}, coin:-12,
        bite:[
          { if:{pick:'coast'}, fx:{D:3}, coin:4,
            note:'Your coast guard is already out there. This costs you far less than it costs others.' },
          { if:{industry:'port', min:1}, per:'port', fx:{E:-2}, coin:-2,
            note:'You run {n} ports, and every day the strait is unsafe is money off your docks.' }
        ] },
      { key:'b', icon:'🤝', label:'Joint patrols with your allies',   tag:'Cheaper — if you have friends.', fx:{D:8,H:5,S:4},  coin:-5, ally:true,
        bite:[
          { if:{industry:'port', min:1}, per:'port', fx:{E:-2}, coin:-2,
            note:'You run {n} ports, and every day the strait is unsafe is money off your docks.' }
        ] },
      { key:'c', icon:'💸', label:'Quietly pay them off',             tag:'Problem gone. For now.',         fx:{D:-6,S:-4},    coin:-8,
        bite:[
          { if:{industry:'port', min:1}, per:'port', fx:{E:-2}, coin:-2,
            note:'You run {n} ports, and every day the strait is unsafe is money off your docks.' },
          { if:{pick:'coast'}, fx:{S:-3},
            note:'You built a coast guard and then paid the raiders anyway. People noticed.' }
        ] }
    ]},
  { key:'ai', icon:'🤖', title:'The Machines Can Do It',
    story:'New robots can do 30% of your factory jobs. Bosses want them installed by Monday.',
    choices:[
      { key:'a', icon:'⚙️', label:'Automate everything now',        tag:'Profits jump. So does unemployment.', fx:{E:12,K:5,H:-11}, coin:20 },
      { key:'b', icon:'🔁', label:'Automate slowly, retrain workers', tag:'Both, but neither quickly.',        fx:{E:5,K:9,H:6},    coin:4 },
      { key:'c', icon:'✋', label:'Ban the robots',                   tag:'Jobs safe today, behind tomorrow.',  fx:{H:6,S:5,E:-8,K:-4}, coin:0 }
    ]}
];

/* ---------------------------------------------------------------------------
   STRIKES — what the game master throws at a country, rather than asking it

   These live here for exactly the reason the cards do: tools/sync-engine.js
   copies game_engine.js verbatim into public/index.html and public/host.html,
   so anything in that file is downloaded by every student's phone and readable
   with View Source. A strike's title and story are the surprise.

   Required by server.js alone. Deliberately NOT in any `into` list in
   tools/sync-engine.js, and deliberately without a start-comment or end-regex
   pair for that tool to match on. Do not give it one.

   `shield` is the meter that protects. Three different ones across four kinds
   on purpose: Defence must not be the only pillar that ever keeps a country
   safe, in a game whose whole scoring argument is that a country is only as
   strong as its weakest pillar.

   Every fx is negative. A strike costs; it never pays. The test enforces it.
   --------------------------------------------------------------------------- */
const STRIKES = [
  { key:'raid',   icon:'☠️',  shield:'D', title:'Rogue nation raid',
    line:'Armed raiders crossed the border in the night.',
    fx:{ S:-12, H:-8 } },
  { key:'flood',  icon:'🌊',  shield:'G', title:'The river breaks its banks',
    line:'Water is through the ground floors and still rising.',
    fx:{ H:-6, E:-8 } },
  { key:'haze',   icon:'🌫️',  shield:'G', title:'The haze rolls in',
    line:'The air is unbreathable. Schools and building sites are shut.',
    fx:{ K:-6, E:-6 } },
  { key:'unrest', icon:'⚡',  shield:'H', title:'Trouble in the streets',
    line:'A dispute became a crowd, and the crowd became a fire.',
    fx:{ S:-14, E:-4 } }
];

module.exports = { HALL, STRIKES };
