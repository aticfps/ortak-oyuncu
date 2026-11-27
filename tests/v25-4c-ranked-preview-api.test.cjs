const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const mod=import('../server/ranked-preview-api.mjs');
const host='test.ortak-oyuncu.pages.dev',url='https://'+host+'/api/ranked/play';
const flags={RANKED_PREVIEW_ENABLED:'true',RANKED_PREVIEW_HOST:host,RANKED_PREVIEW_UIDS:'a,b'};
const verify=async token=>({uid:token});
function req(payload,token='a',extra={}){
 return new Request(extra.url||url,{method:extra.method||'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra.headers},...(extra.method==='GET'?{}:{body:typeof payload==='string'?payload:JSON.stringify(payload)})});
}
test('V25.4c preview gate refuses missing flags, production and wrong origin before auth or DB',async()=>{
 const {rankedPreviewPlay}=await mod;
 const deny=()=>{throw Error('auth must not run')};
 for(const [request,env] of [[req({action:'queue.join'}),{}],[req({action:'queue.join'},'a',{url:'https://ortak-oyuncu.pages.dev/api/ranked/play'}),flags],[req({action:'queue.join'},'a',{headers:{origin:'https://other.example'}}),flags]]){
  const r=await rankedPreviewPlay(request,env,deny);assert.equal(r.status,404);
 }
});
test('V25.4c only POST and authenticated allowlisted accounts can access preview',async()=>{
 const {rankedPreviewPlay}=await mod;
 assert.equal((await rankedPreviewPlay(req({},'a',{method:'GET'}),flags,verify)).status,405);
 assert.equal((await rankedPreviewPlay(req({},null),flags,verify)).status,401);
 assert.equal((await rankedPreviewPlay(req({},'c'),flags,verify)).status,403);
 assert.equal((await rankedPreviewPlay(req({action:'queue.status'}),flags,async()=>{throw Error('unavailable')})).status,503);
});
test('V25.4c invalid payload, forged UID/rating/score, internal actions and oversized body are rejected',async()=>{
 const {rankedPreviewPlay}=await mod;
 for(const x of [{action:'queue.join',uid:'b'},{action:'queue.join',rating:9999},{action:'game.answer',matchId:'m',commandId:'c',round:1,input:'x',score:999},{action:'game.tick',matchId:'m'},{action:'game.answer',matchId:'m',commandId:'c',round:0,input:'x'},{action:'offer.respond',matchId:'m',decision:'yes'},'bad json']){
  const r=await rankedPreviewPlay(req(x),flags,verify);assert.equal(r.status,400);
 }
 assert.equal((await rankedPreviewPlay(req('x'.repeat(3000)),flags,verify)).status,413);
 assert.equal((await rankedPreviewPlay(req({action:'queue.status'}),flags,verify)).status,503);
});
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
const integration=(name,fn)=>test(name,{skip:!DatabaseSync?'Node 22.13+ required':false},fn);
async function fixture(t){
 const {rankedPreviewPlay}=await mod;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql','ranked-matchmaking-schema.sql','ranked-acceptance-schema.sql','ranked-rate-limit-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',f),'utf8'));
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 const db={prepare(q){return {bind(...args){return {
  async first(){return sql.prepare(q).get(...args)||null;},
  async all(){return {success:true,results:sql.prepare(q).all(...args)};},
  async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
 };}};}};
 const env={...flags,RANKED_PREVIEW_UIDS:'a,b,c',RANKED_DB:db};
 async function call(uid,action,fields={}){const r=await rankedPreviewPlay(req({action,...fields},uid),env,verify);return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control'),retryAfter:r.headers.get('retry-after')}}
 async function offer(){await call('a','queue.join');await call('b','queue.join');const r=await call('a','queue.find');assert.equal(r.status,200);assert.equal(r.body.status,'reserved');assert.equal('opponentUid'in r.body,false);return r.body.matchId}
 async function start(){const matchId=await offer();await call('a','offer.respond',{matchId,decision:'accept'});await call('b','offer.respond',{matchId,decision:'accept'});const r=await call('a','offer.start',{matchId});assert.equal(r.status,200);return {matchId,r}}
 return {sql,db,call,offer,start};
}
integration('V25.4c queue and bilateral admission work through authenticated request boundary',async t=>{
 const f=await fixture(t),matchId=await f.offer();
 assert.equal((await f.call('c','offer.status',{matchId})).status,404);
 assert.equal((await f.call('c','game.poll',{matchId})).status,404);
 assert.equal((await f.call('a','offer.start',{matchId})).status,409);
 await f.call('a','offer.respond',{matchId,decision:'accept'});
 assert.equal((await f.call('a','offer.start',{matchId})).status,409);
 await f.call('b','offer.respond',{matchId,decision:'accept'});
 const a=await f.call('a','offer.start',{matchId}),b=await f.call('b','offer.start',{matchId});
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.side,'a');assert.equal(b.body.side,'b');
 assert.deepEqual(a.body.state,b.body.state);assert.equal(a.cache,'no-store');
 assert.equal(a.body.state.presenceEnabled,true);assert.equal('seed'in a.body.state,false);
});
integration('V25.4c authenticated surrender settles once and only returns own rating and relative identities',async t=>{
 const f=await fixture(t),{matchId}=await f.start();
 assert.equal((await f.call('c','game.surrender',{matchId,commandId:'s'})).status,404);
 const a=await f.call('a','game.surrender',{matchId,commandId:'s'});
 assert.equal(a.status,200);assert.equal(a.body.state.termination.loser,'self');
 assert.equal(a.body.state.termination.winner,'opponent');assert.equal(a.body.settlement.outcome,'loss');
 assert.equal(a.body.settlement.ratingAfter,975);assert.equal('uid_a'in a.body.settlement,false);
 const b=await f.call('b','game.poll',{matchId});assert.equal(b.status,200);assert.equal(b.body.settlement.outcome,'win');assert.equal(b.body.settlement.ratingAfter,1025);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,1);
});
test('V25.4c production status and existing UI stay disabled',()=>{
 const s=fs.readFileSync(path.join(root,'server/ranked-foundation.mjs'),'utf8');assert.match(s,/rankedEnabled:false/);
 const h=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(h,/id="rkJoin" type="button" disabled/);assert.match(h,/!rankedPreviewHost\(location.hostname\)/);
});

integration('V25.6 season endpoint reads only own settled results, never trusts UID or season from client',async t=>{
 const f=await fixture(t);
 const first=await f.call('a','season.me');assert.equal(first.status,200);assert.equal(first.cache,'no-store');assert.equal(first.body.registered,true);assert.deepEqual(first.body.stats,{played:0,wins:0,draws:0,losses:0,eloDelta:0});
 assert.equal((await f.call('a','season.me',{uid:'b'})).status,400);assert.equal((await f.call('a','season.me',{season:'2020-01'})).status,400);
 const {matchId}=await f.start();
 assert.equal((await f.call('a','season.me')).body.stats.played,0);
 await f.call('a','game.surrender',{matchId,commandId:'s'});
 const a=await f.call('a','season.me'),b=await f.call('b','season.me'),c=await f.call('c','season.me');
 assert.deepEqual(a.body.stats,{played:1,wins:0,draws:0,losses:1,eloDelta:-25});
 assert.deepEqual(b.body.stats,{played:1,wins:1,draws:0,losses:0,eloDelta:25});
 assert.equal(c.body.stats.played,0);assert.equal('uid'in a.body,false);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,1);
});

