const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const statsCode=part('function earnBadges','function badgeRow')+part('const statCount=','const Season=');
const api=new Function('const clip=(s,n)=>String(s).slice(0,n),has=id=>["GS","FB","BJK"].includes(id),isBot=u=>String(u).startsWith("bot-");'+statsCode+';return {statMatchUpdate,statCount}')();
const fixture=()=>({gid:2,st:100,ph:'end',md:'c',pl:[{u:'guest',s:7},{u:'host',s:2}],hist:[{w:'guest',p:4,a:'GS',b:'FB',h:'Example Player'},{w:'guest',p:1,a:'FB',b:'BJK',h:'Example Player'},{w:'guest',p:2,a:'GS',b:'BJK',h:'Example Player'}]});
const write=(s,g=fixture(),k='ABCD:2:100',ts=1000)=>api.statMatchUpdate(s,g,'guest',k,'Guest','2026-11-23','2026-11',ts);
test('one finished match increments all statistics atomically and preserves profile fields',()=>{
  const old={g:4,w:1,p:20,fm:'gold',d:{k:'today'},b:{previous:1},fr:{old:1}},g=fixture();
  const result=write(old,g);
  assert.equal(result.g,5);assert.equal(result.w,2);assert.equal(result.p,27);assert.equal(result.c,3);assert.equal(result.rp,3);assert.equal(result.bs,3);assert.equal(result.b.temiz,1);
  assert.equal(result.b.previous,1);assert.equal(result.fm,'gold');assert.deepEqual(result.d,{k:'today'});assert.equal(result.fr.old,1);assert.equal(result.fr.host,1);assert.equal(result.wk.p,7);assert.equal(result.mo.p,7);
  assert.equal(old.g,4);assert.equal(g.pl[0].s,7);
});
test('transaction retries do not double count a match even after another match',()=>{
  const a=write(null),b=write(a,fixture(),'ABCD:3:200',2000);
  assert.equal(write(a),undefined);assert.equal(write(b),undefined);assert.equal(b.g,2);assert.equal(b.p,14);
  const legacy={g:2,lk:'ABCD:1:50',t:500};assert.equal(write(legacy,fixture(),'ABCD:1:50'),undefined);
  const next=write(legacy);assert.equal(write(next,fixture(),'ABCD:1:50'),undefined);
});
test('match ledger is bounded and always retains the newly recorded key',()=>{
  const matchLog=Object.fromEntries(Array.from({length:130},(_,i)=>['ABCD:1:'+i,2000+i]));
  const next=write({matchLog},fixture(),'ABCD:2:100',1000);
  assert.equal(Object.keys(next.matchLog).length,128);assert.equal(next.matchLog['ABCD:2:100'],1000);assert.equal(write(next),undefined);
});
test('bot, unfinished and spectator matches are not added to season statistics',()=>{
  const bot=fixture();bot.pl[1].u='bot-a';assert.equal(write(null,bot),undefined);
  const unfinished=fixture();unfinished.ph='ans';assert.equal(write(null,unfinished),undefined);
  const spectator=fixture();spectator.pl[0].u='other';assert.equal(write(null,spectator),undefined);
});
test('team win and tournament champion use the completed match snapshot',()=>{
  const team=fixture();team.md='t';team.tm={guest:0,host:1,ally:0};team.pl.push({u:'ally',s:10});team.pl[1].s=12;assert.equal(write(null,team).w,1);
  const tr=fixture();tr.md='tr';tr.ch='host';assert.equal(write(null,tr).w,0);
});
test('new week and month preserve prior period totals',()=>{
  const old={g:2,wk:{k:'2026-11-16',g:2,w:1,p:9},mo:{k:'2026-10',g:2,w:1,p:9}};
  const next=write(old);assert.deepEqual(next.lw,old.wk);assert.deepEqual(next.lm,old.mo);assert.equal(next.wk.g,1);assert.equal(next.mo.g,1);
});
const clock=new Function(part('const pausedTime=','const snapshotFresh=')+';return {pausedTime,shiftGameClock}')();
test('disconnected clock freezes at earliest pause and resumes with remaining answer time',()=>{
  assert.equal(clock.pausedTime(5000,1000,2000,0),1000);assert.equal(clock.pausedTime(5000,0,NaN),5000);
  const game={ph:'ans',end:10000,rvEnd:777,pl:[{lk:6000,off:3000},{lk:2000,off:0}]};
  assert.equal(clock.shiftGameClock(game,4000,9000),5000);assert.equal(game.end,15000);assert.equal(game.end-9000,6000);assert.equal(game.rvEnd,777);assert.equal(game.pl[0].lk,11000);assert.equal(game.pl[0].off,8000);assert.equal(game.pl[1].lk,2000);
});
test('reveal deadline is shifted without altering answer deadline and negative delta is ignored',()=>{
  const game={ph:'rev',rvEnd:6000,end:9999,pl:[]};clock.shiftGameClock(game,4000,8000);assert.equal(game.rvEnd,10000);assert.equal(game.end,9999);assert.equal(clock.shiftGameClock(game,8000,7000),0);
});
test('host tick pauses all gameplay and publishes shifted state before processing commands',()=>{
  const hostTick=part('function hostTick(){','setInterval(hostTick,500)');
  const run=new Function('let tNow=4000,hostPauseAt=0,localAway=0,hostAway=0,isHost=true;const now=()=>tNow,Net={conn:false},G={ph:"ans",end:10000,pl:[{lk:6000}]},BT={pk:{a:4500},an:{b:5500,c:-1}},events=[],banner=t=>events.push(t),publish=()=>events.push("published");'+part('const pausedTime=','const snapshotFresh=')+hostTick+';return {hostTick,G,Net,BT,setTime:t=>tNow=t,events,getPause:()=>hostPauseAt}')();
  run.hostTick();assert.equal(run.getPause(),4000);run.setTime(9000);run.Net.conn=true;run.hostTick();
  assert.equal(run.getPause(),0);assert.equal(run.G.end,15000);assert.equal(run.BT.pk.a,9500);assert.equal(run.BT.an.b,10500);assert.equal(run.BT.an.c,-1);assert.equal(run.events.at(-1),'published');
});
