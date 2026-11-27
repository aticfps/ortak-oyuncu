const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const engine=html.slice(html.indexOf('function shuffleTournament('),html.indexOf('const trName='));
const view=html.slice(html.indexOf('function bracketView('),html.indexOf('function drawBracket(){'));
const {makeTournament,trSeek,trCommit,bracketView,bracketTree,bracketLive}=new Function(engine+';const idxOf=u=>u?0:-1,avI=(i,s)=>"<span class=av></span>",nameOfU=u=>u,esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");'+view+';return {makeTournament,trSeek,trCommit,bracketView,bracketTree,bracketLive}')();
const ids=n=>Array.from({length:n},(_,i)=>'p'+i);
test('V23.4 bracket layout groups all tournament sizes without changing game state',()=>{
 for(let n=2;n<=8;n++){const g=makeTournament(ids(n));trSeek(g);const before=JSON.stringify(g),v=bracketView(g);
 assert.deepEqual(v.stages.map(s=>s.matches.length),n===2?[1]:n<=4?[2,1]:[4,2,1]);assert.equal(v.totalSlots,g.mt.length);assert.equal(JSON.stringify(g),before);assert.equal(v.current.i,g.mi);}
 assert.equal(bracketView({}),null);
});
test('V23.4 live score and finished score are independent and winner shown correctly',()=>{
 const g=makeTournament(ids(8));trSeek(g);g.du.p0=1;
 let v=bracketView(g);assert.equal(v.current.active,true);assert.equal(v.current.sides[0].score,1);assert.equal(v.current.sides[1].score,0);
 g.du.p0=2;trCommit(g,'p0');trSeek(g);v=bracketView(g);
 const old=v.stages[0].matches[0];assert.equal(old.done,true);assert.equal(old.sides[0].winner,true);assert.equal(old.sides[1].eliminated,true);assert.equal(old.sides[0].score,2);assert.equal(v.current.sides[0].score,0);
});
test('V23.4 handles pending, bye, withdrawal and champion states',()=>{
 const g=makeTournament(ids(5));trSeek(g);let v=bracketView(g);assert.equal(v.completed,3);assert.equal(v.stages[0].matches[0].status,'Bay');assert.equal(v.stages[0].matches[0].sides[1].score,null);assert.equal(v.stages[2].matches[0].status,'Bekliyor');
 g.tw.push(g.mt[g.mi][1]);while(trSeek(g))trCommit(g,g.mt[g.mi][0]);
 v=bracketView(g);assert.equal(v.finished,true);assert.equal(v.completed,v.totalSlots);assert.ok(v.stages.flatMap(x=>x.matches).some(m=>m.reason==='forfeit'));assert.match(bracketLive(v),/Turnuva şampiyonu/);
});
test('V23.4 player names are escaped and responsive markup includes scores and avatars',()=>{
 const g=makeTournament(['<img src=x>','other']);trSeek(g);const v=bracketView(g),tree=bracketTree(v),live=bracketLive(v);
 assert.ok(tree.includes('&lt;img src=x&gt;'));assert.ok(!tree.includes('<img src=x>'));assert.ok(live.includes('&lt;img src=x&gt;'));assert.ok(tree.includes('class=av'));assert.match(tree,/tb-match active/);assert.match(tree,/--tb-cols:1/);
});
test('V23.4 bracket detail shell persists between snapshots with keyboard accessible summary and mobile scroll',()=>{
 for(const x of ["el._tbKey!==key","el._tbPhase!==G.ph","stableHTML(el.querySelector('.tb-scroll'),bracketTree(v))","<summary>Turnuva ağacı</summary>","aria-label=\"Turnuva ağacı\"","overscroll-behavior-x:contain","--tb-min-mobile","prefers-reduced-motion:reduce","html[data-theme=\"light\"] #brk"])assert.ok(html.includes(x),x);
});
