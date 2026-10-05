const { chromium } = require('/Users/joetay/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1000, height:1100 } });
  const host = await p.request.post('http://localhost:3999/api/host/create', { data:{ kind:'class' } }).then(r=>r.json());
  await p.request.post('http://localhost:3999/api/host/act', { data:{ room:host.room, hostKey:host.hostKey, act:'openjoin' } });
  const j = await p.request.post('http://localhost:3999/api/join', { data:{ room:host.room, name:'S', homeland:'high' } }).then(r=>r.json());
  await p.goto('http://localhost:3999/play', { waitUntil:'networkidle' });
  await p.fill('#j_code', j.code); await p.click('button[onclick="doCode()"]');
  await p.waitForTimeout(2000);
  await p.evaluate(() => { document.getElementById('p5').classList.remove('hidden'); renderBuildings(); });
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => {
    const el = document.querySelector('#buildLand .lg-plot:not(.filled)');
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width/2, cy = r.y + r.height/2;
    const hit = document.elementFromPoint(cx, cy);
    return { point:{x:Math.round(cx),y:Math.round(cy)},
             hitTag: hit && hit.tagName, hitClass: hit && hit.className,
             isPlot: !!(hit && hit.classList && hit.classList.contains('lg-plot')),
             ghostPE: getComputedStyle(document.getElementById('lgGhost')).pointerEvents,
             gridPE: getComputedStyle(document.getElementById('buildLand')).pointerEvents,
             plotPE: getComputedStyle(el).pointerEvents };
  });
  console.log(JSON.stringify(t, null, 1));
  await b.close();
})();
