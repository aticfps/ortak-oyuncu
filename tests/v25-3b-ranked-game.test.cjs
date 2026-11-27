const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const game=import('../server/ranked-game.mjs'),catalog=import('../server/ranked-catalog.mjs');
const root=path.join(__dirname,'..');
const fixture={teams:Object.fromEntries('ABCDEFGHI'.split('').map(x=>[x,x])),
 stars:{A:1,B:4,C:3,D:1,E:2,F:3,G:4,H:5,I:2},
 players:[
  {n:'Áda Kaya',c:['A','B','C'],keys:['ada kaya','adakaya','kaya']},
  {n:'Bora Demir',c:['A','C'],keys:['bora demir','borademir','demir']},
  {n:'Cem Yıldız',c:['D','E'],keys:['cem yildiz','cemyildiz','yildiz']},
  {n:'Deniz Ak',c:['E','F'],keys:['deniz ak','denizak']},
  {n:'Efe Aslan',c:['F','G'],keys:['efe aslan','efeaslan','aslan']},
  {n:'Ferit Can',c:['G','H'],keys:['ferit can','feritcan','can']},
  {n:'Gökhan Kaya',c:['H','I'],keys:['gokhan kaya','gokhankaya','kaya']}
 ]};
async function setup(overrides={}){
 const {createRankedGame}=await game;let t=1000;
 const g=createRankedGame({matchId:'m1',uidA:'u1',uidB:'u2'},{catalog:fixture,clock:()=>t,choose:()=>0,...overrides});
 return {g,set:n=>{t=n},add:n=>{t+=n}};
}
test('V25.3b pinned server catalog matches original club and player membership data',async()=>{
 const {default:c}=await catalog;
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const start=html.indexOf('const TEAMS={'),end=html.indexOf('const STY=',start);
 assert.ok(start>=0&&end>start);
 const raw=vm.runInNewContext(html.slice(start,end)+'\nJSON.stringify({teams:Object.fromEntries(Object.entries(TEAMS).map(([k,v])=>[k,v[0]])),stars:STARS,players:PLAYERS.map(({n,c,keys})=>({n,c,keys}))})',{}, {timeout:3000});
 const expected=JSON.parse(raw);
 assert.equal(Object.keys(c.teams).length,114);assert.equal(c.players.length,1839);
 assert.deepEqual(c.teams,expected.teams);assert.deepEqual(c.stars,expected.stars);
 assert.deepEqual(c.players,expected.players);
});
test('V25.3b default catalog starts a real playable pair with hidden candidates',async()=>{
 const {createRankedGame}=await game,{default:c}=await catalog;
 const g=createRankedGame({matchId:'m1',uidA:'u1',uidB:'u2'},{clock:()=>1000,choose:()=>0});
 const s=g.snapshot();assert.equal(s.round,1);assert.equal(s.status,'active');
 assert.equal(s.current.deadline,21000);assert.equal(s.history.length,0);
 assert.ok(c.players.some(p=>s.current.clubs.every(k=>p.c.includes(k))));
 assert.deepEqual(Object.keys(s.current).sort(),['clubs','deadline','points']);
 assert.equal(g.result(),null);
});
test('V25.3b strict normalized answer scores server points once and advances',async()=>{
 const {g}=await setup();const s=g.snapshot();
 assert.deepEqual(s.current.clubs,['A','B']);assert.equal(s.current.points,3);
 assert.equal(g.answer('u1',1,'ADA KAYA').accepted,true);
 assert.equal(g.snapshot().scoreA,3);assert.equal(g.snapshot().scoreB,0);
 assert.equal(g.snapshot().history[0].player,'Áda Kaya');
 assert.equal(g.answer('u2',1,'Ada Kaya').reason,'STALE_ROUND');
 assert.equal(g.snapshot().round,2);
});
test('V25.3b rejects spectator, malformed answer, wrong exact name and ambiguous alias',async()=>{
 const {g,add}=await setup();
 assert.equal(g.answer('spectator',1,'ada kaya').reason,'NOT_PARTICIPANT');
 assert.equal(g.answer('u1',1,{}).reason,'INVALID_ANSWER');
 assert.equal(g.answer('u1',1,'x'.repeat(101)).reason,'INVALID_ANSWER');
 assert.equal(g.answer('u1',1,'Gökhan Kaya').reason,'WRONG_ANSWER');add(3000);
 assert.equal(g.answer('u1',1,'kaya').reason,'WRONG_ANSWER');
 assert.equal(g.snapshot().scoreA,0);assert.equal(g.snapshot().round,1);
});
test('V25.3b independent cooldown is enforced and resets next round',async()=>{
 const {g,add}=await setup();
 assert.equal(g.answer('u1',1,'no answer').reason,'WRONG_ANSWER');
 add(2999);assert.equal(g.answer('u1',1,'Ada Kaya').reason,'COOLDOWN');
 assert.equal(g.answer('u2',1,'Ada Kaya').accepted,true);
 assert.equal(g.answer('u1',2,'Bora Demir').accepted,true);
 assert.equal(g.snapshot().scoreB,3);assert.equal(g.snapshot().scoreA,2);
});
test('V25.3b already used player cannot score again and pair is not repeated',async()=>{
 const {g,add}=await setup();g.answer('u1',1,'Ada Kaya');
 assert.deepEqual(g.snapshot().current.clubs,['A','C']);
 assert.equal(g.answer('u2',2,'Ada Kaya').reason,'PLAYER_USED');
 add(1500);assert.equal(g.answer('u2',2,'Bora Demir').accepted,true);
 assert.deepEqual(g.snapshot().current.clubs,['D','E']);
 assert.equal(g.snapshot().scoreB,2);
});
test('V25.3b exact deadline rejects old answer and records timeout without points',async()=>{
 const {g,set}=await setup();set(21000);
 assert.equal(g.answer('u1',1,'Ada Kaya').reason,'STALE_ROUND');
 const s=g.snapshot();assert.equal(s.round,2);assert.equal(s.history[0].winner,null);
 assert.equal(s.history[0].points,0);assert.equal(s.scoreA,0);assert.equal(s.current.deadline,41000);
});
test('V25.3b five completed rounds produce one immutable terminal server result',async()=>{
 const {g,add}=await setup();
 for(let i=1;i<=5;i++){add(20000);g.tick()}
 const r=g.result();assert.deepEqual(r,{matchId:'m1',uidA:'u1',uidB:'u2',scoreA:0,scoreB:0,finishedAt:101000});
 assert.ok(Object.isFrozen(r));assert.equal(g.snapshot().status,'completed');
 assert.equal(g.snapshot().history.length,5);
 assert.equal(g.answer('u1',5,'Ada Kaya').reason,'MATCH_CLOSED');
 add(1000);g.tick();assert.deepEqual(g.result(),r);
});
test('V25.3b snapshots cannot mutate authoritative game state',async()=>{
 const {g}=await setup();const s=g.snapshot();s.current.clubs[0]='Z';s.scoreA=999;
 assert.equal(g.snapshot().scoreA,0);assert.equal(g.snapshot().current.clubs[0],'A');
 g.answer('u1',1,'Ada Kaya');const h=g.snapshot();h.history[0].clubs[0]='Z';h.history[0].winner='u2';
 assert.equal(g.snapshot().history[0].clubs[0],'A');assert.equal(g.snapshot().history[0].winner,'u1');
});
test('V25.3b exhausted pool voids safely without settling and invalid server identity/clock fails',async()=>{
 const {createRankedGame}=await game;
 const {g,add}=await setup({catalog:{teams:{A:'A',B:'B'},stars:{A:1,B:1},players:[fixture.players[0]].map(p=>({...p,c:['A','B']}))}});
 g.answer('u1',1,'Ada Kaya');assert.equal(g.snapshot().status,'void');assert.equal(g.result(),null);
 assert.throws(()=>createRankedGame({matchId:'x',uidA:'same',uidB:'same'}),/INVALID_PARTICIPANTS/);
 const other=await setup();other.set(999);assert.throws(()=>other.g.tick(),/INVALID_SERVER_CLOCK/);
});
test('V25.3b no public route or browser integration enables ranked gameplay',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  assert.doesNotMatch(fs.readFileSync(path.join(root,p),'utf8'),/ranked-game\.mjs|createRankedGame/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
