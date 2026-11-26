const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8'));
const defs=html.split(/\r?\n/).filter(l=>/^(const (MAXP|roomModeAllowed|nextFreeColor|validHost|parsePresence|COLORS)=)/.test(l));
const {MAXP,roomModeAllowed,nextFreeColor,validHost,parsePresence,COLORS}=new Function(defs.join('\n')+';return {MAXP,roomModeAllowed,nextFreeColor,validHost,parsePresence,COLORS}')();
test('V23.1 supports 2-8 free-for-all players and preserves 2v2 and legacy tournament limits',()=>{
  assert.equal(MAXP,8);for(const m of ['c','q','k'])for(let n=0;n<=9;n++)assert.equal(roomModeAllowed(m,n),n>=2&&n<=8);
  for(let n=0;n<=9;n++){assert.equal(roomModeAllowed('t',n),n===4);assert.equal(roomModeAllowed('tr',n),n>=2&&n<=4)}
  assert.equal(roomModeAllowed('unknown',4),false);assert.equal(roomModeAllowed('c',2.5),false);
});
test('V23.1 eight distinct player colors and freed slot reuse',()=>{
  const p=[];for(let i=0;i<8;i++){assert.equal(nextFreeColor(p),i);p.push({c:i})}
  assert.equal(nextFreeColor(p),undefined);p.splice(5,1);assert.equal(nextFreeColor(p),5);assert.equal(new Set(COLORS).size,8);
});
test('V23.1 guest accepts eight unique host players but rejects nine or duplicate identities',()=>{
  const p=Array.from({length:8},(_,i)=>({u:'u'+i})),node={uid:'u0',pr:{h:1,g:{host:'u0',ph:'wait',pl:p}}};
  assert.equal(validHost(node),true);p.push({u:'u8'});assert.equal(validHost(node),false);p.pop();p[7]={u:'u0'};assert.equal(validHost(node),false);
});
test('V23.1 room payload accepts larger valid records with unchanged UID ownership rules',()=>{
  const sample=JSON.stringify({g:{pl:Array.from({length:8},(_,i)=>({u:'u'+i,ph:'x'.repeat(300),at:Array.from({length:6},()=>({t:'x'.repeat(30),unk:1}))})),hist:Array.from({length:10},()=>({h:'x'.repeat(40),t:Array(8).fill('x'.repeat(54))}))}});
  assert.ok(sample.length>6000&&sample.length<24000);assert.equal(parsePresence(sample).g.pl.length,8);
  assert.equal(parsePresence(JSON.stringify({x:'x'.repeat(24000)})),null);
  const r=rules.rules.rooms.$code.$peer;assert.equal(r['.write'],'auth != null && auth.uid === $peer');assert.match(r['.validate'],/length < 24000/);
});
test('V23.1 host admission and bots enforce capacity and start validates selected mode',()=>{
  assert.ok(html.includes('if(idle&&G.pl.length<MAXP)'));assert.ok(html.includes('if(G.pl.length>=MAXP||n.uid===ME'));assert.match(html,/function addBot\(l\)\{if\(!isHost\|\|!G\|\|G.pl.length>=MAXP/);
  assert.ok(html.includes("if(!roomModeAllowed(G.md,G.pl.length))"));assert.ok(html.includes("$('start').disabled=!roomModeAllowed(md,n)"));assert.ok(html.includes('for(let k=n;k<MAXP;k++)slots.push'));
});
test('V23.1 compact scoreboard and rival list retain mobile support',()=>{
  const css=html.slice(html.indexOf('/* V23.1:'),html.indexOf('</style>'));
  assert.ok(css.includes('.chips:has(.chip:nth-child(5))'));assert.ok(css.includes('repeat(4,minmax(0,1fr))'));assert.ok(css.includes('@media(max-width:720px)'));assert.ok(css.includes('#ans .opps:has(.opp:nth-child(4))'));
});