integration('V25.7 private history returns own scores and ELO only, excludes active and rejects forged identity',async t=>{
 const f=await fixture(t);
 const empty=await f.call('a','history.me');assert.equal(empty.status,200);assert.equal(empty.cache,'no-store');assert.deepEqual(empty.body,{matches:[],hasMore:false});
 assert.equal((await f.call('a','history.me',{uid:'b'})).status,400);
 const {matchId}=await f.start();assert.equal((await f.call('a','history.me')).body.matches.length,0);
 await f.call('a','game.surrender',{matchId,commandId:'s'});
 const a=await f.call('a','history.me'),b=await f.call('b','history.me'),c=await f.call('c','history.me');
 assert.equal(a.status,200);assert.equal(b.status,200);
 const x=a.body.matches[0],y=b.body.matches[0];
 assert.equal(x.outcome,'loss');assert.equal(y.outcome,'win');assert.equal(x.ratingAfter,975);assert.equal(y.ratingAfter,1025);
 assert.equal(x.sequence,1);assert.equal(x.score,y.opponentScore);assert.equal(x.opponentScore,y.score);
 assert.deepEqual(Object.keys(x).sort(),['matchId','finishedAt','settledAt','sequence','score','opponentScore','outcome','ratingBefore','ratingAfter'].sort());
 assert.deepEqual(c.body,{matches:[],hasMore:false});
});

