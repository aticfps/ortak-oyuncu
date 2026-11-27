const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('const TEAMS='),end=html.indexOf('const STY=',start);
const d=new Function(html.slice(start,end)+';return {PLAYERS,IDS,ARCHIVE_IDS,shared,match,norm,ptsOf}')();
const verify=(a,b,q,n)=>assert.equal(d.match(q,d.shared(a,b))?.n,n,[a,b,q].join(' / '));
test('V25.4c1 Trabzonspor Liverpool accepts five senior players including Salah and Fabinho',()=>{
 for(const [q,n] of [['Salah','Mohamed Salah'],['Fabinho','Fabinho'],['Sturridge','Daniel Sturridge'],['Markovic','Lazar Marković'],['Rigobert Song','Rigobert Song']])verify('TS','LIV',q,n);
 assert.equal(d.shared('TS','LIV').length,5);
 assert.equal(d.match('Lionel Messi',d.shared('TS','LIV')),null);
});
test('V25.4c1 historical footballers and plain keyboard aliases are recognized',()=>{
 for(const [a,b,q,n] of [['FB','BAR','Rustu','Rüştü Reçber'],['BAY','INT','Matthaus','Lothar Matthäus'],['BAY','INT','Rummenigge','Karl-Heinz Rummenigge'],['BAY','INT','Brehme','Andreas Brehme'],['BAY','LIV','Hamann','Dietmar Hamann'],['BVB','JUV','Kohler','Jürgen Kohler'],['BVB','JUV','Moller','Andreas Möller'],['RMA','ROM','Panucci','Christian Panucci'],['MIL','INT','Meazza','Giuseppe Meazza']])verify(a,b,q,n);
});
test('V25.4c1 recent and missing loan club links are recognized',()=>{
 for(const [a,b,q,n] of [['ARS','BJK','Trossard','Leandro Trossard'],['ARS','BJK','Elneny','Mohamed Elneny'],['ATM','B04','Hermoso','Mario Hermoso'],['ATM','LIL','Reinildo','Reinildo'],['INT','LIL','Pavard','Benjamin Pavard'],['BJK','B04','Hilbert','Roberto Hilbert']])verify(a,b,q,n);
});
test('V26.3a thirty active clubs preserved with verified corrections',()=>{
 assert.equal(d.IDS.length,30);assert.equal(d.ARCHIVE_IDS.length,114);
 assert.equal(d.PLAYERS.length,1906);
 const counts=[];
 for(let i=0;i<d.IDS.length;i++)for(let j=i+1;j<d.IDS.length;j++)counts.push(d.shared(d.IDS[i],d.IDS[j]).length);
 assert.equal(counts.length,435);
 assert.equal(counts.reduce((a,b)=>a+b,0),1999);
 assert.equal(counts.filter(n=>n===0).length,30);
 assert.equal(counts.filter(n=>n===1).length,61);
});
test('V25.4c1 in-progress daily puzzle retains existing club pairs on rollout date',()=>{
 const a=html.indexOf('const Daily='),b=html.indexOf('function verCheck',a);
 const daily=new Function('IDS','ARCHIVE_IDS','shared','ptsOf',html.slice(a,b)+';return Daily')(d.IDS,d.ARCHIVE_IDS,d.shared,d.ptsOf);
 daily.day=()=> '2026-11-27';
 assert.deepEqual(daily.pairs(),[['FB','MUN'],['GS','NEW'],['VAL','BET'],['LAZ','GNO'],['BOL','COM']]);
});

test('V26.3a verified senior appearances count, signing without competitive appearance does not',async()=>{
 const catalog=(await import('../server/ranked-catalog.mjs')).default;
 for(const [name,club,expected] of [['Caner Erkin','INT',false],['Pierre-Emerick Aubameyang','MIL',false],['Wout Weghorst','TSG',true],['Fabinho','RMA',true],['Rigobert Song','KOE',true],['Rigobert Song','RCL',true],['Mohamed Salah','TS',true],['Fabinho','TS',true]]){
  for(const players of [d.PLAYERS,catalog.players])assert.equal(players.find(p=>p.n===name).c.includes(club),expected,name+' / '+club);
 }
 verify('RMA','LIV','Fabinho','Fabinho');
 verify('MUN','TSG','Weghorst','Wout Weghorst');
 verify('GS','RCL','Rigobert Song','Rigobert Song');
 assert.equal(d.match('Caner Erkin',d.shared('INT','GS')),null);
 assert.equal(d.match('Aubameyang',d.shared('MIL','ARS')),null);
 assert.equal(d.PLAYERS.find(p=>p.n==='Pierre-Emerick Aubameyang').k.includes('MIL'),false);
 assert.equal(d.match('Carl Medjani',d.shared('TS','LIV')),null);
});
