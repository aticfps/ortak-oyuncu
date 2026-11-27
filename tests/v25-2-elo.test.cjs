const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=import('../server/ranked-elo.mjs');
const player=(uid,rating=1000)=>({uid,rating,played:0,wins:0,draws:0,losses:0});
test('V25.2 equal ratings win/loss transfer 25, draw unchanged',async()=>{
 const {calculateElo}=await mod;
 for(const [outcome,delta] of [['win',25],['loss',-25],['draw',0]]){
  const r=calculateElo(1000,1000,outcome);
  assert.equal(r.deltaA,delta);assert.equal(r.deltaB,-delta||0);
  assert.equal(r.ratingA,1000+delta);assert.equal(r.ratingB,1000-delta);
 }
});
test('V25.2 stronger opponents reward upsets and weaker opponents penalize losses',async()=>{
 const {calculateElo}=await mod;
 for(const [b,w,l] of [[800,12,-38],[900,18,-32],[1000,25,-25],[1100,32,-18],[1200,38,-12]]){
  assert.equal(calculateElo(1000,b,'win').deltaA,w);
  assert.equal(calculateElo(1000,b,'loss').deltaA,l);
 }
 assert.equal(calculateElo(1000,1200,'draw').deltaA,13);
 assert.equal(calculateElo(1000,800,'draw').deltaA,-13);
});
test('V25.2 rating boundaries conserve points and never exceed schema',async()=>{
 const {calculateElo}=await mod;
 for(const a of [0,1,25,800,1000,1200,99999,100000])for(const b of [0,1,25,800,1000,1200,99999,100000])for(const o of ['win','draw','loss']){
  const r=calculateElo(a,b,o);
  assert.ok(Number.isSafeInteger(r.ratingA)&&r.ratingA>=0&&r.ratingA<=100000);
  assert.ok(Number.isSafeInteger(r.ratingB)&&r.ratingB>=0&&r.ratingB<=100000);
  assert.equal(r.ratingA+r.ratingB,a+b);assert.equal(r.deltaA+r.deltaB,0);
  assert.ok(Math.abs(r.deltaA)<=50);
 }
});
test('V25.2 invalid ratings and outcomes are rejected',async()=>{
 const {calculateElo}=await mod;
 for(const x of [-1,100001,NaN,Infinity,1.5,'1000',null,undefined]){
  assert.throws(()=>calculateElo(x,1000,'win'),/INVALID_RATING/);
  assert.throws(()=>calculateElo(1000,x,'win'),/INVALID_RATING/);
 }
 for(const x of [0,1,'WIN','forfeit',{},null,undefined])assert.throws(()=>calculateElo(1000,1000,x),/INVALID_OUTCOME/);
});
test('V25.2 result planner updates both counters without mutating profiles',async()=>{
 const {planEloResult}=await mod;
 const a=Object.freeze(player('a')),b=Object.freeze(player('b'));
 const r=planEloResult(a,b,'win');
 assert.deepEqual(r.a,{uid:'a',rating:1025,played:1,wins:1,draws:0,losses:0});
 assert.deepEqual(r.b,{uid:'b',rating:975,played:1,wins:0,draws:0,losses:1});
 const d=planEloResult(r.a,r.b,'draw');
 assert.equal(d.a.played,2);assert.equal(d.a.draws,1);assert.equal(d.b.draws,1);
 const l=planEloResult(a,b,'loss');assert.equal(l.a.losses,1);assert.equal(l.b.wins,1);
 assert.equal(a.played,0);assert.equal(b.rating,1000);
 assert.deepEqual(planEloResult(a,b,'win'),r);
});
test('V25.2 planner rejects same player, malformed profiles and unsafe counters',async()=>{
 const {planEloResult}=await mod;
 const a=player('a'),b=player('b');
 assert.throws(()=>planEloResult(a,a,'win'),/SAME_PLAYER/);
 for(const p of [null,player(''),player('x'.repeat(129))])assert.throws(()=>planEloResult(p,b,'win'),/INVALID_PLAYER/);
 for(const p of [{...a,played:1},{...a,wins:-1},{...a,draws:0.5},{...a,losses:'0'},{...a,played:Number.MAX_SAFE_INTEGER,wins:Number.MAX_SAFE_INTEGER}])assert.throws(()=>planEloResult(p,b,'win'),/INVALID_STATS/);
});
test('V25.2 pure engine is not exposed through ranked foundation or public HTML',()=>{
 const root=path.join(__dirname,'..');
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');
  assert.doesNotMatch(s,/ranked-elo\.mjs|planEloResult|calculateElo/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
