const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const helper=html.slice(html.indexOf('function rankedSeasonView('),html.indexOf('const rankedSides='));
const sample=(stats={played:4,wins:3,draws:0,losses:1,eloDelta:50})=>({registered:true,season:{id:'2026-11',startsAt:Date.UTC(2026,10,1),endsAt:Date.UTC(2026,11,1)},stats});
function fixture(host='test.ortak-oyuncu.pages.dev'){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{}});return nodes.get(id)};
 const calls=[],pending=[];let user={uid:'a',getIdToken:async()=> 'test-token'};
 const fetch=async(url,opt)=>{calls.push({url,opt});return new Promise(resolve=>pending.push(resolve))};
 const source=html.slice(html.indexOf('const Ranked={'),html.indexOf("$('rankGo').onclick"));
 const f=new Function('$','firebase','location','fetch','RankedPreview','rankedPreviewHost',helper+'\nlet ME="a",screen="ranked",code=null;\n'+source+';return {Ranked,rankedSeasonView,renderRankedSeason,setUid(uid){ME=uid},setScreen(v){screen=v}}');
 const o=f($,{auth:()=>({currentUser:user})},{hostname:host,protocol:'https:'},fetch,{reset(){},inProgress(){return false}},h=>/^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(h));
 const answer=(data,status=200)=>pending.shift()(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
 return {...o,$,calls,pending,answer,setUser(uid){user={uid,getIdToken:async()=> 'test-token'}}};
}
test('V25.6a actual season results render signed ELO and win percentage',()=>{
 const f=fixture();const v=f.rankedSeasonView(sample());assert.equal(v.rate,75);assert.match(v.label,/Kasım 2026/);
 f.renderRankedSeason(sample());assert.equal(f.$('rkSeasonDelta').textContent,'+50');assert.equal(f.$('rkSeasonWinBar').value,75);assert.equal(f.$('rkSeasonLosses').textContent,'1');assert.equal(f.$('rkSeasonData').hidden,false);
});
test('V25.6a empty season is distinct from invalid, loading and hidden data',()=>{
 const f=fixture();f.renderRankedSeason(sample({played:0,wins:0,draws:0,losses:0,eloDelta:0}));assert.equal(f.$('rkSeasonPlayed').textContent,'0');assert.equal(f.$('rkSeasonRate').textContent,'—');assert.equal(f.$('rkSeasonWinBar').hidden,true);
 for(const data of [null,{...sample(),registered:false},{...sample(),season:{...sample().season,endsAt:1}},sample({played:4,wins:0,draws:0,losses:1,eloDelta:0})]){f.renderRankedSeason(data);assert.equal(f.$('rkSeasonData').hidden,true);assert.equal(f.$('rkSeasonPlayed').textContent,'—')}
 f.renderRankedSeason(null,'loading');assert.match(f.$('rkSeasonStatus').textContent,/yükleniyor/);f.renderRankedSeason(null,'hidden');assert.equal(f.$('rkSeason').hidden,true);
});
test('V25.6a season uses preview host and own bearer only; forbidden is hidden',async()=>{
 for(const host of ['ortak-oyuncu.pages.dev','example.netlify.app']){const f=fixture(host);await f.Ranked.loadSeason();assert.equal(f.calls.length,0);assert.equal(f.$('rkSeason').hidden,true)}
 const f=fixture();const p=f.Ranked.loadSeason();await Promise.resolve();assert.equal(f.calls.length,1);assert.equal(f.calls[0].opt.headers.Authorization,'Bearer test-token');assert.deepEqual(JSON.parse(f.calls[0].opt.body),{action:'season.me'});
 f.answer({},403);await p;assert.equal(f.$('rkSeason').hidden,true);
});
test('V25.6a newer refresh and account switch reject stale season responses',async()=>{
 const f=fixture();const a=f.Ranked.loadSeason();await Promise.resolve();const b=f.Ranked.loadSeason();await Promise.resolve();
 const first=f.pending.shift();f.answer(sample());await b;first(new Response(JSON.stringify(sample({played:1,wins:0,draws:0,losses:1,eloDelta:-25})),{headers:{'content-type':'application/json'}}));await a;assert.equal(f.$('rkSeasonDelta').textContent,'+50');
 const c=f.Ranked.loadSeason();await Promise.resolve();f.setUid('b');f.setUser('b');f.answer(sample());await c;assert.equal(f.$('rkSeasonData').hidden,true);
});
test('V25.6a settlement refresh is once per match and account reset clears season',()=>{
 for(const s of ["RankedPreview.onSettled=()=>this.loadSeason()","this.settledKey!==this.matchId","this.settledKey=this.matchId;this.onSettled?.()","this.seasonEpoch++;renderRankedSeason(null,'hidden')","id=\"rkSeason\"","id=\"rkSeasonWinBar\""])assert.ok(html.includes(s),s);
});
