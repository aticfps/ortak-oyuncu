const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const lobby=html.slice(html.indexOf('<section class="screen on" id="lobby">'),html.indexOf('<section class="screen" id="wait">'));
test('V27.1b brand is consistent in app and manifest without changing installed scope',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
 assert.equal(m.name,'Çapraz90');assert.equal(m.short_name,'Çapraz90');assert.equal(m.start_url,'./');assert.equal(m.scope,'./');
 assert.match(html,/<title>Çapraz90<\/title>/);
 assert.match(lobby,/<h1>ÇAPRAZ<span>90<\/span><\/h1>/);
 assert.ok(m.icons.some(x=>x.src==='capraz90.svg'));
 assert.ok(fs.existsSync(path.join(root,'capraz90.svg')));
});
test('V27.1b arena retains every existing core lobby input, action and hidden account state',()=>{
 for(const id of ['who','whoName','pfGo','friendsGo','flGo','gOut','admGo','rankGo','myName','createPass','generatePass','create','joinF','code','joinB','joinPassWrap','joinPass','watchB','botL','botGo','dGo','instC','seasonC','comD','howB','c90Home']){
  assert.equal((lobby.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(lobby,/id="who" hidden/);assert.match(lobby,/id="cards" hidden/);assert.match(lobby,/<details class="c90-private">/);
 assert.match(html,/\$\('create'\)\.onclick=\(\)=>\{audio\(\);saveName\(\);return createRoom\(\$\('createPass'\)\.value\)\}/);
 assert.match(html,/#lobby \.c90-nav\{position:fixed/);
 assert.match(html,/env\(safe-area-inset-bottom\)/);
 assert.match(html,/html\[data-theme="light"\] #lobby/);
});
