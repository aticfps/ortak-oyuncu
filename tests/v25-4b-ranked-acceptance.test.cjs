const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const mods=Promise.all([import('../server/ranked-matchmaking.mjs'),import('../server/ranked-admission.mjs'),import('../server/ranked-session.mjs')]);
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const [{createRankedMatchmaker},{createRankedAdmission},{createRankedSessionService,d1RankedSessionStore}]=await mods;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql','ranked-matchmaking-schema.sql','ranked-acceptance-schema.sql','ranked-acceptance-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',f),'utf8'));
 const db={prepare(q){return {bind(...args){return {
  async first(){return sql.prepare(q).get(...args)||null;},
  async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
 };}};}};
 let clock=100000,seq=0;
 const now=()=>clock;
 const q=createRankedMatchmaker(db,{clock:now,newId:()=> 'm'+(++seq)});
 const admission=()=>createRankedAdmission(db,{clock:now,seed:()=>42});
 const sessions=()=>createRankedSessionService(d1RankedSessionStore(db),{clock:now,seed:()=>42});
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 async function offer(){await q.join('a');await q.join('b');return (await q.find('a')).matchId}
 const count=table=>sql.prepare('SELECT count(*) AS n FROM '+table).get().n;
 const match=id=>sql.prepare('SELECT * FROM ranked_matches WHERE match_id=?').get(id);
 return {sql,q,admission,sessions,offer,count,match,set:n=>{clock=n}};
}
integration('V25.4b reservation creates one pending offer and consumes queue atomically',async t=>{
 const f=await fixture(t),id=await f.offer(),a=f.admission();
 assert.equal(f.count('ranked_offers'),1);assert.equal(f.count('ranked_matches'),1);assert.equal(f.count('ranked_queue'),0);
 assert.deepEqual(await a.status(id,'a'),{matchId:id,status:'pending',expiresAt:120000,remainingMs:20000,accepted:false,opponentAccepted:false});
 await assert.rejects(a.status(id,'c'),/OFFER_NOT_FOUND/);
 await assert.rejects(a.respond(id,'c','accept'),/OFFER_NOT_FOUND/);
});
integration('V25.4b one acceptance cannot start game, repeated acceptance does not change timestamp',async t=>{
 const f=await fixture(t),id=await f.offer(),a=f.admission();
 assert.equal((await a.respond(id,'a','accept')).status,'pending');
 f.set(105000);assert.equal((await a.respond(id,'a','accept')).accepted,true);
 assert.equal(f.sql.prepare('SELECT accepted_a FROM ranked_offers').get().accepted_a,100000);
 assert.equal((await a.status(id,'b')).opponentAccepted,true);
 await assert.rejects(a.start(id,'a'),/OFFER_NOT_ACCEPTED/);
 await assert.rejects(f.sessions().start(id),/RANKED_OFFER_NOT_ACCEPTED/);
 assert.equal(f.count('ranked_sessions'),0);
});
integration('V25.4b two concurrent acceptances permit one durable monitored game',async t=>{
 const f=await fixture(t),id=await f.offer();
 await Promise.all([f.admission().respond(id,'a','accept'),f.admission().respond(id,'b','accept')]);
 assert.equal((await f.admission().status(id,'a')).status,'accepted');
 const [a,b]=await Promise.all([f.admission().start(id,'a'),f.admission().start(id,'b')]);
 assert.deepEqual(a,b);assert.equal(a.state.round,1);assert.equal(a.state.presenceEnabled,true);
 assert.equal(a.revision,1);assert.equal(f.count('ranked_sessions'),1);
 assert.deepEqual(await f.admission().start(id,'a'),a);
 await assert.rejects(f.admission().start(id,'c'),/OFFER_NOT_FOUND/);
 assert.equal((await f.admission().respond(id,'a','decline')).status,'accepted');
});
integration('V25.4b decline releases both players without Elo changes or a session',async t=>{
 const f=await fixture(t),id=await f.offer(),a=f.admission();
 await a.respond(id,'a','accept');
 assert.equal((await a.respond(id,'b','decline')).status,'declined');
 assert.equal(f.match(id).status,'void');assert.equal(f.count('ranked_sessions'),0);assert.equal(f.count('ranked_settlements'),0);
 assert.equal((await a.respond(id,'b','accept')).status,'declined');
 assert.equal((await f.q.join('a')).status,'searching');assert.equal((await f.q.join('b')).status,'searching');
 assert.notEqual((await f.q.find('a')).matchId,id);
});
integration('V25.4b acceptance at deadline expires and cannot revive the offer',async t=>{
 const f=await fixture(t),id=await f.offer(),a=f.admission();
 f.set(119999);assert.equal((await a.respond(id,'a','accept')).status,'pending');
 f.set(120000);assert.equal((await a.respond(id,'b','accept')).status,'expired');
 assert.equal(f.match(id).status,'void');await assert.rejects(a.start(id,'a'),/OFFER_NOT_ACCEPTED/);
 assert.equal(f.count('ranked_sessions'),0);assert.equal(f.count('ranked_settlements'),0);
});
integration('V25.4b queue operations expire abandoned offers before checking busy players',async t=>{
 const f=await fixture(t),id=await f.offer();f.set(120000);
 assert.equal((await f.q.join('a')).status,'searching');assert.equal(f.match(id).status,'void');
 assert.equal((await f.admission().status(id,'b')).status,'expired');
});
integration('V25.4b accepted offer survives deadline and late retry starts only once',async t=>{
 const f=await fixture(t),id=await f.offer(),a=f.admission();
 await a.respond(id,'a','accept');await a.respond(id,'b','accept');f.set(140000);await f.q.prune();
 assert.equal((await a.status(id,'b')).status,'accepted');
 const r=await a.start(id,'b');assert.equal(r.state.current.deadline,160000);
 assert.equal(f.count('ranked_sessions'),1);
});
test('V25.4b acceptance remains internal; public ranked is disabled',()=>{
 for(const p of ['server/ranked-foundation.mjs','functions/api/ranked/me.js','functions/api/ranked/status.js','index.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');assert.doesNotMatch(s,/createRankedAdmission|ranked-admission\.mjs/);
 }
 assert.match(fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8'),/rankedEnabled:false/);
});
