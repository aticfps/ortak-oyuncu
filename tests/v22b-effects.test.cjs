const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('const resultKey='),html.indexOf('/* ---------- sesler ---------- */',html.indexOf('const resultKey=')));
const make=()=>new Function('const data=new Map(),sessionStorage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};'+source+';return {resultKey,outcomeOf,Fx,data}')();
const game=()=>({gid:1,st:123,pn:2,md:'c',wu:'a',pl:[{u:'a',s:5},{u:'b',s:2}]});
test('V22.4 match outcomes distinguish players, draws, spectators, team wins and tournament champions',()=>{
  const {outcomeOf}=make(),g=game();
  assert.equal(outcomeOf(g,'a'),'win');assert.equal(outcomeOf(g,'b'),'loss');assert.equal(outcomeOf(g,'spectator'),'spectator');
  g.pl[1].s=5;assert.equal(outcomeOf(g,'b'),'draw');
  g.md='t';g.tm={a:0,b:1,c:0,d:1};g.pl.push({u:'c',s:4},{u:'d',s:0});
  assert.equal(outcomeOf(g,'c'),'win');assert.equal(outcomeOf(g,'b'),'loss');
  g.md='tr';g.ch='b';assert.equal(outcomeOf(g,'b'),'win');assert.equal(outcomeOf(g,'a'),'loss');
});
test('V22.4 effect keys distinguish room, rematch, retry, appeal and final',()=>{
  const {resultKey}=make(),g=game(),k=resultKey('ABCD',g,'round');
  for(const other of [resultKey('EFGH',g,'round'),resultKey('ABCD',{...g,st:124},'round'),resultKey('ABCD',{...g,pn:3},'round'),resultKey('ABCD',{...g,wu:null},'round'),resultKey('ABCD',g,'final')])assert.ok(k!==other);
});
test('V22.4 repeated snapshots and same result after reload do not repeat effects',()=>{
  const {Fx,data}=make();assert.equal(Fx.claim('one'),true);assert.equal(Fx.claim('one'),false);Fx.seen.clear();assert.equal(Fx.claim('one'),false);assert.equal(Fx.claim('two'),true);assert.equal(Fx.claim('two'),false);assert.equal(data.get('oo-fx-last'),'two');
});
test('V22.4 animation budget, reduced motion and cancellation are implemented',()=>{
  assert.match(source,/const N=big\?92:48,duration=big\?1650:1100/);assert.match(source,/this\.stop\(\);if\(this\.reduce\(\)\|\|document\.hidden/);assert.match(source,/cancelAnimationFrame\(this\.frame\)/);assert.match(html,/if\(screen==='res'\|\|screen==='end'\)\{Fx\.stop\(\)/);
  assert.ok(!html.includes("$('next').disabled=true;setTimeout(()=>$('next').disabled=false,2500)"));
  assert.ok(html.includes('presentRound(G);'));assert.ok(html.includes('presentFinal(G);'));
});
