const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mod=import('../server/ranked-rate-limit.mjs');
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const schema=fs.readFileSync(path.join(__dirname,'..','server','ranked-rate-limit-schema.sql'),'utf8');sql.exec(schema);sql.exec(schema);
 const db={prepare(q){return{bind(...args){return{async run(){const r=sql.prepare(q).run(...args);return{success:true,meta:{changes:Number(r.changes)}}}}}}}};
 return {sql,db};
}
integration('V26.0b concurrent requests share one atomic budget across accounts and action types',async t=>{
 const {takeRankedRequest}=await mod,{sql,db}=fixture(t),clock=()=>600010;
 const results=await Promise.all(Array.from({length:130},()=>takeRankedRequest(db,'a','queue.status',{clock})));
 assert.equal(results.filter(x=>x.allowed).length,120);assert.equal(results[120].retryAfter,60);
 assert.equal((await takeRankedRequest(db,'a','game.heartbeat',{clock})).allowed,false);
 assert.equal((await takeRankedRequest(db,'b','game.heartbeat',{clock})).allowed,true);
 assert.deepEqual({...sql.prepare('SELECT requests,answers FROM ranked_request_limits WHERE uid=?').get('a')},{requests:120,answers:0});
});
integration('V26.0b answer cap does not consume heartbeat quota, next minute resets both',async t=>{
 const {takeRankedRequest}=await mod,{sql,db}=fixture(t);let now=659000;const clock=()=>now;
 for(let i=0;i<30;i++)assert.equal((await takeRankedRequest(db,'a','game.answer',{clock})).allowed,true);
 assert.deepEqual(await takeRankedRequest(db,'a','game.answer',{clock}),{allowed:false,retryAfter:1});
 assert.equal((await takeRankedRequest(db,'a','game.heartbeat',{clock})).allowed,true);
 now=660000;assert.deepEqual(await takeRankedRequest(db,'a','game.answer',{clock}),{allowed:true,retryAfter:60});
 now=659999;assert.equal((await takeRankedRequest(db,'a','game.answer',{clock})).allowed,false);
 assert.deepEqual({...sql.prepare('SELECT requests,answers,window_start FROM ranked_request_limits WHERE uid=?').get('a')},{requests:1,answers:1,window_start:660000});
});
test('V26.0b invalid identity, clock and database write failure reject',async()=>{
 const {takeRankedRequest}=await mod;
 await assert.rejects(takeRankedRequest({},'','game.answer'),/INVALID_UID/);
 await assert.rejects(takeRankedRequest({},'a','game.answer'),/DB_BINDING_MISSING/);
 const db={prepare:()=>({bind:()=>({run:async()=>({success:false})})})};
 await assert.rejects(takeRankedRequest(db,'a','game.answer',{clock:()=>NaN}),/INVALID_SERVER_CLOCK/);
 await assert.rejects(takeRankedRequest(db,'a','game.answer'),/RATE_LIMIT_WRITE_FAILED/);
});