integration('V25.8 private leaderboard ranks settled players and protects identity',async t=>{
 const f=await fixture(t);
 const empty=await f.call('a','leaderboard.get');assert.equal(empty.status,200);assert.deepEqual(empty.body,{rows:[],self:null,total:0});
 assert.equal((await f.call('a','leaderboard.get',{uid:'b'})).status,400);
 const {matchId}=await f.start();await f.call('a','game.surrender',{matchId,commandId:'s'});
 const a=await f.call('a','leaderboard.get'),b=await f.call('b','leaderboard.get'),c=await f.call('c','leaderboard.get');
 assert.equal(a.status,200);assert.equal(a.cache,'no-store');assert.equal(a.body.total,2);
 assert.deepEqual(a.body.rows.map(x=>[x.position,x.rating,x.isSelf]),[[1,1025,false],[2,975,true]]);
 assert.equal(a.body.self.position,2);assert.equal(b.body.self.position,1);assert.equal(c.body.self,null);
 assert.equal(a.body.rows[0].name,b.body.self.name);assert.match(a.body.rows[0].name,/^Oyuncu [0-9A-F]{12}$/);
 assert.deepEqual(Object.keys(a.body.rows[0]).sort(),['name','position','rating','played','wins','isSelf'].sort());
});

async function recoveryFixture(t,{age=180000,sessionAge=null}={}){
 const f=await fixture(t),id='recovery-match',now=Date.now(),created=now-age;
 f.sql.prepare("INSERT INTO ranked_offers(match_id,uid_a,uid_b,created_at,expires_at,status) VALUES (?,?,?,?,?,'pending')").run(id,'a','b',created,created+20000);
 f.sql.prepare("UPDATE ranked_offers SET accepted_a=?,accepted_b=?,status='accepted' WHERE match_id=?").run(created+1,created+2,id);
 let service;
 if(sessionAge!==null){
  const {createRankedSessionService,d1RankedSessionStore}=await import('../server/ranked-session.mjs');
  service=createRankedSessionService(d1RankedSessionStore(f.db),{clock:()=>now-sessionAge,seed:()=>42});
  await service.start(id,{monitor:true});
 }
 return {...f,id,service};
}
integration('V26.0a abandoned accepted offer releases both accounts without Elo changes',async t=>{
 const f=await recoveryFixture(t);
 const a=await f.call('a','queue.status');assert.equal(a.status,200);assert.equal(a.body.status,'idle');
 assert.equal((await f.call('b','queue.status')).body.status,'idle');
 assert.equal(f.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(f.id).status,'void');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
 assert.equal(f.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('a').rating,1000);
 assert.equal((await f.call('a','queue.join')).body.status,'searching');
});
integration('V26.0a fresh accepted offer and existing active session are not cancelled',async t=>{
 const f=await recoveryFixture(t,{age:30000});
 const a=await f.call('a','queue.status');assert.equal(a.status,200);assert.equal(a.body.status,'reserved');
 assert.equal((await f.call('a','offer.start',{matchId:f.id})).status,200);
 assert.equal((await f.call('b','queue.status')).body.status,'reserved');
 assert.equal(f.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(f.id).status,'active');
});
integration('V26.0a both absent session recovers through durable tick with no settlement',async t=>{
 const f=await recoveryFixture(t,{sessionAge:60000});
 const a=await f.call('a','queue.status');assert.equal(a.status,200);assert.equal(a.body.status,'settlement_pending');
 const result=await f.call('a','game.poll',{matchId:f.id});assert.equal(result.status,200);assert.equal(result.body.state.status,'void');assert.equal(result.body.state.termination.reason,'BOTH_ABSENT');
 assert.equal((await f.call('b','queue.status')).body.status,'idle');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
});
integration('V26.0a interrupted terminal result settles once during recovery',async t=>{
 const f=await recoveryFixture(t,{sessionAge:10000});
 const r=await f.service.command(f.id,{id:'internal-surrender',type:'surrender',uid:'a'});assert.equal(r.state.status,'completed');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
 const a=await f.call('a','queue.status');assert.equal(a.status,200);assert.equal(a.body.status,'settlement_pending');
 const result=await f.call('a','game.poll',{matchId:f.id});assert.equal(result.status,200);assert.equal(result.body.settlement.ratingAfter,975);
 assert.equal((await f.call('a','queue.status')).body.status,'idle');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,1);
 assert.equal(f.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('b').rating,1025);
});

