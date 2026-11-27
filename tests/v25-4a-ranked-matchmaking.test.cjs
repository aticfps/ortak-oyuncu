const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const mod=import('../server/ranked-matchmaking.mjs');
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const {createRankedMatchmaker}=await mod;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql','ranked-matchmaking-schema.sql','ranked-acceptance-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',f),'utf8'));
 const db={
  prepare(q){
   return {bind(...args){
    return {
     async first(){return sql.prepare(q).get(...args)||null;},
     async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
    };
   }};
  }
 };
 let clock=100000,seq=0;
 const service=()=>createRankedMatchmaker(db,{clock:()=>clock,newId:()=> 'm'+(++seq)});
 const add=(uid,rating=1000)=>sql.prepare('INSERT INTO ranked_players(uid,rating,created_at) VALUES (?,?,1)').run(uid,rating);
 const matchCount=()=>sql.prepare('SELECT count(*) AS n FROM ranked_matches').get().n;
 const queueCount=()=>sql.prepare('SELECT count(*) AS n FROM ranked_queue').get().n;
 return {sql,db,service,add,matchCount,queueCount,advance:ms=>{clock+=ms}};
}
test('V25.4a rating search expands every 15 seconds and caps at 400',async()=>{
 const {allowedGap}=await mod;
 assert.equal(allowedGap(0),100);assert.equal(allowedGap(14999),100);assert.equal(allowedGap(15000),150);
 assert.equal(allowedGap(90000),400);assert.equal(allowedGap(1000000),400);
 assert.throws(()=>allowedGap(-1),/INVALID_WAIT/);
});
integration('V25.4a queue requires an existing profile and ignores extra client rating',async t=>{
 const f=await fixture(t),q=f.service();f.add('a',1000);
 await assert.rejects(q.join('unknown'),/PROFILE_REQUIRED/);
 await assert.rejects(q.join(''),/INVALID_UID/);
 assert.equal((await q.join('a',{rating:99999})).status,'searching');
 assert.equal((await q.join('a')).waitMs,0);assert.equal(f.queueCount(),1);
 assert.equal(f.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('a').rating,1000);
 assert.equal((await q.find('a')).status,'searching');assert.equal(f.matchCount(),0);
});
integration('V25.4a finds closest eligible opponent and consumes both entries',async t=>{
 const f=await fixture(t),q=f.service();f.add('a',1000);f.add('b',1080);f.add('c',1020);
 for(const uid of ['a','b','c'])await q.join(uid);
 const a=await q.find('a');assert.equal(a.status,'reserved');assert.equal(a.opponentUid,'c');
 const c=await q.status('c');assert.equal(c.matchId,a.matchId);assert.equal(c.opponentUid,'a');
 assert.equal((await q.status('b')).status,'searching');assert.equal(f.queueCount(),1);assert.equal(f.matchCount(),1);
 assert.equal((await q.join('a')).matchId,a.matchId);
});
integration('V25.4a both opponents must independently allow rating gap',async t=>{
 const f=await fixture(t),q=f.service();f.add('a',1000);f.add('b',1150);
 await q.join('a');f.advance(15000);await q.join('a');await q.join('b');
 assert.equal((await q.find('a')).status,'searching');
 f.advance(15000);await q.join('a');await q.join('b');
 assert.equal((await q.find('b')).status,'reserved');assert.equal(f.matchCount(),1);
});
integration('V25.4a expired queue lease resets wait and pruning removes stale players',async t=>{
 const f=await fixture(t),q=f.service();f.add('a');f.add('b');
 await q.join('a');await q.join('b');f.advance(30000);
 assert.equal((await q.status('a')).status,'idle');assert.equal((await q.find('a')).status,'idle');
 assert.equal((await q.join('a')).waitMs,0);
 assert.equal((await q.find('a')).status,'searching');
 await q.prune();assert.equal(f.queueCount(),1);assert.equal(f.matchCount(),0);
});
integration('V25.4a cancellation cannot cancel an already reserved match',async t=>{
 const f=await fixture(t),q=f.service();f.add('a');f.add('b');
 await q.join('a');await q.join('b');assert.equal((await q.cancel('b')).status,'idle');
 assert.equal((await q.find('a')).status,'searching');
 await q.join('b');const m=await q.find('a');
 assert.equal((await q.cancel('a')).matchId,m.matchId);assert.equal(f.matchCount(),1);
});
integration('V25.4a competing match requests cannot assign a player twice',async t=>{
 const f=await fixture(t);for(const uid of ['a','b','c','d']){f.add(uid);await f.service().join(uid)}
 await Promise.all(['a','b','c','d'].map(uid=>f.service().find(uid)));
 const rows=f.sql.prepare('SELECT uid_a,uid_b FROM ranked_matches').all();
 assert.equal(rows.length,2);
 assert.equal(new Set(rows.flatMap(r=>[r.uid_a,r.uid_b])).size,4);
 assert.equal(f.queueCount(),0);
 assert.throws(()=>f.sql.prepare("INSERT INTO ranked_matches VALUES ('extra','a','b','active',NULL,NULL,NULL)").run(),/RANKED_PLAYER_BUSY/);
});
integration('V25.4a a completed match awaits settlement before a player can requeue',async t=>{
 const f=await fixture(t),q=f.service();f.add('a');f.add('b');f.add('c');
 await q.join('a');await q.join('b');const m=await q.find('a');
 f.sql.prepare("UPDATE ranked_matches SET status='completed',score_a=1,score_b=0,finished_at=100000 WHERE match_id=?").run(m.matchId);
 assert.equal((await q.join('a')).status,'settlement_pending');
 const {settleRankedMatch}=await import('../server/ranked-settlement.mjs');
 await settleRankedMatch(f.db,m.matchId);
 assert.equal((await q.join('a')).status,'searching');
 await q.join('c');assert.equal((await q.find('a')).status,'reserved');
 assert.equal(f.matchCount(),2);
});
test('V25.4a queue stays internal until authenticated admission is implemented',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');assert.doesNotMatch(s,/createRankedMatchmaker|ranked-matchmaking\.mjs/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
