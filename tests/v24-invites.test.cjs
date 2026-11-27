const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8')).rules;
const src=html.slice(html.indexOf('const INVITE_TTL='),html.indexOf('/* V24.4: live pending items'));
const {activeInvites,canInviteRoom,inviteHostReady,inviteApi}=new Function('const validFriendId=u=>typeof u==="string"&&/^[A-Za-z0-9_-]{20,128}$/.test(u),validRoomCode=c=>typeof c==="string"&&(/^[A-Z0-9]{4}$/.test(c)||/^P[A-Z2-9]{9}$/.test(c)),MAXP=8,alive=n=>!!n&&n.o===1,validHost=n=>n.pr&&n.pr.h===1&&n.pr.g&&n.pr.g.host===n.uid,firebase={database:{ServerValue:{TIMESTAMP:123456}}};'+src+';return {activeInvites,canInviteRoom,inviteHostReady,inviteApi}')();
const a='A'.repeat(28),b='B'.repeat(28),c='C'.repeat(28),t=1234567;
test('V24.3 invitations expire after five minutes and ignore invalid or dismissed records',()=>{
 assert.deepEqual(activeInvites({[a]:{c:'ABCD',s:'pending',t},[b]:{c:'PABCDEFGH2',s:'pending',t:t-300000},[c]:{c:'ABCD',s:'dismissed',t},bad:{c:'ABCD',s:'pending',t}},t),[{uid:a,c:'ABCD',t}]);
 assert.equal(activeInvites({[a]:{c:'a/b',s:'pending',t}},t).length,0);
 assert.equal(activeInvites({[a]:{c:'ABCD',s:'pending',t:t+10001}},t).length,0);
});
test('V24.3 only lobby host can invite and full, started or closed rooms fail preflight',()=>{
 const g={host:a,ph:'wait',pl:[{u:a}]},nodes={[a]:{uid:a,o:1,pr:{h:1,g}}};
 assert.equal(canInviteRoom(g,true,a),true);assert.equal(canInviteRoom(g,false,a),false);assert.equal(canInviteRoom(g,true,b),false);
 assert.equal(inviteHostReady(nodes,a),true);assert.equal(inviteHostReady(nodes,b),false);
 g.ph='ans';assert.equal(canInviteRoom(g,true,a),false);assert.equal(inviteHostReady(nodes,a),false);
 g.ph='wait';g.pl=Array.from({length:8},(_,i)=>({u:String(i)}));assert.equal(canInviteRoom(g,true,a),false);assert.equal(inviteHostReady(nodes,a),false);
 g.pl=[{u:a}];nodes[a].o=0;assert.equal(inviteHostReady(nodes,a),false);
});
test('V24.3 send writes only code, state and timestamp, cooldown and stale dismissal protected',async()=>{
 const data={},db={ref(p){return{once:async()=>({val:()=>data[p]||null}),set:async v=>{data[p]=v},transaction:async fn=>{const v=fn(data[p]);if(v!==undefined)data[p]=v}}}};
 const api=inviteApi(db,a),other=inviteApi(db,b),key='gameInvites/'+b+'/'+a;
 await api.send(b,'PABCDEFGH2',t);assert.deepEqual(data[key],{c:'PABCDEFGH2',s:'pending',t:123456});
 let error;try{await api.send(b,'ABCD',123457)}catch(e){error=e.message}assert.equal(error,'INVITE_COOLDOWN');
 await other.dismiss(a,{c:'ABCD',t:123456});assert.equal(data[key].s,'pending');
 await other.dismiss(a,{c:'PABCDEFGH2',t:123456});assert.equal(data[key].s,'dismissed');
 data['friendLinks/'+a+'/'+b]='accepted';assert.equal(await api.accepted(b),true);assert.equal(await other.accepted(a),true);
});
test('V24.3 rules restrict invite access, sending, immutable dismissal and password exclusion',()=>{
 const r=rules.gameInvites.$uid,s=r.$sender,w=s['.write'];assert.equal(r['.read'],'auth != null && auth.uid === $uid');assert.equal(s['.read'],'auth != null && auth.uid === $sender');
 for(const x of ["auth.uid === $sender","auth.uid === $uid","=== 'accepted'","now - 30000","now - 45000","privateRoomLocks","privateRooms","newData.child('t').val() === data.child('t').val()","newData.child('c').val() === data.child('c').val()"])assert.ok(w.includes(x),x);
 assert.equal(s.$other['.validate'],false);assert.equal(rules.gameInvites['.read'],undefined);
});
test('V24.3 user chooses accept, private password goes through normal admission, no forced room switch',()=>{
 for(const x of ["if(this.busy||!ME||code||openingRoom)return","if(isPrivateCode(x.c)&&!validRoomPassword(password))","await joinRoom(x.c,false,peer)","await Net.admit(c,password)","if(inviteHost&&!inviteHostReady(await Net.peek(c),inviteHost))","INVITE_CLOSED","await api.accepted(peer)","Invites.start(u.uid)","Invites.stop()","data-iv=\"accept\"","data-iv=\"dismiss\"","@media(max-width:600px){.iv-row"])assert.ok(html.includes(x),x);
});
