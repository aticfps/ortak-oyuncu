const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fixture(host='ortak-oyuncu.pages.dev'){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
 const calls=[],pending=[],opened=[],renders=[];let user={uid:'a',getIdToken:async()=> 'token'};
 const fetch=async(url,opt)=>{calls.push({url,opt});return new Promise(resolve=>pending.push(resolve))};
 const preview={inProgress:()=>false,reset(){},open(...args){opened.push(args)}};
 const src=html.slice(html.indexOf('const Ranked={'),html.indexOf("$('rankGo').onclick"));
 const f=new Function('$','firebase','location','fetch','RankedPreview','rankedPreviewHost','renderRankedBoard','renderRankedHistory','renderRankedSeason','renderRankedLevel','stableHTML','let ME="a",screen="ranked",code=null;\n'+src+';return {Ranked,setUid(v){ME=v}}');
 const o=f($,{auth:()=>({currentUser:user})},{hostname:host,protocol:'https:'},fetch,preview,h=>/^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(h),()=>{},()=>{},()=>{},n=>renders.push(n),(node,s)=>node.textContent=s);
 const answer=(data,status=200)=>pending.shift()(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
 return {...o,$,calls,opened,renders,answer,preview,setUser(uid){user={uid,getIdToken:async()=> 'token'};o.setUid(uid)}};
}
const profile=(enabled,played=0)=>({version:'25.1a',rankedEnabled:enabled,registered:true,profile:{rating:1000+25*played,played,wins:played,draws:0,losses:0}});
test('V26.1c verified profile controls production mode and refreshes all four panels on settlement',async()=>{
 for(const [host,enabled,expected] of [['ortak-oyuncu.pages.dev',false,false],['ortak-oyuncu.pages.dev',true,true],['example.netlify.app',true,false],['test.ortak-oyuncu.pages.dev',false,false]]){
  const f=fixture(host),p=f.Ranked;let panels=0;
  for(const method of ['loadSeason','loadHistory','loadBoard'])p[method]=async()=>{panels++};
  const loaded=p.load();await Promise.resolve();assert.equal(f.calls[0].url,'/api/ranked/me');assert.equal(f.calls[0].opt.method,'POST');f.answer(profile(enabled));await loaded;
  assert.deepEqual(f.opened,[['a',expected]]);assert.equal(p.productionEnabled,expected);assert.equal(panels,3);
  f.preview.onSettled();await Promise.resolve();assert.equal(panels,6);assert.equal(f.calls[1].opt.method,'GET');
  f.answer(profile(enabled,1));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.renders.at(-1),1025);assert.match(f.$('rankStats').textContent,/<b>1<\/b><small>Maç/);
  p.reset();assert.equal(p.productionEnabled,false);
 }
});
test('V26.1c late profile response cannot overwrite switched account or invalid counters',async()=>{
 const f=fixture(),p=f.Ranked;
 const a=p.refreshProfile();await Promise.resolve();f.setUser('b');f.answer(profile(true,1));await a;assert.equal(f.renders.length,0);
 const b=p.refreshProfile();await Promise.resolve();const invalid=profile(true,1);invalid.profile.wins=0;f.answer(invalid);await b;assert.equal(f.renders.length,0);
});
