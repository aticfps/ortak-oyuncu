const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('function friendRankRows('),html.indexOf('const FriendRanks='));
const {friendRankRows}=new Function('const validFriendId=u=>typeof u==="string"&&/^[A-Za-z0-9_-]{20,128}$/.test(u),clean=s=>String(s||"Oyuncu").trim().slice(0,16),statCount=x=>Number.isSafeInteger(+x)&&+x>=0?+x:0;'+src+';return {friendRankRows}')();
const a='A'.repeat(28),b='B'.repeat(28),c='C'.repeat(28),d='D'.repeat(28),e='E'.repeat(28),w='2026-11-23',m='2026-11';
const roster=[{peer:a,name:'Alpha'},{peer:b,name:'Beta',state:'accepted'},{peer:c,name:'Ceta',state:'accepted'},{peer:d,name:'Delta',state:'pending'},{peer:b,name:'Beta',state:'accepted'},{peer:'bad',state:'accepted'}];
test('V24.5 only self and accepted friends are ranked, ignoring unrelated stats and duplicates',()=>{
 const rows=friendRankRows(a,roster,{[a]:{g:3,w:1,p:40,c:7},[b]:{g:4,w:2,p:50,c:10},[c]:null,[d]:{g:100,w:99,p:9999},[e]:{g:100,w:99,p:9999}},'a',w,m);
 assert.deepEqual(rows.map(x=>x.uid),[b,a,c]);assert.deepEqual(rows.map(x=>x.rank),[1,2,null]);assert.equal(rows[0].rate,50);assert.equal(rows[0].correct,10);assert.equal(rows[2].p,0);
});
test('V24.5 week and month only use matching stored period; historic counts do not leak',()=>{
 const s={[a]:{g:40,w:15,p:500,c:70,wk:{k:w,g:2,w:1,p:9},mo:{k:'2026-10',g:12,w:4,p:99}},[b]:{g:20,w:15,p:200,c:60,wk:{k:'2026-11-16',g:9,w:5,p:88},mo:{k:m,g:5,w:2,p:30}},[c]:null};
 let r=friendRankRows(a,roster,s,'w',w,m);assert.equal(r[0].uid,a);assert.equal(r[0].p,9);assert.equal(r[0].correct,null);assert.equal(r.find(x=>x.uid===b).rank,null);
 r=friendRankRows(a,roster,s,'m',w,m);assert.equal(r[0].uid,b);assert.equal(r[0].p,30);assert.equal(r[0].rate,40);assert.equal(r.find(x=>x.uid===a).g,0);
});
test('V24.5 points first, then wins, equal results share competition ranks',()=>{
 const r=friendRankRows(a,[...roster,{peer:e,state:'accepted',name:'Echo'}],{[a]:{g:2,w:1,p:20},[b]:{g:3,w:2,p:20},[c]:{g:4,w:2,p:20},[e]:{g:1,w:1,p:10}},'a',w,m);
 assert.deepEqual(r.map(x=>x.uid),[b,c,a,e]);assert.deepEqual(r.map(x=>x.rank),[1,1,3,4]);
});
test('V24.5 unavailable reads never become invented zeroes or ranked players; no games remain unranked',()=>{
 const r=friendRankRows(a,roster,{[a]:{g:2,w:999,p:15},[b]:undefined,[c]:null},'a',w,m);
 assert.equal(r[0].rate,100);assert.equal(r[1].uid,c);assert.equal(r[1].rank,null);assert.equal(r[2].uid,b);assert.equal(r[2].known,false);assert.equal(r[2].p,null);assert.equal(r[2].rank,null);
});
test('V24.5 screen uses existing read-only data, bounded concurrency, account checks and responsive layout',()=>{
 const code=html.slice(html.indexOf('const FriendRanks='),html.indexOf('/* V24.3: short-lived'));
 for(const x of ["friendApi(Net.db,uid).list()).friends","Net.db.ref('stats/'+x.peer).once('value')","i+=12","ME!==uid||epoch!==this.epoch","esc(r.name)","fl-pod","flOverview","flRefresh","period==='a'","r.uid===this.uid"])assert.ok(code.includes(x),x);
 assert.equal(/\.set\(|\.update\(|\.transaction\(/.test(code),false);
 for(const x of ['id="friendRanks"','id="flGo"','id="flFromFriends"','id="flBack"','FriendRanks.reset()','@media(max-width:600px){.fl-title','aria-pressed'])assert.ok(html.includes(x),x);
});
