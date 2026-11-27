const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fixture(host='test.ortak-oyuncu.pages.dev'){
 const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:'',value:'',replaceChildren(...x){this.children=x}});return nodes.get(id)};
 const src=html.slice(html.indexOf('const rankedPreviewHost='),html.indexOf('/* V24.5: read-only standings'));
 let calls=[],replies=[];
 const fetch=async(url,opt)=>{calls.push({url,opt,body:JSON.parse(opt.body)});const x=replies.shift();if(!x)throw Error('UNEXPECTED_FETCH');return new Response(JSON.stringify(x.data),{status:x.status||200,headers:{'content-type':'application/json'}})};
 const f=new Function('$','location','firebase','ME','screen','code','fetch','setInterval','clearInterval','stableHTML','has','crest','esc','TEAMS','document','crypto','confirm',src+';return {RankedPreview,rankedPreviewHost,rankedClock,rankedSides}');
 const r=f($,{hostname:host,protocol:'https:'},{auth:()=>({currentUser:{uid:'u',getIdToken:async()=> 'token'}})},'u','ranked',null,fetch,()=>1,()=>{},(node,s)=>node.textContent=s,id=>['GS','BAR'].includes(id),()=>'<span></span>',s=>s,{GS:['Galatasaray'],BAR:['Barcelona']},{createElement:()=>({})},{randomUUID:()=> 'c'},()=>true);
 const wait=async()=>{for(let i=0;i<30&&r.RankedPreview.busy;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(r.RankedPreview.busy,false)};
 return {...r,$,calls,replies,wait};
}
test('V25.4d production and Netlify never open private preview transport',()=>{
 for(const host of ['ortak-oyuncu.pages.dev','effervescent-sunburst-6feddf.netlify.app','fake.ortak-oyuncu.pages.dev.evil.example']){
  const f=fixture(host);f.RankedPreview.reset();f.RankedPreview.open('u');assert.equal(f.calls.length,0);assert.equal(f.$('rkJoin').disabled,true);
 }
});
test('V25.4d rejected preview probe leaves matchmaking disabled',async()=>{
 const f=fixture();f.replies.push({status:403,data:{error:'PREVIEW_FORBIDDEN'}});f.RankedPreview.open('u');await f.wait();
 assert.equal(f.RankedPreview.allowed,false);assert.equal(f.$('rkJoin').disabled,true);assert.equal(f.calls.length,1);
});
test('V25.4d queue probe and join use verified token without client rating',async()=>{
 const f=fixture();f.replies.push({data:{status:'idle'}});f.RankedPreview.open('u');await f.wait();
 assert.equal(f.$('rkJoin').disabled,false);
 f.replies.push({data:{status:'searching',waitMs:15000,maxGap:150}});f.RankedPreview.join();await f.wait();
 assert.equal(f.RankedPreview.phase,'search');assert.equal(f.$('rkWait').textContent,'00:15');assert.equal(f.$('rankBack').disabled,true);
 assert.deepEqual(f.calls[1].body,{action:'queue.join'});assert.equal(f.calls[1].opt.headers.Authorization,'Bearer token');
});
test('V25.4d pending offer and player-relative game score render without invented ELO',async()=>{
 const f=fixture(),p=f.RankedPreview;p.uid='u';p.allowed=true;p.matchId='m';
 await p.offer({status:'pending',remainingMs:20000,accepted:true,opponentAccepted:false});
 assert.equal(f.$('rkAccept').disabled,true);assert.equal(f.$('rkSelfReady').textContent,'Hazır');
 p.game({revision:1,side:'b',state:{status:'active',round:1,scoreA:4,scoreB:2,current:{deadline:Date.now()+20000,clubs:['GS','BAR']},history:[]}});
 assert.equal(f.$('rkSelfScore').textContent,2);assert.equal(f.$('rkOtherScore').textContent,4);
 p.game({revision:2,side:'b',state:{status:'completed',scoreA:4,scoreB:2},settlement:{outcome:'loss',ratingBefore:1000,ratingAfter:975}});
 assert.equal(p.phase,'result');assert.equal(f.$('rkDelta').textContent,'-25 ELO');assert.equal(f.$('rankRating').textContent,'975');
 p.reset();assert.equal(p.matchId,null);assert.equal(f.$('rkJoin').disabled,true);assert.equal(f.$('rkHistory').textContent,'');
});
test('V25.4d required controls and reduced-motion rules are present',()=>{
 for(const id of ['rkJoin','rkSearch','rkOffer','rkAccept','rkDecline','rkGame','rkAnswerForm','rkSurrender','rkResult'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.rk-search\{animation:none\}\}/);
});

test('V26.0b rate-limit feedback pauses polling but answer-only limit leaves heartbeat available',async()=>{
 const f=fixture(),p=f.RankedPreview;p.uid='u';p.allowed=true;p.phase='game';p.matchId='m';
 f.replies.push({status:429,data:{error:'RATE_LIMITED',retryAfter:30}});
 await assert.rejects(p.request('game.answer',{matchId:'m',commandId:'x',round:1,input:'x'}),/RATE_LIMITED/);assert.equal(p.retryAt,0);
 f.replies.push({status:429,data:{error:'RATE_LIMITED',retryAfter:30}});p.pulse();await f.wait();
 assert.ok(p.retryAt>Date.now());assert.match(f.$('rkError').textContent,/Çok sık/);
 const n=f.calls.length;p.pulse();await f.wait();assert.equal(f.calls.length,n);
 p.reset();assert.equal(p.retryAt,0);
});

test('V26.1c production UI needs explicit enabled profile and successful authenticated probe',async()=>{
 const f=fixture('ortak-oyuncu.pages.dev'),p=f.RankedPreview;
 p.reset();p.open('u',false);assert.equal(f.calls.length,0);assert.equal(f.$('rkJoin').disabled,true);
 f.replies.push({status:404,data:{error:'RANKED_PREVIEW_DISABLED'}});p.open('u',true);await f.wait();
 assert.equal(p.allowed,false);assert.equal(f.$('rkJoin').disabled,true);p.join();assert.equal(f.calls.length,1);
 f.replies.push({data:{status:'idle'}});p.open('u',true);await f.wait();
 assert.equal(p.allowed,true);assert.equal(f.$('rkHint').textContent,'Rekabetçi 1v1');
 f.replies.push({data:{status:'searching',waitMs:0,maxGap:100}});p.join();await f.wait();
 assert.deepEqual(f.calls[2].body,{action:'queue.join'});assert.equal(f.calls[2].opt.headers.Authorization,'Bearer token');
 p.reset();assert.equal(p.productionEnabled,false);assert.equal(p.allowed,false);assert.equal(f.$('rkJoin').disabled,true);
 const netlify=fixture('effervescent-sunburst-6feddf.netlify.app');netlify.RankedPreview.open('u',true);assert.equal(netlify.calls.length,0);
});
