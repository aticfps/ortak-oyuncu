// Run: node --test tests/v19-room-security.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const rules=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8'));
const defs=html.split(/\r?\n/).filter(l=>/^(const (parsePresence|parseRoomNodes|validHost|selectRoomHost|alive)=)/.test(l));
const api=new Function('const MAXP=8,now=()=>100000;'+defs.join('\n')+';return {parsePresence,parseRoomNodes,validHost,selectRoomHost,alive}')();
const state=(uid,t=99000,players=[{u:uid}])=>({uid,o:1,t,j:JSON.stringify({h:1,g:{host:uid,ph:'wait',pl:players}})});
test('inline scripts compile',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))if(m[1].trim())assert.doesNotThrow(()=>new Function(m[1]));});
test('V24.1 is published by the app',()=>assert.match(html,/const APPV='24.1';/));
test('room write rule binds UID to the path (static regression)',()=>{const p=rules.rules.rooms.$code.$peer;assert.equal(p['.write'],'auth != null && auth.uid === $peer');assert.match(p['.validate'],/child\('uid'\)\.val\(\) === \$peer/);});
test('bad presence JSON is rejected',()=>{for(const j of ['[]','null','not-json','1',' '.repeat(24000),null])assert.equal(api.parsePresence(j),null);assert.deepEqual(api.parsePresence('{}'),{});});
test('spoofed keys and malformed records are ignored',()=>{const out=api.parseRoomNodes({host:state('host'),imposter:state('host'),bad:{uid:'bad',o:1,t:99000,j:'[]'},wrongFlag:{...state('wrongFlag'),o:2},wrongTime:{...state('wrongTime'),t:'99000'}});assert.deepEqual(Object.keys(out),['host']);assert.equal(Object.getPrototypeOf(out),null);});
test('valid host must identify itself and be in its own room',()=>{const h=api.parseRoomNodes({host:state('host')}).host;assert.equal(api.validHost(h),true);assert.equal(api.validHost({...h,uid:'other'}),false);assert.equal(api.validHost({...h,pr:{h:1,g:{host:'host',ph:'wait',pl:[]}}}),false);});
test('known host is not replaced by a new claimant',()=>{const h=api.parseRoomNodes({host:state('host'),other:state('other',99500,[{u:'other'},{u:'guest'}])});assert.equal(api.selectRoomHost(Object.values(h),'host','guest').uid,'host');assert.equal(api.selectRoomHost([h.other],'host','guest'),undefined);});
test('offline or future heartbeat does not count as alive',()=>{assert.equal(api.alive(state('host')),true);assert.equal(api.alive(state('host',200000)),false);assert.equal(api.alive(state('host',50000)),false);assert.equal(api.alive({...state('host'),o:0}),false);});
test('initial selection prefers a live host',()=>{const h=api.parseRoomNodes({old:state('old',1000,[{u:'old'},{u:'guest'}]),live:state('live')});assert.equal(api.selectRoomHost(Object.values(h),null,'guest').uid,'live');});

function mockRoom(){
  const handlers={}, writes=[], heartbeats=[], timers=[], visibility=[];
  let release, watch;
  const player={set(v){writes.push(v);return Promise.resolve()},update(v){heartbeats.push(v);return Promise.resolve()},remove(){return Promise.resolve()},onDisconnect(){return {update(){return Promise.resolve()},cancel(){return Promise.resolve()}}}};
  const room={once(){return new Promise(r=>{release=r})},on(event,fn){watch=fn},off(){},child(){return player}};
  const db={ref(p){return p.startsWith('.info/')?{on(e,fn){handlers[p]=fn}}:room}};
  const start=html.indexOf('const Net={'),end=html.indexOf('/* ---------- durum ---------- */',start);
  const net=new Function('document','setInterval','firebase',html.slice(start,end)+';return Net')({hidden:false,addEventListener(e,fn){visibility.push(fn)}},fn=>timers.push(fn),{database:{ServerValue:{TIMESTAMP:100000}}});
  net.init(db,'host');
  const saved={host:state('host')};
  return {net,writes,heartbeats,saved,connect:()=>handlers['.info/connected']({val:()=>true}),tick:()=>timers[0](),visible:()=>visibility[0](),restore:()=>release({val:()=>saved}),notify:()=>watch({val:()=>saved})};
}
test('refresh never overwrites saved state while the first read is pending',async()=>{
  const m=mockRoom(),pending=m.net.enter('ABCD');
  m.connect();m.tick();m.visible();
  assert.equal(m.writes.length,0);assert.equal(m.heartbeats.length,0);
  m.restore();const nodes=await pending;assert.equal(nodes.host.pr.g.host,'host');
  m.notify();m.connect();assert.equal(m.writes.length,0);
  await m.net.set({nm:'Test'});
  assert.equal(JSON.parse(m.writes[0].j).g.host,'host');
  m.connect();m.tick();assert.equal(m.writes.length,2);assert.equal(m.heartbeats.length,1);
});
test('leaving a room disables writes again',async()=>{
  const m=mockRoom(),pending=m.net.enter('ABCD');m.restore();await pending;
  await m.net.set({nm:'Test'});m.net.leave();m.connect();m.tick();m.visible();
  assert.equal(m.writes.length,1);assert.equal(m.heartbeats.length,0);
});
