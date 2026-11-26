// Run: node --test tests/*.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const from=html.indexOf('const TEAMS='),to=html.indexOf('const STY=',from);
const {TEAMS,PLAYERS,norm,shared}=new Function(html.slice(from,to)+';return {TEAMS,PLAYERS,norm,shared}')();
const player=n=>PLAYERS.find(p=>p.n===n);
test('all 114 clubs have at least one cross-club player',()=>{
  assert.equal(Object.keys(TEAMS).length,114);
  for(const id of Object.keys(TEAMS))assert.ok(PLAYERS.some(p=>p.c.includes(id)&&p.c.length>1),id);
});
test('player keys are unique, club IDs valid and memberships deduplicated',()=>{
  assert.equal(new Set(PLAYERS.map(p=>norm(p.n))).size,PLAYERS.length);
  for(const p of PLAYERS){assert.ok(p.keys.includes(norm(p.n)),p.n);assert.equal(new Set(p.c).size,p.c.length,p.n);for(const id of p.c)assert.ok(Object.hasOwn(TEAMS,id),id);}
});
test('four new verified club connections resolve as shared answers',()=>{
  for(const [name,a,b] of [['Serdar Topraktepe','KOC','BJK'],['Emrah Başsan','ERZ','RIZ'],['Ömer Bayram','AMD','GS'],['Murat Yıldırım','COR','SAM']])assert.ok(shared(a,b).some(p=>p.n===name),name);
});
test('career chains preserve return spells without duplicating memberships',()=>{
  assert.deepEqual(player('Arda Turan').k,['GS','ATM','BAR','IBF','GS']);
  assert.deepEqual(player('Zlatan Ibrahimović').k,['JUV','INT','BAR','MIL','PSG','MUN','MIL']);
  assert.deepEqual(player('Antoine Griezmann').k,['RSO','ATM','BAR','ATM']);
  for(const p of PLAYERS.filter(p=>p.k))for(const c of p.k)assert.ok(p.c.includes(c),p.n);
});
