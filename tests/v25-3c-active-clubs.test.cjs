const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('const TEAMS={'),end=html.indexOf('const STY=',start);
const pool=new Function(html.slice(start,end)+';return {TEAMS,PLAYERS,LEAGUES,ACTIVE_LEAGUES,ARCHIVE_IDS,IDS,activeClub,shared,ptsOf}')();
const {IDS,activeClub,shared,ptsOf}=pool;
const def=(name)=>{const line=html.split(/\r?\n/).find(s=>s.startsWith('function '+name+'('));assert.ok(line,name);return line};
test('V25.3c exactly five selected clubs per original league and archive remains intact',async()=>{
 assert.equal(IDS.length,30);assert.equal(new Set(IDS).size,30);
 assert.equal(pool.ACTIVE_LEAGUES.length,6);
 for(let i=0;i<6;i++){const ids=pool.ACTIVE_LEAGUES[i].split(' ');assert.equal(ids.length,5);for(const id of ids)assert.ok(pool.LEAGUES[i][1].split(' ').includes(id));}
 assert.equal(pool.ARCHIVE_IDS.length,114);assert.equal(pool.PLAYERS.length,1906);
 assert.ok(shared('ERZ','RIZ').length>0);
 const {ACTIVE_CLUBS}=await import('../server/ranked-game.mjs');assert.deepEqual(ACTIVE_CLUBS,IDS);
});
test('V25.3c all league selectors return active clubs only',()=>{
 const get=new Function('IDS','ACTIVE_LEAGUES','activeClub','G',def('leagueIds')+';return leagueIds()');
 for(const [lg,n] of [['a',30],['e',25],...Array.from({length:6},(_,i)=>[String(i),5])]){
  const ids=get(IDS,pool.ACTIVE_LEAGUES,activeClub,{lg});assert.equal(ids.length,n);assert.ok(ids.every(activeClub));
 }
});
test('V25.3c normal nine-card generation and fallback stay in active pool',()=>{
 const a=html.indexOf('function nine()'),b=html.indexOf('function setPickers()',a);
 const nine=new Function('IDS','activeClub','leagueIds','pairOK','starOf',html.slice(a,b)+';return nine');
 for(const seed of pool.ACTIVE_LEAGUES){
  const fn=nine(IDS,activeClub,()=>seed.split(' '),(a,b)=>a!==b&&shared(a,b).length>0,()=>1);
  const ids=fn();assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);assert.ok(ids.every(activeClub));
 }
 const fallback=nine(IDS,activeClub,()=>IDS,()=>false,()=>1)();
 assert.equal(fallback.length,9);assert.ok(fallback.every(activeClub));
});
test('V25.3c derby and career choices use active clubs without rewriting histories',()=>{
 assert.ok(html.includes('DERBY.filter(([x,y])=>activeClub(x)&&activeClub(y)&&pairOK(x,y))'));
 const kPick=new Function('careerPool','PLAYERS','G','activeClub',def('kPick')+';return kPick');
 const a={n:'valid',k:['GS','FB','BJK']},b={n:'archived',k:['GS','ERZ','FB']};
 const choose=kPick(p=>p,[a,b],{used:[],th:''},activeClub);
 assert.equal(choose(),a);assert.deepEqual(b.k,['GS','ERZ','FB']);
 assert.ok(pool.PLAYERS.filter(p=>p.k?.length>=3&&p.k.every(activeClub)).length>=5);
});
test('V25.3c daily retains original date and selects five active pairs from next date',()=>{
 const a=html.indexOf('const Daily='),b=html.indexOf('function verCheck',a);
 const daily=new Function('IDS','ARCHIVE_IDS','shared','ptsOf',html.slice(a,b)+';return Daily')(IDS,pool.ARCHIVE_IDS,shared,ptsOf);
 daily.day=()=> '2026-11-27';const old=daily.pairs();
 assert.equal(old.length,5);assert.equal(daily.poolDay,'2026-11-27');
 for(let i=28;i<=30;i++){daily.day=()=> '2026-11-'+i;const p=daily.pairs();assert.equal(p.length,5);assert.equal(new Set(p.flat()).size,10);assert.ok(p.flat().every(activeClub));}
});
test('V25.3c default ranked motor picks only active clubs across deterministic seeds',async()=>{
 const {createRankedGame}=await import('../server/ranked-game.mjs');
 for(let seed=0;seed<32;seed++){let now=1000;const g=createRankedGame({matchId:'m'+seed,uidA:'a',uidB:'b'},{clock:()=>now,choose:n=>seed%n});
  for(let round=0;round<5;round++){const s=g.snapshot();assert.ok(s.current.clubs.every(activeClub));now+=20000;g.tick();}
  assert.equal(g.snapshot().status,'completed');
 }
});
