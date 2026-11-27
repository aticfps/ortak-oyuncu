const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const mod=import('../server/ranked-history.mjs');
const row=(sequence,before,after)=>({matchId:'m'+sequence,sequence,finishedAt:Date.UTC(2026,10,27)+sequence,settledAt:Date.UTC(2026,10,28)+sequence,score:after>before?5:after<before?0:2,opponentScore:after>before?0:after<before?5:2,outcome:after>before?'win':after<before?'loss':'draw',ratingBefore:before,ratingAfter:after});
const sample={matches:[row(3,1000,1025),row(2,1025,1000),row(1,1000,1025)],hasMore:false};
function fixture(host='test.ortak-oyuncu.pages.dev'){
 const node=()=>({dataset:{},children:[],setAttribute(k,v){this[k]=v},replaceChildren(...v){this.children=v},append(...v){this.children.push(...v)}});
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 const calls=[],pending=[];let user={uid:'a',getIdToken:async()=> 'test-token'};
 const fetch=async(url,opt)=>{calls.push({url,opt});return new Promise(resolve=>pending.push(resolve))};
 const helper=html.slice(html.indexOf('function rankedHistoryView('),html.indexOf('const rankedSides='));
 const source=html.slice(html.indexOf('const Ranked={'),html.indexOf("$('rankGo').onclick"));
 const f=new Function('$','document','firebase','location','fetch','RankedPreview','rankedPreviewHost',helper+'\nlet ME="a",screen="ranked",code=null;\n'+source+';return {Ranked,rankedHistoryView,renderRankedHistory,setUid(uid){ME=uid}}');
 const o=f($,{createElement:node},{auth:()=>({currentUser:user})},{hostname:host,protocol:'https:'},fetch,{reset(){},inProgress(){return false}},h=>/^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(h));
 const answer=(data,status=200)=>pending.shift()(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
 return {...o,$,calls,pending,answer,setUser(uid){user={uid,getIdToken:async()=> 'test-token'}}};
}
test('V25.7 history bounds results to 20 and does not expose other fields',async()=>{
 const {readRankedHistory}=await mod,rows=Array.from({length:21},(_,i)=>({...row(21-i,1000,1000),uid_a:'private',seed:99}));
 let args;const db={prepare(q){assert.match(q,/ORDER BY sequence DESC,matchId DESC LIMIT 21/);return {bind(...a){args=a;return {all:async()=>({success:true,results:rows})}}}}};
 const r=await readRankedHistory(db,'a');assert.deepEqual(args,['a','a']);assert.equal(r.matches.length,20);assert.equal(r.hasMore,true);assert.equal(r.matches[0].sequence,21);assert.equal('uid_a'in r.matches[0],false);assert.equal('seed'in r.matches[0],false);
});
test('V25.7 history invalid rows, binding and identity fail closed',async()=>{
 const {readRankedHistory}=await mod;
 await assert.rejects(readRankedHistory({},'a'),/DB_BINDING_MISSING/);
 await assert.rejects(readRankedHistory({},''),/INVALID_UID/);
 for(const rows of [[{...row(1,1000,1025),outcome:'loss'}],[row(1,1000,1025),row(1,1000,1025)],[{...row(1,1000,1025),settledAt:1}]]){
  const db={prepare:()=>({bind:()=>({all:async()=>({success:true,results:rows})})})};
  await assert.rejects(readRankedHistory(db,'a'),/HISTORY_RESPONSE_INVALID/);
 }
});
test('V25.7 graph is chronological in ledger sequence and retains actual starting ELO',()=>{
 const f=fixture();const v=f.rankedHistoryView(sample);assert.deepEqual(v.values,[1000,1025,1000,1025]);assert.equal(v.low,1000);assert.equal(v.high,1025);assert.match(v.path,/^M42.00 110.00 L/);
 f.renderRankedHistory(sample);assert.equal(f.$('rkHistoryData').hidden,false);assert.equal(f.$('rkHistoryList').children.length,3);assert.equal(f.$('rkHistoryList').children[0].dataset.outcome,'win');
 assert.match(f.rankedHistoryView({matches:[row(1,1000,1000)],hasMore:false}).path,/^M42.00 60.00 L314.00 60.00$/);
});
test('V25.7 empty, corrupt and unavailable history clears previous chart and matches',()=>{
 const f=fixture();f.renderRankedHistory(sample);f.renderRankedHistory({matches:[],hasMore:false});assert.equal(f.$('rkHistoryList').children.length,0);assert.equal(f.$('rkHistoryLine').d,'');assert.match(f.$('rkHistoryStatus').textContent,/Henüz/);
 assert.equal(f.rankedHistoryView({matches:[row(3,1000,1025),row(1,1000,1025)],hasMore:false}),null);
 f.renderRankedHistory(null,'error');assert.match(f.$('rkHistoryStatus').textContent,/alınamadı/);f.renderRankedHistory(null,'hidden');assert.equal(f.$('rkHistoryProfile').hidden,true);
});
test('V25.7 history fetch is authenticated, preview-only and ignores stale accounts and requests',async()=>{
 const prod=fixture('ortak-oyuncu.pages.dev');await prod.Ranked.loadHistory();assert.equal(prod.calls.length,0);assert.equal(prod.$('rkHistoryProfile').hidden,true);
 const f=fixture();const a=f.Ranked.loadHistory();await Promise.resolve();const b=f.Ranked.loadHistory();await Promise.resolve();
 assert.deepEqual(JSON.parse(f.calls[0].opt.body),{action:'history.me'});assert.equal(f.calls[0].opt.headers.Authorization,'Bearer test-token');
 const first=f.pending.shift();f.answer(sample);await b;first(new Response(JSON.stringify({matches:[],hasMore:false}),{headers:{'content-type':'application/json'}}));await a;assert.equal(f.$('rkHistoryList').children.length,3);
 const c=f.Ranked.loadHistory();await Promise.resolve();f.setUid('b');f.setUser('b');f.answer(sample);await c;assert.equal(f.$('rkHistoryData').hidden,true);
});
