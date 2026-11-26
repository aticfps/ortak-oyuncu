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

test('V20a additions improve seven low-coverage clubs',()=>{
  for(const [id,min] of [['KOC',3],['ERZ',3],['AMD',2],['COR',3],['EYP',6],['RIZ',9],['GNC',9]])assert.ok(PLAYERS.filter(p=>p.c.includes(id)&&p.c.length>1).length>=min,id);
  for(const [name,a,b] of [['Oğulcan Çağlayan','KOC','GS'],['Ahmet Oğuz','KOC','KON'],['Mame Thiam','EYP','FB'],['Mustafa Yumlu','ERZ','TS'],['Orhan Ovacıklı','ERZ','RIZ'],['Kerem Kalafat','COR','BJK'],['Ahmet İlhan Özek','COR','GNC'],['Max Gradel','AMD','GFK'],['Gökhan Gönül','GNC','RIZ'],['Caner Erkin','EYP','FB']])assert.ok(shared(a,b).some(p=>p.n===name),name);
});
test('corrected career returns include PSG and Atletico',()=>{
  assert.deepEqual(player('Nicolas Anelka').k,['PSG','ARS','RMA','PSG','LIV','MCI','FB','CHE','JUV']);
  assert.deepEqual(player('Fernando Torres').k,['ATM','LIV','CHE','MIL','ATM']);
});
test('career pool never substitutes unordered memberships and honors theme and used list',()=>{
  const def=html.split(/\r?\n/).find(l=>l.startsWith('const careerPool='));
  const pool=new Function('has','isTurk','STAR',def+';return careerPool')(id=>Object.hasOwn(TEAMS,id),n=>n==='Turk',new Set(['Legend']));
  const players=[{n:'Turk',k:['GS','FB','BJK']},{n:'Legend',k:['GS','FB','BJK']},{n:'Unordered',c:['GS','FB','BJK']},{n:'Invalid',k:['GS','FB','BAD']}];
  assert.deepEqual(pool(players,[],'').map(p=>p.n),['Turk','Legend']);
  assert.deepEqual(pool(players,[],'t').map(p=>p.n),['Turk']);
  assert.deepEqual(pool(players,[],'e').map(p=>p.n),['Legend']);
  assert.deepEqual(pool(players,['Turk','Legend'],'').map(p=>p.n),[]);
});
