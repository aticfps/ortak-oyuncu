const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const mods=Promise.all([import('../server/ranked-game.mjs'),import('../server/ranked-session.mjs'),import('../server/ranked-finalization.mjs')]);
async function game(){
 const [{createRankedGame}]=await mods;let t=1000;
 return {g:createRankedGame({matchId:'m',uidA:'a',uidB:'b'},{clock:()=>t,choose:()=>0}),set:n=>{t=n}};
}
test('V25.3f presence is opt-in, monitor is idempotent and spectators cannot send heartbeats',async()=>{
 const {g,set}=await game();
 assert.equal(g.heartbeat('a').reason,'MONITOR_NOT_ENABLED');
 assert.equal(g.monitor().accepted,true);
 assert.equal(g.monitor().reason,'MONITOR_ALREADY_ENABLED');
 set(6000);assert.equal(g.heartbeat('spectator').reason,'NOT_PARTICIPANT');
 assert.equal(g.heartbeat('a').accepted,true);
 assert.equal(g.heartbeat('a').reason,'HEARTBEAT_THROTTLED');
 assert.equal(g.snapshot().presenceEnabled,true);
});
test('V25.3f reconnect within grace keeps match alive',async()=>{
 const {g,set}=await game();g.monitor();
 set(20000);g.heartbeat('a');
 set(45000);assert.equal(g.heartbeat('b').accepted,true);
 assert.equal(g.snapshot().status,'active');assert.equal(g.result(),null);
 set(46000);assert.equal(g.heartbeat('a').accepted,true);
 assert.equal(g.snapshot().status,'active');
});
test('V25.3f single disconnected player forfeits exactly at 45 seconds',async()=>{
 const {g,set}=await game();g.monitor();
 set(41000);assert.equal(g.heartbeat('a').accepted,true);
 set(45999);g.tick();assert.equal(g.snapshot().status,'active');
 set(46000);g.tick();assert.equal(g.snapshot().status,'completed');
 assert.equal(g.snapshot().termination.reason,'DISCONNECT');
 assert.equal(g.snapshot().termination.loser,'b');
 const r=g.result();assert.ok(r.scoreA>r.scoreB);
 assert.equal(g.heartbeat('b').reason,'MATCH_CLOSED');assert.deepEqual(g.result(),r);
});
test('V25.3f both absent voids the game without a settlement result',async()=>{
 const {g,set}=await game();g.monitor();set(46000);g.tick();
 assert.equal(g.snapshot().status,'void');assert.equal(g.snapshot().termination.reason,'BOTH_ABSENT');assert.equal(g.result(),null);
});
test('V25.3f voluntary surrender can only lose own match and is terminal',async()=>{
 const {g}=await game();
 assert.equal(g.surrender('spectator').reason,'NOT_PARTICIPANT');
 assert.equal(g.surrender('a').accepted,true);
 const r=g.result();assert.ok(r.scoreB>r.scoreA);
 assert.equal(g.snapshot().termination.loser,'a');assert.equal(g.snapshot().termination.reason,'SURRENDER');
 assert.equal(g.surrender('b').reason,'MATCH_CLOSED');assert.deepEqual(g.result(),r);
});
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const [,{createRankedSessionService,d1RankedSessionStore},{finalizeRankedSession}]=await mods;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const file of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',file),'utf8'));
 for(const uid of ['a','b'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 sql.prepare('INSERT INTO ranked_matches VALUES (?,?,?,?,?,?,?)').run('m','a','b','active',null,null,null);
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
 let now=1000;
 const service=()=>createRankedSessionService(d1RankedSessionStore(db),{clock:()=>now,seed:()=>42});
 const command=(id,type,uid)=>service().command('m',{id,type,uid});
 const finalize=()=>finalizeRankedSession(db,'m');
 const player=uid=>({...sql.prepare('SELECT rating,played,wins,draws,losses FROM ranked_players WHERE uid=?').get(uid)});
 return {service,command,finalize,player,set:n=>{now=n},count:()=>sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n};
}
integration('V25.3f durable disconnect survives restart and applies Elo exactly once',async t=>{
 const f=await fixture(t);await f.service().start('m');await f.command('enable','monitor');
 f.set(41000);assert.equal((await f.command('live','heartbeat','a')).accepted,true);
 f.set(46000);const res=await f.command('expire','tick');assert.equal(res.state.termination.loser,'b');
 const persisted=await f.service().terminalRecord('m');assert.equal(persisted.termination.reason,'DISCONNECT');
 assert.equal((await f.finalize()).status,'settled');assert.equal((await f.finalize()).status,'already_settled');
 assert.equal(f.player('a').rating,1025);assert.equal(f.player('b').rating,975);assert.equal(f.count(),1);
});
integration('V25.3f durable surrender rejects forged uid, duplicate and changed command owner',async t=>{
 const f=await fixture(t);await f.service().start('m');
 await assert.rejects(f.command('bad','surrender','spectator'),/NOT_PARTICIPANT/);
 const r=await f.command('leave','surrender','a');assert.equal(r.accepted,true);
 assert.equal((await f.command('leave','surrender','a')).replayed,true);
 await assert.rejects(f.command('leave','surrender','b'),/COMMAND_ID_CONFLICT/);
 assert.equal((await f.finalize()).record.outcome,'loss');
 assert.equal(f.player('a').losses,1);assert.equal(f.player('b').wins,1);
});
integration('V25.3f durable simultaneous absence remains void with unchanged ratings',async t=>{
 const f=await fixture(t);await f.service().start('m');await f.command('enable','monitor');
 f.set(46000);await f.command('expire','tick');
 assert.equal((await f.finalize()).status,'void');assert.equal((await f.finalize()).status,'void');
 assert.equal(f.count(),0);assert.equal(f.player('a').played,0);assert.equal(f.player('b').rating,1000);
});
test('V25.3f presence and surrender still not exposed to HTTP or normal rooms',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');assert.doesNotMatch(s,/PRESENCE_RULES|createRankedSessionService|finalizeRankedSession/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
