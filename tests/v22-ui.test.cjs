const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const markup=html.slice(0,html.indexOf('<script src=')).split('</style>')[0];
const body=html.slice(html.indexOf('<body>'),html.lastIndexOf('</body>'));
const ids=[...body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const css=html.slice(html.indexOf('/* V22: compact sports studio theme'),html.indexOf('</style>'));
test('V22 lobby keeps required controls and mode cards',()=>{
  for(const id of ['lobby','gIn','gOut','whoName','myName','create','joinF','code','joinB','watchB','botL','botGo','dGo','pfGo','seasonT','howB'])assert.ok(ids.includes(id),id);
  for(const mode of ['v22-create','v22-join','v22-bot','v22-daily'])assert.ok(body.includes('class="card '+mode+'"'),mode);
});
test('gameplay screens and control IDs survive the design update',()=>{
  for(const id of ['wait','pick','rev','ans','res','end','board','chips','rd','slots','start','addBot','nine','tA','tB','clock','aSec','ansF','ansI','ansGo','jkB','ipB','obj','next','again'])assert.ok(ids.includes(id),id);
  assert.match(html,/\[hidden\]\{display:none!important\}/);
});
test('responsive V22 style includes mobile fallback, safe area and reduced motion',()=>{
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/@media\(max-width:350px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/viewport-fit=cover/);
});
test('V22 match theme retains selection, disabled and countdown states',()=>{
  for(const selector of ['.team.mypick','.team:disabled','.btn:disabled','.clock.low #ring','.chip.me','.slot.full'])assert.ok(css.includes(selector),selector);
  assert.match(css,/--flood:#b8f568/);
});

test('V22.1 keeps unchanged HTML intact to avoid interrupting UI interactions',()=>{
  const line=html.split('\n').find(l=>l.startsWith('const stableHTML='));
  assert.ok(line);
  const stable=new Function(line+';return stableHTML')();
  let writes=0,value='';const el={get innerHTML(){return value},set innerHTML(v){writes++;value=v}};
  assert.equal(stable(el,'one'),true);assert.equal(stable(el,'one'),false);assert.equal(stable(el,'two'),true);assert.equal(writes,2);assert.equal(value,'two');
});
test('V22.1 score panel preserves DOM on unchanged player layout and writes current scores directly',()=>{
  const source=html.slice(html.indexOf('function drawBoard(){'),html.indexOf('function draw(){'));
  const harness=new Function('const G={gid:1,pl:[{u:"a",n:"Alpha",s:0,c:0},{u:"b",n:"Beta",s:0,c:1}],md:"c",r:1,R:6};const code="ABCD",myIdx=()=>0,isTeam=()=>false,tmOf=()=>0,esc=x=>x,pCol=()=>"#fff",avI=()=>"",pName=i=>G.pl[i].n,CSS={escape:x=>x};let builds=0;const scores={a:{textContent:"0"},b:{textContent:"0"}},nodes={a:{querySelector:()=>scores.a,classList:{remove(){},add(){}},offsetWidth:1},b:{querySelector:()=>scores.b,classList:{remove(){},add(){}},offsetWidth:1}};const chips={set innerHTML(v){builds++},querySelector:s=>nodes[s.includes(\'"a"\')?"a":"b"]};const other={};const $=id=>id==="chips"?chips:(other[id]||=( {}));const stableHTML=(el,v)=>el.innerHTML=v;'+source+';return {drawBoard,G,scores,builds:()=>builds}')();
  harness.drawBoard();harness.drawBoard();assert.equal(harness.builds(),1);harness.G.pl[0].s=4;harness.drawBoard();assert.equal(harness.scores.a.textContent,'4');assert.equal(harness.builds(),1);harness.G.pl[0].s=0;harness.drawBoard();assert.equal(harness.scores.a.textContent,'0');assert.equal(harness.builds(),1);
});
test('V22.1 corrects old-theme dock, card tilt and motion while keeping mobile layout',()=>{
  const v=html.slice(html.indexOf('/* V22.1:'),html.indexOf('</style>'));
  for(const key of ['#nine .team,#nine .team.r5{transform:none','.dock{background:linear-gradient(transparent,var(--bg)','#ans .tools{display:grid','.chips{display:grid','#pfBody .pfg','body.hurry .clock{animation:none}'])assert.ok(v.includes(key),key);
  assert.ok(html.includes('if(more.dataset.round!==key)'));
});

test('V22.2 centers the scoreboard within the match content width',()=>{
  assert.ok(body.includes('class="v222-scorewrap"'));assert.match(css,/\.v222-scorewrap\{max-width:808px;margin:0 auto/);
});
test('V22.2 match header, points and answer panel keep existing game controls',()=>{
  for(const id of ['v222Pts','ansI','ansGo','jkB','ipB','aMsg','aSec','opps'])assert.ok(ids.includes(id),id);
  assert.ok(body.includes('class="v222-answerpanel"'));assert.ok(html.includes("$('v222Pts').textContent=(km?kPts():+G.pts||1)+' PUAN'"));
});
test('V22.2 uses readable normal fonts and mobile match layout',()=>{
  const v=html.slice(html.indexOf('/* V22.2:'),html.indexOf('</style>'));
  assert.ok(v.includes('--ui:system-ui'));assert.ok(v.includes('#ans .clock::after'));assert.ok(v.includes('@media(max-width:600px)'));assert.ok(v.includes('#ans .tools .jk:disabled'));
});

test('V22.3 maps every club to a distinct pinned crest file',()=>{
  const t=html.slice(html.indexOf('const TEAMS='),html.indexOf('const STY='));
  const teams=new Function(t+';return TEAMS')();
  const src=html.slice(html.indexOf('const LOGO_BASE='),html.indexOf('const crestFallback='));
  const {CLUB_LOGOS,LOGO_BASE}=new Function(src+';return {CLUB_LOGOS,LOGO_BASE}')();
  assert.equal(Object.keys(CLUB_LOGOS).length,114);
  assert.deepEqual(Object.keys(CLUB_LOGOS).sort(),Object.keys(teams).sort());
  assert.equal(new Set(Object.values(CLUB_LOGOS)).size,114);
  for(const p of Object.values(CLUB_LOGOS))assert.match(p,/^logos\/[^/]+\/[^/]+\.png$/);
  assert.match(LOGO_BASE,/\/[0-9a-f]{40}\/$/);
  assert.match(CLUB_LOGOS.IPS,/Ipswich Town\.png$/);assert.match(CLUB_LOGOS.EVE,/Everton FC\.png$/);
  assert.match(CLUB_LOGOS.BVB,/Borussia Dortmund\.png$/);
});
test('V22.3 logo output retains fallback and uses encoded, pinned URLs',()=>{
  const src=html.slice(html.indexOf('const LOGO_BASE='),html.indexOf('const crestFallback='));
  const funcs=html.slice(html.indexOf('const logoURL='),html.indexOf('const esc=s=>'));
  const {crest,logoURL}=new Function(src+';const has=id=>Object.prototype.hasOwnProperty.call(CLUB_LOGOS,id);const crestFallback=id=>\'<svg class="crest"></svg>\';'+funcs+';return {crest,logoURL}')();
  assert.match(logoURL('GS'),/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/);assert.equal(logoURL('unknown'),null);
  const h=crest('EVE');assert.match(h,/crest-image/);assert.match(h,/crest-fallback/);assert.match(h,/onerror=/);assert.equal(crest('unknown'),'');
});
test('V22.3 includes compact tournament panel and crest styles across screens',()=>{
  const v=html.slice(html.indexOf('/* V22.3:'),html.indexOf('</style>'));
  for(const key of ['#brk{max-width:none','#nine .team .crest-real','.hero .fan .crest-real','.kc .k .crest-real','.crest-real.loaded .crest-fallback'])assert.ok(v.includes(key),key);
});
