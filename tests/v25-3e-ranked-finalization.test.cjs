const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const modules=Promise.all([import('../server/ranked-session.mjs'),import('../server/ranked-finalization.mjs'),import('../server/ranked-catalog.mjs')]);
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const [{createRankedSessionService,d1RankedSessionStore},{finalizeRankedSession},{default:catalog}]=await modules;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const file of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',file),'utf8'));
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 sql.prepare('INSERT INTO ranked_matches VALUES (?,?,?,?,?,?,?)').run('m','a','b','active',null,null,null);
 let now=1000;
 const db={
  prepare(query){
   return {
    bind(...args){
     return {
      async first(){return sql.prepare(query).get(...args)||null;},
      async run(){
       const result=sql.prepare(query).run(...args);
       return {success:true,meta:{changes:Number(result.changes)}};
      }
     };
    }
   };
  }
 };
 const service=()=>createRankedSessionService(d1RankedSessionStore(db),{clock:()=>now,seed:()=>42});
 const start=()=>service().start('m');
 async function complete(win=true){
  let s=await start(),n=0;
  if(win){const p=catalog.players.find(p=>s.current.clubs.every(k=>p.c.includes(k)));assert.ok(p);
   const r=await service().command('m',{id:'answer',type:'answer',uid:'a',round:1,input:p.n});
   assert.equal(r.accepted,true);n=1;
  }
  for(let i=n;i<5;i++){now+=20000;await service().command('m',{id:'tick'+i,type:'tick'})}
  const result=await service().terminal('m');assert.ok(result);return result;
 }
 return {sql,db,service,start,complete,finalize:()=>finalizeRankedSession(db,'m'),finalizeRankedSession,
  match:()=>sql.prepare("SELECT * FROM ranked_matches WHERE match_id='m'").get(),
  player:uid=>({...sql.prepare('SELECT rating,played,wins,draws,losses FROM ranked_players WHERE uid=?').get(uid)}),
  count:()=>sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n};
}
integration('V25.3e active session cannot settle and extra client scores have no effect',async t=>{
 const f=await fixture(t);await f.start();
 assert.deepEqual(await f.finalizeRankedSession(f.db,'m',{scoreA:999,scoreB:0}),{status:'pending'});
 assert.equal(f.match().status,'active');assert.equal(f.count(),0);assert.equal(f.player('a').rating,1000);
});
integration('V25.3e authoritative game win commits exact scores and settles both players',async t=>{
 const f=await fixture(t),r=await f.complete();assert.ok(r.scoreA>r.scoreB);
 const out=await f.finalize();assert.equal(out.status,'settled');assert.equal(out.record.outcome,'win');
 const m=f.match();assert.equal(m.status,'completed');assert.equal(m.score_a,r.scoreA);assert.equal(m.score_b,r.scoreB);assert.equal(m.finished_at,r.finishedAt);
 assert.deepEqual(f.player('a'),{rating:1025,played:1,wins:1,draws:0,losses:0});
 assert.deepEqual(f.player('b'),{rating:975,played:1,wins:0,draws:0,losses:1});
 assert.equal(f.count(),1);
});
integration('V25.3e simultaneous finalizers and late retries settle only once',async t=>{
 const f=await fixture(t);await f.complete();
 const all=await Promise.all([f.finalize(),f.finalize(),f.finalize()]);
 assert.equal(all.filter(x=>x.status==='settled').length,1);
 assert.equal(all.filter(x=>x.status==='already_settled').length,2);
 assert.equal((await f.finalize()).status,'already_settled');
 assert.equal(f.player('a').played,1);assert.equal(f.player('b').played,1);assert.equal(f.count(),1);
});
integration('V25.3e settlement failure leaves completed score recoverable without partial Elo writes',async t=>{
 const f=await fixture(t);await f.complete();
 f.sql.exec("CREATE TRIGGER fail_b BEFORE UPDATE ON ranked_players WHEN OLD.uid='b' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 await assert.rejects(f.finalize(),/forced failure/);
 assert.equal(f.match().status,'completed');assert.equal(f.count(),0);
 assert.equal(f.player('a').rating,1000);assert.equal(f.player('b').rating,1000);
 f.sql.exec('DROP TRIGGER fail_b');
 assert.equal((await f.finalize()).status,'settled');assert.equal(f.count(),1);
});
integration('V25.3e terminal draw records equal rating and draw statistics',async t=>{
 const f=await fixture(t);await f.complete(false);const r=await f.finalize();
 assert.equal(r.record.outcome,'draw');
 for(const uid of ['a','b'])assert.deepEqual(f.player(uid),{rating:1000,played:1,wins:0,draws:1,losses:0});
});
integration('V25.3e prewritten mismatching terminal score is never settled',async t=>{
 const f=await fixture(t),r=await f.complete();
 f.sql.prepare("UPDATE ranked_matches SET status='completed',score_a=?,score_b=?,finished_at=? WHERE match_id='m'").run(r.scoreA+1,r.scoreB,r.finishedAt);
 await assert.rejects(f.finalize(),/FINAL_SCORE_MISMATCH/);assert.equal(f.count(),0);
 assert.equal(f.player('a').rating,1000);
});
integration('V25.3e missing, invalid and mismatched session participants fail closed',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.finalize(),/SESSION_NOT_FOUND/);
 await assert.rejects(f.finalizeRankedSession(f.db,'missing'),/MATCH_NOT_FOUND/);
 await assert.rejects(f.finalizeRankedSession(f.db,'../bad'),/INVALID_MATCH_ID/);
 await f.start();
 const row=f.sql.prepare("SELECT state_json FROM ranked_sessions WHERE match_id='m'").get();
 const s=JSON.parse(row.state_json);s.uidB='c';
 // Replace via a test-only SQL write, without enabling a real public write path.
 f.sql.exec("DELETE FROM ranked_sessions WHERE match_id='m'");
 f.sql.prepare("INSERT INTO ranked_sessions VALUES ('m',0,?,1000)").run(JSON.stringify(s));
 await assert.rejects(f.finalize(),/SESSION_PARTICIPANT_MISMATCH/);assert.equal(f.count(),0);
});
test('V25.3e finalization is internal and ranked remains disabled',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');assert.doesNotMatch(s,/ranked-finalization\.mjs|finalizeRankedSession/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
