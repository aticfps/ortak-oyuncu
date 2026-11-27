const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const lobby=html.slice(html.indexOf('<section class="screen on" id="lobby">'),html.indexOf('<section class="screen" id="wait">'));
test('V27.1a clubhouse keeps original authenticated controls and their unique IDs',()=>{
 for(const id of ['who','whoName','pfGo','friendsGo','flGo','gOut','admGo','rankGo','myName','createPass','generatePass','create','joinF','code','joinB','joinPassWrap','joinPass','watchB','botL','botGo','dGo','instC','seasonC','comD','howB']){
  assert.equal((lobby.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(lobby,/id="who" hidden/);assert.match(lobby,/id="cards" hidden/);
 assert.match(html,/\$\('oo27Home'\)\.onclick=\(\)=>window\.scrollTo\(0,0\)/);
});
test('V27.1a football theme and bottom navigation are lobby scoped and mobile aware',()=>{
 assert.match(lobby,/<nav class="oo27-nav" aria-label="Ana menü">/);
 assert.match(html,/body:has\(#lobby\.on\)/);
 assert.match(html,/#lobby \.oo27-nav\{position:fixed/);
 assert.match(html,/env\(safe-area-inset-bottom\)/);
 assert.match(html,/html\[data-theme="light"\] #lobby \.oo27-nav/);
 assert.match(html,/#lobby \.cards\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(html,/#lobby \.whoami\[hidden\],#lobby #cards\[hidden\]\{display:none!important\}/);
});
