const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','database.rules.json'),'utf8')).rules;
const src=html.slice(html.indexOf('const validFriendId='),html.indexOf('const Friends='));
const {validFriendId,friendRows,friendApi}=new Function(src+';return {validFriendId,friendRows,friendApi}')();
const a='A'.repeat(28),b='B'.repeat(28),c='C'.repeat(28);
function mock(){
 const data={};
 function read(p){let x=data;for(const k of p.split('/').filter(Boolean))x=x&&x[k];return x??null}
 function write(p,v){const parts=p.split('/'),key=parts.pop();let x=data;for(const k of parts)x=x[k]||=( {});if(v===null)delete x[key];else x[key]=v}
 return {db:{ref(p=''){return {once:async()=>({val:()=>read(p)}),set:async v=>write(p,v),update:async v=>{for(const [k,x] of Object.entries(v))write(k,x)}}}},read};
}
test('V24.1 friend codes are safe path components; reject malformed and self',async()=>{
 assert.equal(validFriendId(a),true);for(const x of ['','a/b','a.b','a#b','x'.repeat(129),null])assert.equal(validFriendId(x),false);
 const m=mock(),api=friendApi(m.db,a);let error;try{await api.send(a)}catch(e){error=e.message}assert.equal(error,'FR_INVALID');
});
test('V24.1 request is pending on both sides until recipient accepts',async()=>{
 const m=mock(),aa=friendApi(m.db,a),bb=friendApi(m.db,b);await aa.register('Alpha');await bb.register('Beta');await aa.send(b);
 assert.equal(m.read('friendLinks/'+b+'/'+a),'pending');assert.equal(m.read('friendOutgoing/'+a+'/'+b),true);
 assert.equal((await aa.list()).sent[0].name,'Beta');assert.equal((await bb.list()).received[0].name,'Alpha');assert.equal((await aa.list()).friends.length,0);
 await bb.accept(a);assert.equal((await aa.list()).friends[0].peer,b);assert.equal((await bb.list()).friends[0].peer,a);
});
test('V24.1 duplicate, reverse, missing and malformed friend requests are blocked',async()=>{
 const m=mock(),aa=friendApi(m.db,a),bb=friendApi(m.db,b);await aa.register('Alpha');await bb.register('Beta');await aa.send(b);
 for(const [api,id,expected] of [[aa,b,'FR_EXISTS'],[bb,a,'FR_EXISTS'],[aa,c,'FR_NOT_FOUND'],[aa,'x/y','FR_INVALID']]){let error;try{await api.send(id)}catch(e){error=e.message}assert.equal(error,expected)}
});
test('V24.1 reject, cancel and unfriend clear canonical relationship for both sides',async()=>{
 const m=mock(),aa=friendApi(m.db,a),bb=friendApi(m.db,b);await aa.register('Alpha');await bb.register('Beta');await aa.send(b);await bb.remove(a,'incoming');
 assert.equal((await aa.list()).sent.length,0);assert.equal((await bb.list()).received.length,0);
 await aa.send(b);await aa.remove(b,'outgoing');assert.equal(m.read('friendOutgoing/'+a+'/'+b),null);assert.equal((await bb.list()).received.length,0);
 await aa.send(b);await bb.accept(a);await aa.remove(b,'outgoing');assert.equal((await aa.list()).friends.length,0);assert.equal((await bb.list()).friends.length,0);
});
test('V24.1 row model filters stale, malformed and duplicate peer records',()=>{
 const x=friendRows(a,{[a]:'accepted',[b]:'accepted',bad:'pending'},{[b]:'pending',[c]:'pending'});
 assert.equal(x.friends.length,1);assert.equal(x.received.length,0);assert.equal(x.sent.length,1);assert.equal(x.sent[0].peer,c);
});
test('V24.1 static rules enforce participant-only links and recipient-only acceptance',()=>{
 const l=rules.friendLinks.$uid,p=l.$peer,o=rules.friendOutgoing.$uid,prof=rules.friendProfiles.$uid;
 assert.equal(l['.read'],'auth != null && auth.uid === $uid');assert.equal(p['.read'],'auth != null && auth.uid === $peer');
 assert.match(p['.write'],/auth.uid === \$peer && !data.exists\(\) && newData.val\(\) === 'pending'/);
 assert.match(p['.write'],/auth.uid === \$uid && data.val\(\) === 'pending' && newData.val\(\) === 'accepted'/);
 assert.match(p['.write'],/\$uid !== \$peer/);assert.match(o.$peer['.write'],/auth.uid === \$uid/);assert.match(prof['.write'],/auth.uid === \$uid/);
 assert.equal(rules.friendProfiles['.read'],undefined);assert.equal(rules.friendLinks['.read'],undefined);assert.equal(rules.friendOutgoing['.read'],undefined);
});
test('V24.1 social screen uses escaped display names, no email and account reset',()=>{
 for(const id of ['friendsGo','friends','frCode','frSend','frList','frIncoming','frOutgoing','frRefresh'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes("Friends.reset();Friends.register().catch"));assert.ok(html.includes("esc(n)"));assert.ok(html.includes("friendApi(Net.db,ME).register(clean($('myName').value))"));
});

test('V24.1a mobile friend cards and controls use shrinkable single-column layout',()=>{
 const css=html.slice(html.indexOf('/* V24.1a:'),html.indexOf('</style>'));
 for(const marker of ['#friends .fr-card{min-width:0;width:100%;box-sizing:border-box;grid-template-columns:minmax(0,1fr)','@media(max-width:600px)','grid-template-columns:34px minmax(0,1fr)','grid-column:1/-1','grid-template-columns:repeat(auto-fit,minmax(0,1fr))','font:500 16px/1.3','min-height:44px','overflow-wrap:anywhere','#friends #frBack{width:100%}'])assert.ok(css.includes(marker),marker);
});
test('V24.1a mobile friend code input preserves case and disables keyboard corrections',()=>{
 assert.match(html,/id="frTarget"[^>]*autocapitalize="off" autocorrect="off" spellcheck="false"/);
 assert.match(html,/id="frCode" readonly/);
 assert.match(html,/class="fr-back"><button class="btn ghost" id="frBack" type="button"/);
});
