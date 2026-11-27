const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8')).rules;
const src=html.slice(html.indexOf('const INVITE_TTL='),html.indexOf('const Invites='));
const {inviteRows,inviteRoomAvailable,inviteApi}=new Function("const validFriendId=u=>typeof u==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(u);const validRoomCode=c=>typeof c==='string'&&(/^[A-Z0-9]{4}$/.test(c)||/^P[A-Z2-9]{9}$/.test(c));"+src+';return {inviteRows,inviteRoomAvailable,inviteApi}')();
const a='A'.repeat(28),b='B'.repeat(28),c='C'.repeat(28),now=200000;
test('V24.3 valid invites are sorted, expire after 120s and reject self or malformed records',()=>{
 const data={[a]:{c:'ABCD',t:now},[b]:{c:'PABCDEFGH2',t:now-20},[c]:{c:'ABCD',t:now-120000},bad:{c:'ABCD',t:now}};
 assert.deepEqual(inviteRows(c,data,now).map(x=>x.from),[a,b]);assert.equal(inviteRows(a,data,now).length,1);
 assert.equal(inviteRows(c,{[a]:{c:'x/y',t:now},[b]:{c:'ABCD',t:now+10001}},now).length,0);
 assert.equal(inviteRows(c,{[a]:{c:'ABCD',t:now-120000}},now).length,0);
});
test('V24.3 public acceptance requires live original host, waiting phase and capacity',()=>{
 const g={host:a,ph:'wait',md:'c',pl:[{}]},n={o:1,t:now,pr:{h:1,g}},nodes={[a]:n};
 assert.equal(inviteRoomAvailable(nodes,a,now),true);assert.equal(inviteRoomAvailable(nodes,b,now),false);
 n.o=0;assert.equal(inviteRoomAvailable(nodes,a,now),false);n.o=1;n.t=now-45000;assert.equal(inviteRoomAvailable(nodes,a,now),false);n.t=now;
 g.ph='ans';assert.equal(inviteRoomAvailable(nodes,a,now),false);g.ph='wait';g.pl=Array(8).fill({});assert.equal(inviteRoomAvailable(nodes,a,now),false);
 g.md='t';g.pl=Array(4).fill({});assert.equal(inviteRoomAvailable(nodes,a,now),false);g.pl.pop();assert.equal(inviteRoomAvailable(nodes,a,now),true);
});
test('V24.3 send and dismiss use recipient inbox, require accepted friend and store no password',async()=>{
 const data={['friendLinks/'+b+'/'+a]:'accepted'},db={ref(p){return {once:async()=>({val:()=>data[p]}),set:async v=>{data[p]=v},remove:async()=>{delete data[p]}}}};
 const aa=inviteApi(db,a,now),bb=inviteApi(db,b,now);
 await aa.send(b,'PABCDEFGH2');assert.deepEqual(data['gameInvites/'+b+'/'+a],{c:'PABCDEFGH2',t:now});await bb.dismiss(a);assert.equal(data['gameInvites/'+b+'/'+a],undefined);
 let msg;try{await aa.send(c,'ABCD')}catch(e){msg=e.message}assert.equal(msg,'INV_FRIEND');
 try{await aa.send(a,'ABCD')}catch(e){msg=e.message}assert.equal(msg,'INV_INVALID');
});
test('V24.3 rules restrict inbox reads and invite writes, expiration and private owner',()=>{
 const u=rules.gameInvites.$uid,f=u.$from,w=f['.write'];
 assert.equal(u['.read'],'auth != null && auth.uid === $uid');assert.equal(rules.gameInvites['.read'],undefined);
 for(const x of ["auth.uid === $uid && !newData.exists()","auth.uid === $from","data.child('t').val() + 120000 <= now","child($from).val() === 'accepted'","child($uid).val() === 'accepted'","child('owner').val() === $from","child('t').val() > now - 45000"])assert.ok(w.includes(x),x);
 assert.ok(f['.validate'].includes("newData.child('t').val() === now"));assert.equal(f.$other['.validate'],false);
});
test('V24.3 integration keeps invites explicit and private admission unchanged',()=>{
 for(const x of ["id=\"inviteInbox\"","id=\"invitePanel\"","Invites.start(u.uid)","Invites.stop();FriendPresence.stop()","if(this.busy||!ME||code||openingRoom)return","await api.isFriend(peer)","await Net.peek(x.c)","$('joinPass').value='';$('code').value=x.c;updateJoinPassword();saveName();await joinRoom(x.c)","await Net.admit(c,password)","Şifreli oda: şifreyi ayrıca paylaş","@media(max-width:600px){.inv-row"])assert.ok(html.includes(x),x);
});
