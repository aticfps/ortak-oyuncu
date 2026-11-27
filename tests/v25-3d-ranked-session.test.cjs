const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const modules=Promise.all([import('../server/ranked-session.mjs'),import('../server/ranked-catalog.mjs')]);
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const [{createRankedSessionService,d1RankedSessionStore},{default:catalog}]=await modules;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('PRAGMA foreign_keys=ON');
 for(const file of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql','ranked-session-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',file),'utf8'));
 for(const uid of ['a','b'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 sql.prepare('INSERT INTO ranked_matches VALUES (?,?,?,?,?,?,?)').run('m','a','b','active',null,null,null);
 let clock=1000;
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
 const store=d1RankedSessionStore(db);
 const service=()=>createRankedSessionService(store,{clock:()=>clock,seed:()=>42});
 const correct=s=>{const p=catalog.players.find(p=>s.current.clubs.every(k=>p.c.includes(k)));assert.ok(p);return p.n};
 const getRow=()=>sql.prepare('SELECT * FROM ranked_sessions WHERE match_id=?').get('m');
 return {sql,store,service,correct,getRow,set:t=>{clock=t},advance:ms=>{clock+=ms}};
}
integration('V25.3d session start is idempotent and restart restores same private seeded state',async t=>{
 const f=await fixture(t),a=f.service(),s=await a.start('m');
 assert.equal(s.round,1);assert.deepEqual(await f.service().start('m'),s);
 assert.deepEqual((await f.service().snapshot('m','a')).state,s);
 assert.equal(f.getRow().revision,0);assert.ok(!JSON.stringify(s).includes('seed'));
 assert.ok(!JSON.stringify(s).includes('events'));
 await assert.rejects(a.snapshot('m','spectator'),/NOT_PARTICIPANT/);
 await assert.rejects(a.start('missing'),/MATCH_NOT_FOUND/);
});
integration('V25.3d correct answer survives restart and duplicate ID never scores twice',async t=>{
 const f=await fixture(t),a=f.service(),s=await a.start('m');
 const c={id:'a1',type:'answer',uid:'a',round:1,input:f.correct(s)};
 const r=await a.command('m',c);assert.equal(r.accepted,true);assert.equal(r.revision,1);
 const restarted=f.service(),retry=await restarted.command('m',c);
 assert.equal(retry.replayed,true);assert.equal(retry.revision,1);assert.deepEqual(retry.state,r.state);
 assert.equal(retry.state.scoreA,s.current.points);
 await assert.rejects(restarted.command('m',{...c,input:'different'}),/COMMAND_ID_CONFLICT/);
});
integration('V25.3d incorrect answer cooldown survives restart and no-op commands do not grow journal',async t=>{
 const f=await fixture(t),a=f.service(),s=await a.start('m');
 const wrong=await a.command('m',{id:'wrong',type:'answer',uid:'a',round:1,input:'not a known footballer'});
 assert.equal(wrong.reason,'WRONG_ANSWER');assert.equal(wrong.revision,1);
 const b=f.service(),r=await b.command('m',{id:'blocked',type:'answer',uid:'a',round:1,input:f.correct(s)});
 assert.equal(r.reason,'COOLDOWN');assert.equal(r.revision,1);
 assert.equal((await b.command('m',{id:'tick',type:'tick'})).revision,1);
 f.advance(3000);
 assert.equal((await b.command('m',{id:'valid',type:'answer',uid:'a',round:1,input:f.correct(s)})).accepted,true);
});
integration('V25.3d interleaved answers compare-and-set, exactly one wins the round',async t=>{
 const f=await fixture(t),a=f.service(),s=await a.start('m'),input=f.correct(s);
 const r=await Promise.all([a.command('m',{id:'one',type:'answer',uid:'a',round:1,input}),f.service().command('m',{id:'two',type:'answer',uid:'b',round:1,input})]);
 assert.equal(r.filter(x=>x.accepted===true).length,1);assert.equal(r.filter(x=>x.reason==='STALE_ROUND').length,1);
 const state=(await a.snapshot('m','b')).state;
 assert.equal(state.scoreA+state.scoreB,s.current.points);assert.equal(f.getRow().revision,1);
});
integration('V25.3d timer and terminal result survive restart with no ELO side effects',async t=>{
 const f=await fixture(t);await f.service().start('m');
 for(let i=1;i<=5;i++){f.advance(20000);const r=await f.service().command('m',{id:'t'+i,type:'tick'});assert.equal(r.revision,i)}
 const result=await f.service().terminal('m');
 assert.deepEqual(result,{matchId:'m',uidA:'a',uidB:'b',scoreA:0,scoreB:0,finishedAt:101000});
 assert.equal(f.sql.prepare("SELECT status FROM ranked_matches WHERE match_id='m'").get().status,'active');
 assert.equal(f.sql.prepare("SELECT rating FROM ranked_players WHERE uid='a'").get().rating,1000);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
 assert.equal((await f.service().command('m',{id:'late',type:'tick'})).revision,5);
});
integration('V25.3d malformed journal, forged participant and bad revision fail closed',async t=>{
 const f=await fixture(t),a=f.service();await a.start('m');
 await assert.rejects(a.command('m',{id:'fake',type:'answer',uid:'z',round:1,input:'test'}),/NOT_PARTICIPANT/);
 await assert.rejects(a.command('m',{id:'bad',type:'answer',uid:'a',round:999,input:'test'}),/INVALID_COMMAND/);
 assert.equal(f.getRow().revision,0);
 assert.throws(()=>f.sql.exec("UPDATE ranked_sessions SET revision=3 WHERE match_id='m'"),/RANKED_SESSION_REVISION/);
 f.sql.exec("UPDATE ranked_sessions SET revision=1,state_json='{}' WHERE match_id='m'");
 await assert.rejects(a.snapshot('m','a'),/INVALID_SESSION/);
});
integration('V25.3d voided match cannot be created or modified via session store',async t=>{
 const f=await fixture(t),a=f.service();await a.start('m');
 f.sql.exec("UPDATE ranked_matches SET status='void' WHERE match_id='m'");
 f.advance(20000);
 await assert.rejects(a.command('m',{id:'timeout',type:'tick'}),/SESSION_RETRY_REQUIRED/);
 assert.equal(f.getRow().revision,0);
 f.sql.prepare('INSERT INTO ranked_matches VALUES (?,?,?,?,?,?,?)').run('void','a','b','void',null,null,null);
 await assert.rejects(a.start('void'),/MATCH_NOT_ACTIVE/);
});
test('V25.3d session internals remain disconnected from public routes and UI',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  assert.doesNotMatch(fs.readFileSync(path.join(root,p),'utf8'),/ranked-session\.mjs|createRankedSessionService/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
