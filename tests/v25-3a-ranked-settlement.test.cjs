const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mod=import('../server/ranked-settlement.mjs');
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ with node:sqlite required':false},fn);
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(read('server/ranked-schema.sql'));sql.exec(read('server/ranked-settlement-schema.sql'));
 sql.exec(read('server/ranked-settlement-schema.sql')); // idempotent migration
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 const match=(id,a='a',b='b',status='completed',sa=3,sb=1)=>sql.prepare('INSERT INTO ranked_matches VALUES (?,?,?,?,?,?,?)').run(id,a,b,status,status==='completed'?sa:null,status==='completed'?sb:null,status==='completed'?1:null);
 const player=uid=>({...sql.prepare('SELECT rating,played,wins,draws,losses FROM ranked_players WHERE uid=?').get(uid)});
 const count=()=>sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n;
 let beforeWrite;
 const db={prepare(query){return {bind(...args){return {
  async first(){return sql.prepare(query).get(...args)||null},
  async run(){if(beforeWrite){const fn=beforeWrite;beforeWrite=null;await fn()}
   const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}
 }}}}};
 return {sql,db,match,player,count,before(fn){beforeWrite=fn}};
}
integration('V25.3a completed match atomically records both profiles and audit ledger',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('m1');
 const r=await settleRankedMatch(f.db,'m1');
 assert.equal(r.status,'settled');assert.equal(r.record.outcome,'win');assert.equal(r.record.model,'elo-v1-k50');
 assert.deepEqual(f.player('a'),{rating:1025,played:1,wins:1,draws:0,losses:0});
 assert.deepEqual(f.player('b'),{rating:975,played:1,wins:0,draws:0,losses:1});assert.equal(f.count(),1);
});
integration('V25.3a duplicate, concurrent and late replay never double settle',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('m1');
 const r=await Promise.all([settleRankedMatch(f.db,'m1'),settleRankedMatch(f.db,'m1')]);
 assert.deepEqual(r.map(x=>x.status).sort(),['already_settled','settled']);
 f.match('m2','a','c');await settleRankedMatch(f.db,'m2');
 assert.equal((await settleRankedMatch(f.db,'m1')).status,'already_settled');
 assert.equal(f.count(),2);assert.equal(f.player('a').played,2);assert.equal(f.player('b').played,1);
});
integration('V25.3a stale snapshot retries and recalculates with current ratings',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('m1');f.match('m2','a','c');
 f.before(()=>settleRankedMatch(f.db,'m2'));
 const r=await settleRankedMatch(f.db,'m1');
 assert.equal(r.record.rating_a_before,1025);assert.equal(r.record.played_a_before,1);
 assert.equal(f.count(),2);assert.equal(f.player('a').played,2);
 assert.equal(f.player('a').rating+f.player('b').rating+f.player('c').rating,3000);
});
integration('V25.3a active, void, missing and malformed matches cannot settle',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('active','a','b','active');f.match('void','a','b','void');
 for(const id of ['active','void'])await assert.rejects(settleRankedMatch(f.db,id),/MATCH_NOT_COMPLETED/);
 await assert.rejects(settleRankedMatch(f.db,'missing'),/MATCH_NOT_FOUND/);
 await assert.rejects(settleRankedMatch(f.db,'../bad'),/INVALID_MATCH_ID/);
 assert.throws(()=>f.match('same','a','a'),/CHECK/);
 assert.throws(()=>f.match('bad','a','b','completed',null,1),/CHECK/);
 assert.equal(f.count(),0);assert.equal(f.player('a').rating,1000);
});
integration('V25.3a failure updating second player rolls back first player and ledger',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('m1');
 f.sql.exec("CREATE TRIGGER fail_second BEFORE UPDATE ON ranked_players WHEN OLD.uid='b' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 await assert.rejects(settleRankedMatch(f.db,'m1'),/forced failure/);
 assert.equal(f.count(),0);for(const uid of ['a','b'])assert.equal(f.player(uid).rating,1000);
 assert.equal(f.player('a').played,0);
 f.sql.exec('DROP TRIGGER fail_second');assert.equal((await settleRankedMatch(f.db,'m1')).status,'settled');
});
integration('V25.3a outcome is derived from stored scores and final records are immutable',async t=>{
 const {settleRankedMatch}=await mod,f=fixture(t);f.match('draw','a','b','completed',2,2);
 const d=await settleRankedMatch(f.db,'draw');assert.equal(d.record.outcome,'draw');assert.equal(f.player('a').draws,1);
 f.match('loss','a','b','completed',1,2);
 const l=await settleRankedMatch(f.db,'loss');assert.equal(l.record.outcome,'loss');assert.equal(f.player('a').losses,1);
 assert.equal(f.player('b').wins,1);
 assert.throws(()=>f.sql.exec("UPDATE ranked_matches SET score_a=9 WHERE match_id='loss'"),/IMMUTABLE/);
 assert.throws(()=>f.sql.exec("DELETE FROM ranked_settlements WHERE match_id='loss'"),/IMMUTABLE/);
 assert.throws(()=>f.sql.exec("UPDATE ranked_settlements SET outcome='win' WHERE match_id='loss'"),/IMMUTABLE/);
});
integration('V25.3a database guard rejects wrong outcome or stale direct ledger insert',t=>{
 const f=fixture(t);f.match('m1');
 const q=f.sql.prepare('INSERT INTO ranked_settlements VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 for(const args of [['m1','a','b','loss','elo-v1-k50',1000,1000,975,1025,0,0,2],['m1','a','b','win','elo-v1-k50',999,1000,1024,975,0,0,2]]){
  assert.throws(()=>q.run(...args),/RANKED_SETTLEMENT_GUARD/);
 }
 assert.equal(f.count(),0);
});
test('V25.3a no HTTP, browser or normal room integration enables rating writes',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html'])
  assert.doesNotMatch(read(p),/ranked-settlement\.mjs|settleRankedMatch/);
 assert.match(read('server/ranked-foundation.mjs'),/rankedEnabled:false/);
});
