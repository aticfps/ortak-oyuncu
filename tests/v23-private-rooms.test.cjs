const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8')).rules;
const defs=html.split('\n').filter(l=>/^(const (isPrivateCode|validRoomCode|validRoomPassword|roomPath|randomRoomToken|denied)=)/.test(l));
const api=new Function('crypto',defs.join('\n')+';return {isPrivateCode,validRoomCode,validRoomPassword,roomPath,randomRoomToken,denied}')({getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=i;return a}});
const code='PABCDEFGH2',password='Abcd1234efgh5678';
test('V23.2 public and private room paths never overlap',()=>{
  assert.equal(api.roomPath('ABCD'),'rooms/ABCD');assert.equal(api.roomPath(code),'privateRooms/'+code);
  for(const c of ['P123','PABCDEFGH1','../ABCD','ABCD/EFGH','PABCDEFGHIJK'])if(c!=='P123')assert.equal(api.validRoomCode(c),false);
  assert.equal(api.validRoomCode('P123'),true);assert.equal(api.isPrivateCode('P123'),false);
});
test('V23.2 password bounds and cryptographic generator alphabet',()=>{
  for(const n of [0,11,65])assert.equal(api.validRoomPassword('x'.repeat(n)),false);
  for(const n of [12,16,64])assert.equal(api.validRoomPassword('x'.repeat(n)),true);
  const token=api.randomRoomToken(32);assert.equal(token.length,32);assert.equal(new Set(token).size,32);assert.match(token,/^[A-Z2-9]+$/);
});
function mockNet({allowed=false,correct=password}={}){
  const attempts=[], reads=[], writes=[];
  const db={ref(p){return {once(){reads.push(p);return allowed||p.startsWith('rooms/')?Promise.resolve({val:()=>({})}):Promise.reject({code:'PERMISSION_DENIED'})},set(v){writes.push({p,v});if(p.startsWith('privateRoomLocks/'))return Promise.resolve();attempts.push(v);if(v!==correct)return Promise.reject({code:'PERMISSION_DENIED'});allowed=true;return Promise.resolve()}}}};
  const start=html.indexOf('const Net={'),end=html.indexOf('/* ---------- durum ---------- */',start);
  const net=new Function('firebase',html.slice(start,end)+';return Net')({database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}});
  net.db=db;net.uid='guest';return {net,attempts,reads,writes};
}
test('V23.2 correct password admits, wrong password fails, refresh needs no new password',async()=>{
  const m=mockNet();let rejected=false;try{await m.net.admit(code,'WrongPass12345')}catch(e){rejected=true;assert.equal(e.code,'PERMISSION_DENIED')}assert.equal(rejected,true);
  await m.net.admit(code,password);assert.equal(m.attempts.length,2);assert.equal(m.writes[1].p,'privateRoomAccess/'+code+'/guest');
  await m.net.admit(code,'');assert.equal(m.attempts.length,2);assert.equal(m.reads.every(p=>p==='privateRooms/'+code),true);
});
test('V23.2 private admission requires password before writing and public rooms skip admission',async()=>{
  const m=mockNet();let message='';try{await m.net.admit(code,'')}catch(e){message=e.message}assert.equal(message,'ROOM_PASSWORD_REQUIRED');assert.equal(m.writes.length,0);
  await m.net.admit('ABCD','');assert.equal(m.reads.length,1);
});
test('V23.2 creation writes lock only to protected path with server timestamp',async()=>{
  const m=mockNet();await m.net.lock(code,password);assert.deepEqual(m.writes,[{p:'privateRoomLocks/'+code,v:{owner:'guest',password,createdAt:{'.sv':'timestamp'}}}]);
});
test('V23.2 rules deny secret reads and require correct password, UID and live lock (static)',()=>{
  const l=rules.privateRoomLocks.$code,a=rules.privateRoomAccess.$code.$uid,p=rules.privateRooms.$code;
  assert.equal(l['.read'],false);assert.match(l['.write'],/!data.exists\(\)/);assert.match(l['.validate'],/owner.*auth.uid/);assert.match(l['.validate'],/length >= 12/);
  assert.equal(a['.read'],false);assert.match(a['.write'],/auth.uid === \$uid/);assert.match(a['.write'],/newData.val\(\) === root.child\('privateRoomLocks'\)/);assert.match(a['.write'],/86400000/);
  assert.match(p['.read'],/auth.uid/);assert.match(p['.read'],/privateRoomAccess/);assert.match(p['.read'],/password/);assert.match(p.$peer['.write'],/auth.uid === \$peer/);assert.equal(p.$peer['.validate'],rules.rooms.$code.$peer['.validate']);
  assert.equal(rules.rooms.$code['.read'],'auth != null');assert.equal(rules.rooms.$code.$peer['.write'],'auth != null && auth.uid === $peer');
});
test('V23.2 links, spectators and login use guarded join path and no password in invitation',()=>{
  assert.ok(html.includes("const roomUrl=c=>location.origin+location.pathname+'#'+c"));
  assert.ok(html.includes('if(c&&!code){saveName();joinRoom(c)}'));assert.ok(html.includes('joinRoom(c,false)')||html.includes('joinRoom(c)}'));
  assert.ok(html.includes("joinRoom($('code').value.trim().toUpperCase(),true)"));assert.ok(html.includes("await Net.admit(c,password)"));assert.ok(html.includes("await enterRoom(c,false,spec)"));
  for(const id of ['createPass','joinPass','joinPassWrap','privateBadge','generatePass'])assert.ok(html.includes('id="'+id+'"'));
});
