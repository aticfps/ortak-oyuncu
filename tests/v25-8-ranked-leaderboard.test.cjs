const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const mod=import('../server/ranked-leaderboard.mjs');
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch{}
test('V25.8 real leaderboard excludes unplayed, ties share ranks, self outside top 20 is returned',{skip:!DatabaseSync?'Node 22.13+ required':false},async t=>{
 const {readRankedLeaderboard}=await mod;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(fs.readFileSync(path.join(__dirname,'..','server','ranked-schema.sql'),'utf8'));
 const add=sql.prepare('INSERT INTO ranked_players(uid,rating,played,wins,draws,losses,created_at) VALUES (?,?,?,?,?,?,1)');
 for(let i=0;i<23;i++)add.run('player'+i,2000-Math.max(0,i-1)*25,1,1,0,0);
 add.run('unplayed',9999,0,0,0,0);
 const db={prepare(q){return {bind(...args){return {all:async()=>({success:true,results:sql.prepare(q).all(...args)})}}}}};
 const r=await readRankedLeaderboard(db,'player22');assert.equal(r.total,23);assert.equal(r.rows.length,20);assert.deepEqual(r.rows.slice(0,3).map(x=>x.position),[1,1,3]);assert.equal(r.self.position,23);assert.equal(r.self.isSelf,true);assert.ok(r.rows.every(x=>!x.isSelf));assert.equal((await readRankedLeaderboard(db,'unplayed')).self,null);
 assert.equal((await readRankedLeaderboard(db,'player22')).self.name,r.self.name);
});
test('V25.8 invalid binding, identity and malformed rank fail closed',async()=>{
 const {readRankedLeaderboard}=await mod;
 await assert.rejects(readRankedLeaderboard({},'a'),/DB_BINDING_MISSING/);await assert.rejects(readRankedLeaderboard({},''),/INVALID_UID/);
 const db={prepare:()=>({bind:()=>({all:async()=>({success:true,results:[{uid:'a',rating:1000,played:0,wins:0,position:1,total:1,own:0}]})})})};
 await assert.rejects(readRankedLeaderboard(db,'a'),/LEADERBOARD_RESPONSE_INVALID/);
});
const row=(position,rating,isSelf=false,name='Oyuncu AABBCCDDEEFF')=>({name,position,rating,played:4,wins:3,isSelf});
const own=row(2,975,true,'Oyuncu 112233445566'),sample={rows:[row(1,1025),own],self:own,total:2};
function fixture(host='test.ortak-oyuncu.pages.dev'){
 const node=()=>({dataset:{},children:[],replaceChildren(...v){this.children=v},append(...v){this.children.push(...v)}});
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 const calls=[],pending=[];let user={uid:'a',getIdToken:async()=> 'test-token'};
 const fetch=async(url,opt)=>{calls.push({url,opt});return new Promise(resolve=>pending.push(resolve))};
 const helper=html.slice(html.indexOf('const RANK_LEVEL_MIN='),html.indexOf('const rankedSides='));
 const source=html.slice(html.indexOf('const Ranked={'),html.indexOf("$('rankGo').onclick"));
 const f=new Function('$','document','firebase','location','fetch','RankedPreview','rankedPreviewHost',helper+'\nlet ME="a",screen="ranked",code=null;\n'+source+';return {Ranked,rankedBoardView,renderRankedBoard,setUid(uid){ME=uid}}');
 const o=f($,{createElement:node},{auth:()=>({currentUser:user})},{hostname:host,protocol:'https:'},fetch,{reset(){},inProgress(){return false}},h=>/^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(h));
 const answer=(data,status=200)=>pending.shift()(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
 return {...o,$,calls,pending,answer,setUser(uid){user={uid,getIdToken:async()=> 'test-token'}}};
}
test('V25.8 leaderboard shows self rank and level, shared ranks and clears stale data',()=>{
 const f=fixture();f.renderRankedBoard(sample);assert.match(f.$('rkBoardSelf').textContent,/#2 · Seviye 3/);assert.equal(f.$('rkBoardList').children[1].dataset.self,'yes');
 const a=row(1,1025),b=row(1,1025,false,'Oyuncu 112233445566'),c=row(3,1000,false,'Oyuncu 998877665544');
 assert.ok(f.rankedBoardView({rows:[a,b,c],self:null,total:3}));assert.equal(f.rankedBoardView({rows:[a,{...b,position:2},c],self:null,total:3}),null);
 f.renderRankedBoard({rows:[],self:null,total:0});assert.equal(f.$('rkBoardList').children.length,0);assert.match(f.$('rkBoardStatus').textContent,/Henüz/);
 f.renderRankedBoard(null,'error');assert.equal(f.$('rkBoardData').hidden,true);f.renderRankedBoard(null,'hidden');assert.equal(f.$('rkBoard').hidden,true);
});
test('V25.8 private board fetch ignores stale responses and production hosts',async()=>{
 const prod=fixture('ortak-oyuncu.pages.dev');await prod.Ranked.loadBoard();assert.equal(prod.calls.length,0);assert.equal(prod.$('rkBoard').hidden,true);
 const f=fixture();const a=f.Ranked.loadBoard();await Promise.resolve();const b=f.Ranked.loadBoard();await Promise.resolve();
 assert.equal(f.calls[0].opt.headers.Authorization,'Bearer test-token');assert.deepEqual(JSON.parse(f.calls[0].opt.body),{action:'leaderboard.get'});
 const first=f.pending.shift();f.answer(sample);await b;first(new Response(JSON.stringify({rows:[],self:null,total:0}),{headers:{'content-type':'application/json'}}));await a;assert.equal(f.$('rkBoardList').children.length,2);
 const c=f.Ranked.loadBoard();await Promise.resolve();f.setUid('b');f.setUser('b');f.answer(sample);await c;assert.equal(f.$('rkBoardData').hidden,true);
});