integration('V26.0b authenticated endpoint enforces shared answer budget, allows heartbeat and returns 429',async t=>{
 t.mock.method(Date,'now',()=>Date.UTC(2026,10,27,12,0,10));
 const f=await fixture(t);
 const payload={matchId:'missing',commandId:'a',round:1,input:'x'};
 for(let i=0;i<30;i++)assert.equal((await f.call('a','game.answer',payload)).status,404);
 const r=await f.call('a','game.answer',payload);
 assert.equal(r.status,429);assert.equal(r.body.error,'RATE_LIMITED');assert.equal(r.body.retryAfter,50);assert.equal(r.retryAfter,'50');assert.equal(r.cache,'no-store');
 assert.equal((await f.call('a','game.heartbeat',{matchId:'missing',commandId:'h'})).status,404);
 assert.equal((await f.call('b','game.answer',payload)).status,404);
 assert.equal((await f.call('a','queue.status',{uid:'b'})).status,400);
 assert.equal(f.sql.prepare('SELECT requests FROM ranked_request_limits WHERE uid=?').get('a').requests,31);
});
integration('V26.0b missing rate schema fails closed before gameplay writes',async t=>{
 const f=await fixture(t);f.sql.exec('DROP TABLE ranked_request_limits');
 assert.equal((await f.call('a','queue.join')).status,503);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_queue').get().n,0);
});

integration('V26.0c sweep bounds expired offers and queue pruning, preserves fresh entries',async t=>{
 const f=await fixture(t),{sweepRanked}=await import('../server/ranked-sweeper.mjs'),now=Date.now();
 const add=f.sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)');
 const offer=f.sql.prepare("INSERT INTO ranked_offers(match_id,uid_a,uid_b,created_at,expires_at,status) VALUES (?,?,?,?,?,'pending')");
 const enqueue=f.sql.prepare('INSERT INTO ranked_queue(uid,joined_at,seen_at) VALUES (?,?,?)');
 for(let i=0;i<52;i++){
  const a='oa'+i,b='ob'+i;add.run(a);add.run(b);
  const at=i===51?now-1000:now-90000;offer.run('o'+i,a,b,at,at+20000);
 }
 for(let i=0;i<102;i++){const uid='q'+i;add.run(uid);const at=i===101?now-1000:now-40000;enqueue.run(uid,at,at)}
 const report=await sweepRanked(f.db,{clock:()=>now});
 assert.deepEqual(report,{expiredOffers:50,prunedQueue:100,selected:0,checked:0,failed:0});
 assert.equal(f.sql.prepare("SELECT count(*) AS n FROM ranked_offers WHERE status='pending'").get().n,2);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_queue').get().n,2);
 const second=await sweepRanked(f.db,{clock:()=>now});assert.equal(second.expiredOffers,1);assert.equal(second.prunedQueue,1);
 assert.equal(f.sql.prepare("SELECT status FROM ranked_matches WHERE match_id='o51'").get().status,'active');
 assert.equal(f.sql.prepare("SELECT uid FROM ranked_queue WHERE uid='q101'").get().uid,'q101');
});
integration('V26.0c sweep voids abandoned accepted reservations in bounded batches without Elo',async t=>{
 const f=await fixture(t),{sweepRanked}=await import('../server/ranked-sweeper.mjs'),now=Date.now(),created=now-180000;
 for(let i=0;i<4;i++){
  const a='sa'+i,b='sb'+i,id='sweep'+i;
  for(const uid of [a,b])f.sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
  f.sql.prepare("INSERT INTO ranked_offers(match_id,uid_a,uid_b,created_at,expires_at,status) VALUES (?,?,?,?,?,'pending')").run(id,a,b,created,created+20000);
  f.sql.prepare("UPDATE ranked_offers SET accepted_a=?,accepted_b=?,status='accepted' WHERE match_id=?").run(created+1,created+2,id);
 }
 const first=await sweepRanked(f.db,{clock:()=>now});assert.equal(first.checked,3);assert.equal(first.failed,0);
 const second=await sweepRanked(f.db,{clock:()=>now});assert.equal(second.checked,1);
 assert.equal(f.sql.prepare("SELECT count(*) AS n FROM ranked_matches WHERE status='void'").get().n,4);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
});
integration('V26.0c scheduled recovery preserves live sessions and voids both-absent sessions',async t=>{
 const {sweepRanked}=await import('../server/ranked-sweeper.mjs');
 const live=await recoveryFixture(t,{sessionAge:5000});
 assert.equal((await sweepRanked(live.db)).selected,0);
 assert.equal(live.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(live.id).status,'active');
 const stale=await recoveryFixture(t,{sessionAge:60000});
 assert.equal((await sweepRanked(stale.db)).checked,1);
 assert.equal(stale.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(stale.id).status,'void');
 assert.equal(stale.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
 assert.equal((await sweepRanked(stale.db)).selected,0);
});
integration('V26.0c interrupted terminal settlement is finalized once by sweep',async t=>{
 const {sweepRanked}=await import('../server/ranked-sweeper.mjs');
 const f=await recoveryFixture(t,{sessionAge:60000});
 // Surrender at session creation time, before the heartbeat expiry.
 const r=await f.service.command(f.id,{id:'internal-surrender',type:'surrender',uid:'a'});assert.equal(r.state.status,'completed');
 const terminal=await f.service.terminalRecord(f.id),result=terminal.result;
 f.sql.prepare("UPDATE ranked_matches SET status='completed',score_a=?,score_b=?,finished_at=? WHERE match_id=?").run(result.scoreA,result.scoreB,result.finishedAt,f.id);
 assert.equal((await sweepRanked(f.db)).checked,1);
 assert.equal(f.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('a').rating,975);
 assert.equal(f.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('b').rating,1025);
 assert.equal((await sweepRanked(f.db)).selected,0);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,1);
});
test('V26.0c worker is scheduled-only and refuses missing or production scope',async()=>{
 const worker=(await import('../server/ranked-sweeper-worker.mjs')).default;
 assert.equal((await worker.fetch()).status,404);
 await assert.rejects(worker.scheduled({},{}),/PREVIEW_SWEEPER_NOT_CONFIGURED/);
 await assert.rejects(worker.scheduled({},{RANKED_SWEEPER_ENABLED:'true',RANKED_SWEEPER_SCOPE:'production',RANKED_PREVIEW_DB:{}}),/PREVIEW_SWEEPER_NOT_CONFIGURED/);
 await assert.rejects(worker.scheduled({},{RANKED_SWEEPER_ENABLED:'true',RANKED_SWEEPER_SCOPE:'preview',RANKED_DB:{}}),/PREVIEW_SWEEPER_NOT_CONFIGURED/);
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'workers','ranked-preview-sweeper','wrangler.example.json'),'utf8'));
 assert.equal(cfg.workers_dev,false);assert.equal(cfg.preview_urls,false);assert.deepEqual(cfg.triggers.crons,['* * * * *']);
 assert.equal(cfg.d1_databases[0].database_name,'ortak-oyuncu-ranked-preview');
 assert.equal(cfg.d1_databases[0].database_id,'REPLACE_WITH_PREVIEW_DATABASE_ID');
});

