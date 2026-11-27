const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('const INVITE_TTL='),html.indexOf('function canInviteRoom('))+html.slice(html.indexOf('function notificationItems('),html.indexOf('const Notifications='));
const {notificationItems,notificationSeen,pruneNotificationSeen}=new Function('const validFriendId=u=>typeof u==="string"&&/^[A-Za-z0-9_-]{20,128}$/.test(u),validRoomCode=c=>typeof c==="string"&&(/^[A-Z0-9]{4}$/.test(c)||/^P[A-Z2-9]{9}$/.test(c));'+src+';return {notificationItems,notificationSeen,pruneNotificationSeen}')();
const a='A'.repeat(28),b='B'.repeat(28),c='C'.repeat(28),d='D'.repeat(28),t=1234567;
test('V24.4 notification model combines pending friend requests and fresh game invites without duplicates',()=>{
 const x=notificationItems(a,{[a]:'pending',[b]:'pending',[c]:'accepted',bad:'pending'},{[b]:{c:'ABCD',s:'pending',t},[c]:{c:'ABCD',s:'pending',t:t-300000},[d]:{c:'ABCD',s:'dismissed',t}},t);
 assert.deepEqual(x,[{key:'f:'+b,peer:b,type:'friend'},{key:'g:'+b+':'+t,peer:b,type:'game'}]);
});
test('V24.4 read state preserves existing items and a new invite from same friend remains unread',()=>{
 const old='g:'+b+':'+(t-50000),fr='f:'+c,items=notificationItems(a,{[c]:'pending'},{[b]:{c:'ABCD',s:'pending',t}},t),seen=notificationSeen([old,fr]);
 const next=pruneNotificationSeen(seen,items,'game');
 assert.equal(next.has(old),false);assert.equal(next.has(fr),true);assert.equal(items.filter(x=>!next.has(x.key)).length,1);
});
test('V24.4 resolved friend requests can become unread on a subsequent request',()=>{
 const k='f:'+b,seen=notificationSeen([k]),cleared=pruneNotificationSeen(seen,[],'friend');
 assert.equal(cleared.size,0);assert.equal(notificationItems(a,{[b]:'pending'},null,t).filter(x=>!cleared.has(x.key)).length,1);
});
test('V24.4 stored read keys are validated and capped; account key is isolated',()=>{
 assert.equal(notificationSeen(null).size,0);assert.equal(notificationSeen(['bad','f:abc',null,'f:'+b,'f:'+b]).size,1);
 assert.equal(notificationSeen(Array.from({length:1005},(_,i)=>'g:'+b+':'+i)).size,1000);
 assert.ok(html.includes("'oo-notify-read-v1:'+this.uid"));assert.ok(html.includes("e.key===Notifications.storageKey()"));
});
test('V24.4 notification panel is noninterrupting, live, and delegates to existing authorized APIs',()=>{
 for(const x of ["id=\"ntBell\"","id=\"ntPanel\"","id=\"ntBadge\"","id=\"ntRead\"","this.ref=Net.db.ref('friendLinks/'+uid)","this.loaded=true;this.sync('friend')","Notifications.sync('game')","if(this.loaded)Notifications.sync('game')","!code&&['lobby','friends'].includes(screen)","if(!allowed)this.open=false","await api.accept(peer)","await api.remove(peer,'incoming')","Notifications.start(u.uid)","Notifications.stop()","Notifications.open&&items.length","data-invite-key","passwords.has(row.dataset.inviteKey)"])assert.ok(html.includes(x),x);
});
