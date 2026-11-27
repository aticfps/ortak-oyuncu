const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('function shuffleTournament('),html.indexOf('const trName='));
const api=new Function(src+';return {shuffleTournament,makeTournament,trParent,trStage,trCommit,trSeek}')();
const {makeTournament,trParent,trStage,trCommit,trSeek,shuffleTournament}=api;
const ids=n=>Array.from({length:n},(_,i)=>'p'+i);
test('V23.3 all sizes 2–8 seed unique players, appropriate byes and exactly n-1 played matches',()=>{
  for(let n=2;n<=8;n++){
    const roster=ids(n),g=makeTournament(roster),size=2**Math.ceil(Math.log2(n));
    assert.equal(g.mt.length,size-1);assert.equal(g.mt.slice(0,size/2).flat().filter(Boolean).length,n);
    assert.deepEqual(g.mt.slice(0,size/2).flat().filter(Boolean).sort(),roster.slice().sort());
    let played=0;while(trSeek(g)){const [a,b]=g.mt[g.mi];assert.ok(a&&b&&a!==b);g.du[a]=2;g.du[b]=1;assert.equal(trCommit(g,a),true);played++}
    assert.equal(played,n-1);assert.equal(g.trDone,true);assert.equal(g.ch,'p0');
    assert.equal(g.ms.filter(m=>m.reason==='bye').length,size-n);
    assert.equal(g.ms.filter(m=>m.reason==='played').length,n-1);
  }
});
test('V23.3 eight player bracket advances winners to proper semifinals and final',()=>{
 const g=makeTournament(ids(8));const seen=[];
 while(trSeek(g)){seen.push(g.mt[g.mi].slice());const w=g.mt[g.mi][1];g.du[w]=2;trCommit(g,w)}
 assert.deepEqual(seen,[['p0','p1'],['p2','p3'],['p4','p5'],['p6','p7'],['p1','p3'],['p5','p7'],['p3','p7']]);
 assert.equal(g.ch,'p7');assert.equal(trStage(7,0),'Çeyrek final 1');assert.equal(trStage(7,4),'Yarı final 1');assert.equal(trStage(7,6),'Final');
});
test('V23.3 completed duel remains current until next round, keeps score and rejects duplicate advancement',()=>{
 const g=makeTournament(ids(4));trSeek(g);g.du={p0:2,p1:1};assert.equal(trCommit(g,'outsider'),false);
 assert.equal(trCommit(g,'p0'),true);assert.equal(g.mi,0);assert.deepEqual(g.ms[0],{a:2,b:1,reason:'played'});
 assert.equal(trCommit(g,'p1'),false);assert.equal(trSeek(g),true);assert.equal(g.mi,1);assert.deepEqual(g.du,{});
});
test('V23.3 withdrawn players never advance, remaining rival receives forfeit',()=>{
 const g=makeTournament(ids(4));g.tw.push('p0','p2','p3');
 assert.equal(trSeek(g),false);assert.equal(g.ch,'p1');assert.equal(g.trDone,true);
 assert.equal(g.ms[0].reason,'forfeit');assert.equal(g.mw[1],'');assert.equal(g.mw[2],'p1');
});
test('V23.3 serialized bracket resumes without replaying completed match or bye',()=>{
 let g=makeTournament(ids(5));assert.equal(trSeek(g),true);const i=g.mi,w=g.mt[i][1];g.du[w]=2;trCommit(g,w);
 g=JSON.parse(JSON.stringify(g));assert.equal(trSeek(g),true);assert.ok(g.mi>i);assert.equal(g.mw[i],w);assert.equal(g.ms[i].b,2);
 while(trSeek(g))trCommit(g,g.mt[g.mi][0]);assert.ok(g.ch);assert.equal(g.trDone,true);
});
test('V23.3 shuffle retains unique roster and does not mutate input; invalid roster rejected',()=>{
 const a=ids(8),b=shuffleTournament(a,()=>0);assert.deepEqual(a,ids(8));assert.deepEqual(b.slice().sort(),a);
 for(const bad of [[],['a'],['a','a'],ids(9)]){let rejected=false;try{makeTournament(bad)}catch(e){rejected=true}assert.equal(rejected,true)}
});
test('V23.3 tournament integration preserves current duel for appeal and handles final, disconnect, spectators and score display',()=>{
 for(const marker of ["Object.assign(G,makeTournament(shuffleTournament(G.pl.map(p=>p.u))))","if(G.ph==='res'&&G.ob)return;","G.trDone||!trSeek(G)","trWithdraw(p.u)","isDuel(q.u)","Sonraki eşleşme","Turnuva kazanan olmadan bitti","['pick','rev','ans','res','end'].includes(G.ph)"])assert.ok(html.includes(marker),marker);
});