test('V26.1a production sweeper rejects preview scope, mixed bindings and HTTP access',async()=>{
 const worker=(await import('../server/ranked-production-sweeper-worker.mjs')).default;
 assert.equal((await worker.fetch()).status,404);
 const base={RANKED_SWEEPER_ENABLED:'true',RANKED_SWEEPER_SCOPE:'production'};
 for(const env of [{},{...base,RANKED_SWEEPER_SCOPE:'preview',RANKED_PRODUCTION_DB:{}},{...base,RANKED_PREVIEW_DB:{}},{...base,RANKED_PREVIEW_DB:{},RANKED_PRODUCTION_DB:{}},{...base,RANKED_SWEEPER_ENABLED:'false',RANKED_PRODUCTION_DB:{}}]){
  await assert.rejects(worker.scheduled({},env),/PRODUCTION_SWEEPER_NOT_CONFIGURED/);
 }
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'workers','ranked-production-sweeper','wrangler.example.json'),'utf8'));
 assert.equal(cfg.name,'ortak-oyuncu-ranked-production-sweeper');
 assert.equal(cfg.workers_dev,false);assert.equal(cfg.preview_urls,false);
 assert.equal(cfg.observability.enabled,true);assert.deepEqual(cfg.triggers.crons,['* * * * *']);
 assert.equal(cfg.vars.RANKED_SWEEPER_SCOPE,'production');
 assert.deepEqual(cfg.d1_databases,[{binding:'RANKED_PRODUCTION_DB',database_name:'ortak-oyuncu-ranked',database_id:'REPLACE_WITH_PRODUCTION_DATABASE_ID'}]);
});
integration('V26.1a production worker recovers only its bound database and preserves player ratings',async t=>{
 const worker=(await import('../server/ranked-production-sweeper-worker.mjs')).default;
 const prod=await recoveryFixture(t,{age:180000}),preview=await recoveryFixture(t,{age:180000});
 await worker.scheduled({},{RANKED_SWEEPER_ENABLED:'true',RANKED_SWEEPER_SCOPE:'production',RANKED_PRODUCTION_DB:prod.db});
 assert.equal(prod.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(prod.id).status,'void');
 assert.equal(preview.sql.prepare('SELECT status FROM ranked_matches WHERE match_id=?').get(preview.id).status,'active');
 assert.equal(prod.sql.prepare('SELECT count(*) AS n FROM ranked_settlements').get().n,0);
 assert.equal(prod.sql.prepare('SELECT rating FROM ranked_players WHERE uid=?').get('a').rating,1000);
});
