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
 for(const f of ['ranked-schema.sql','ranked-settlement-schema.sql','ranked-session-schema.sql','ranked-matchmaking-schema.sql','ranked-acceptance-schema.sql'])sql.exec(fs.readFileSync(path.join(root,'server',f),'utf8'));
 for(const uid of ['a','b','c'])sql.prepare('INSERT INTO ranked_players(uid,created_at) VALUES (?,1)').run(uid);
 const db={prepare(q){return {bind(...args){return {
  async first(){return sql.prepare(q).get(...args)||null;},
  async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
 };}};}};
 const env={...flags,RANKED_PREVIEW_UIDS:'a,b,c',RANKED_DB:db};
 async function call(uid,action,fields={}){const r=await rankedPreviewPlay(req({action,...fields},uid),env,verify);return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}
 async function offer(){await call('a','queue.join');await call('b','queue.join');const r=await call('a','queue.find');assert.equal(r.status,200);assert.equal(r.body.status,'reserved');assert.equal('opponentUid'in r.body,false);return r.body.matchId}
 async function start(){const matchId=await offer();await call('a','offer.respond',{matchId,decision:'accept'});await call('b','offer.respond',{matchId,decision:'accept'});const r=await call('a','offer.start',{matchId});assert.equal(r.status,200);return {matchId,r}}
 return {sql,call,offer,start};
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
