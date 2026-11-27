const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8')).rules;
const src=html.slice(html.indexOf('function friendPresenceState('),html.indexOf('const FriendPresence='));
const {friendPresenceState,localFriendState}=new Function('const FRIEND_TTL=75000;'+src+';return {friendPresenceState,localFriendState}')();
const t=100000;
test('V24.2 empty, stale, malformed or future presence is offline',()=>{
 for(const v of [null,{}, {x:{s:'online',t:t-75000}}, {x:{s:'room',t:t+10001}}, {x:{s:'invalid',t}}, {x:{s:'game',t:String(t)}}])assert.equal(friendPresenceState(v,t),'offline');
});
test('V24.2 fresh sessions resolve to the most active state and survive one tab closing',()=>{
 const a={x:{s:'online',t},y:{s:'room',t},z:{s:'game',t}};
 assert.equal(friendPresenceState(a,t),'game');delete a.z;assert.equal(friendPresenceState(a,t),'room');delete a.y;assert.equal(friendPresenceState(a,t),'online');delete a.x;assert.equal(friendPresenceState(a,t),'offline');
});
test('V24.2 room phase maps to presence without sharing code',()=>{
 assert.equal(localFriendState(null,null),'online');for(const p of [null,'wait','end'])assert.equal(localFriendState('SECRET',p),'room');for(const p of ['pick','rev','ans','res'])assert.equal(localFriendState('SECRET',p),'game');
});
test('V24.2 presence rules allow only accepted friends or owner, validate timestamp and state',()=>{
 const r=rules.friendPresence.$uid,s=r.$sid;
 assert.ok(r['.read'].includes("root.child('friendLinks').child($uid).child(auth.uid).val() === 'accepted'"));
 assert.ok(r['.read'].includes("root.child('friendLinks').child(auth.uid).child($uid).val() === 'accepted'"));
 assert.match(s['.write'],/auth.uid === \$uid/);assert.match(s['.validate'],/newData.child\('t'\).val\(\) === now/);
 assert.equal(s.$other['.validate'],false);assert.equal(rules.friendPresence['.read'],undefined);
});
test('V24.2 session lifecycle registers disconnect cleanup before publish and removes on logout',()=>{
 for(const x of ["'friendPresence/'+uid+'/'+randomRoomToken(20)","await ref.onDisconnect().remove()","this.epoch!==epoch||this.serial!==seq","this.publish(true),20000","ref.set({s:state,t:firebase.database.ServerValue.TIMESTAMP})","const pending=FriendPresence.stop();leaveRoom()","FriendPresence.start(u.uid)","visibilitychange"])assert.ok(html.includes(x),x);
});
test('V24.2 only accepted rows get status, listeners detach, offline viewer shows unknown',()=>{
 for(const x of ["row.state==='accepted'?'<span class=\"fr-state\"","FriendWatch.sync(data.friends)","if(screen==='friends')FriendWatch.stop()","item.ref.off('value',item.cb)","this.connected&&x&&x.known?friendPresenceState","data-state=\"online\"","data-state=\"room\"","data-state=\"game\""])assert.ok(html.includes(x),x);
});
