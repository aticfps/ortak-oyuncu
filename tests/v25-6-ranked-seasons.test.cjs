const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mod=import('../server/ranked-seasons.mjs');
test('V25.6 UTC calendar months include leap February and December rollover',async()=>{
 const {rankedSeasonAt}=await mod;
 assert.deepEqual(rankedSeasonAt(Date.UTC(2028,1,29,23,59,59,999)),{id:'2028-02',startsAt:Date.UTC(2028,1,1),endsAt:Date.UTC(2028,2,1)});
 assert.deepEqual(rankedSeasonAt(Date.UTC(2026,11,31,23,59,59,999)),{id:'2026-12',startsAt:Date.UTC(2026,11,1),endsAt:Date.UTC(2027,0,1)});
 assert.equal(rankedSeasonAt(Date.UTC(2027,0,1)).id,'2027-01');
});
test('V25.6 invalid clock, identity, binding and corrupt aggregate fail closed',async()=>{
 const {rankedSeasonAt,readRankedSeason}=await mod;
 for(const n of [0,-1,NaN,Infinity,1.1,'2026'])assert.throws(()=>rankedSeasonAt(n),/INVALID_SERVER_CLOCK/);
 await assert.rejects(readRankedSeason({},'a'),/DB_BINDING_MISSING/);
 await assert.rejects(readRankedSeason({},''),/INVALID_UID/);
 const db={prepare:()=>({bind:()=>({first:async()=>({registered:1,played:1,wins:0,draws:0,losses:0,eloDelta:0})})})};
 await assert.rejects(readRankedSeason(db,'a'),/SEASON_RESPONSE_INVALID/);
});
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
test('V25.6 season reads finished month not settlement month, both sides and only settled matches',{skip:!DatabaseSync?'Node 22.13+ required':false},async t=>{
 const {readRankedSeason}=await mod,{settleRankedMatch}=await import('../server/ranked-settlement.mjs');
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['ranked-schema.sql','ranked-settlement-schema.sql'])sql.exec(fs.readFileSync(path.join(__dirname,'..','server',f),'utf8'));
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 const db={prepare(q){return {bind(...args){return {
  async first(){return sql.prepare(q).get(...args)||null;},
  async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
 };}};}};
 const start=Date.UTC(2025,10,1),end=Date.UTC(2025,11,1);
 async function complete(id,a,b,scoreA,scoreB,finished,settled=true){
  sql.prepare("INSERT INTO ranked_matches(match_id,uid_a,uid_b,status,score_a,score_b,finished_at) VALUES (?,?,?,'completed',?,?,?)").run(id,a,b,scoreA,scoreB,finished);
  if(settled)await settleRankedMatch(db,id);
 }
 await complete('prior','a','b',1,0,start-1);
 await complete('first','b','a',0,1,start);
 await complete('last','a','b',2,2,end-1);
 await complete('next','a','b',0,1,end);
 await complete('pending','a','c',1,0,start+1,false);
 sql.prepare("INSERT INTO ranked_matches(match_id,uid_a,uid_b,status) VALUES ('void','a','c','void')").run();
 const a=await readRankedSeason(db,'a',{clock:()=>start}),b=await readRankedSeason(db,'b',{clock:()=>start});
 assert.equal(a.season.id,'2025-11');assert.deepEqual({played:a.stats.played,wins:a.stats.wins,draws:a.stats.draws,losses:a.stats.losses},{played:2,wins:1,draws:1,losses:0});
 assert.deepEqual({played:b.stats.played,wins:b.stats.wins,draws:b.stats.draws,losses:b.stats.losses},{played:2,wins:0,draws:1,losses:1});
 assert.equal(a.stats.eloDelta,-b.stats.eloDelta);
 assert.equal((await readRankedSeason(db,'a',{clock:()=>end})).stats.losses,1);
 assert.deepEqual((await readRankedSeason(db,'c',{clock:()=>start})).stats,{played:0,wins:0,draws:0,losses:0,eloDelta:0});
 assert.equal((await readRankedSeason(db,'missing',{clock:()=>start})).stats,null);
 assert.equal(sql.prepare('SELECT played FROM ranked_players WHERE uid=?').get('a').played,4);
});
