const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('const H={n:Object.create(null)'),end=html.indexOf('try{myName=',start);
const handlers=html.slice(html.indexOf('function handleInputs('),html.indexOf('function removePlayer('));
const guards=html.slice(start,end);
function harness(){
  return new Function(guards+`
    let G={gid:5,pn:12,r:2,ph:'ans',pl:[{u:'guest'}]},calls=[];
    const idxOf=u=>0,pickTeam=(u,id)=>calls.push(['pick',id]),answer=(i,t)=>calls.push(['ans',t]),joker=()=>calls.push(['joker']),objectIt=(i,t)=>calls.push(['ob',t]),hintIt=()=>calls.push(['hint']),vote=(i,id,v)=>calls.push(['vote',id,v]),nextRound=()=>calls.push(['next']);
    `+handlers+';return {G,calls,H,C,commandSeq,commandFresh,snapshotFresh,seedCommands,resetCommands,handleInputs}')();
}
test('command sequence must be positive safe integer',()=>{const a=harness();for(const x of [0,-1,1.5,'2',Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.equal(a.commandSeq(x),0);assert.equal(a.commandSeq(3),3)});
test('reject previous turn number even if old r equals displayed round',()=>{const a=harness();a.handleInputs(0,{ans:{n:10,g:5,r:2,t:'wrong'}});a.handleInputs(0,{ans:{n:1,g:5,r:12,t:'correct'}});assert.deepEqual(a.calls,[['ans','correct']])});
test('reject repeated, malformed or wrong-game commands',()=>{const a=harness();for(const cmd of [{n:1,g:4,r:12,t:'old'},{n:2,g:5,r:12,t:{}},{n:3,g:5,r:12,t:'x'.repeat(61)},{n:4,g:5,r:12,t:'valid'},{n:4,g:5,r:12,t:'duplicate'}])a.handleInputs(0,{ans:cmd});assert.deepEqual(a.calls,[['ans','valid']])});
test('restore and reset every command counter including hints',()=>{const a=harness();a.seedCommands('guest',{ip:{n:4},ans:{n:3}});a.handleInputs(0,{ip:{n:4,g:5,r:12},ans:{n:3,g:5,r:12,t:'old'}});assert.deepEqual(a.calls,[]);a.resetCommands();a.handleInputs(0,{ip:{n:1,g:5,r:12}});assert.deepEqual(a.calls,[['hint']])});
test('vote requires matching turn, game and objection ID',()=>{const a=harness();a.G.ph='res';a.G.ob={id:7};for(const cmd of [{n:1,id:7,v:1},{n:2,id:7,v:1,g:5,r:11},{n:3,id:8,v:1,g:5,r:12},{n:4,id:7,v:'1',g:5,r:12},{n:5,id:7,v:0,g:5,r:12}])a.handleInputs(0,{vt:cmd});assert.deepEqual(a.calls,[['vote',7,false]])});
test('snapshot sequence never regresses or switches to previous game',()=>{const a=harness();const old={seq:20,gid:5};assert.equal(a.snapshotFresh({seq:19,gid:5},old),false);assert.equal(a.snapshotFresh({seq:21,gid:4},old),false);assert.equal(a.snapshotFresh({seq:21,gid:5},old),true);assert.equal(a.snapshotFresh({seq:22,gid:6},old),true);assert.equal(a.snapshotFresh({seq:'22',gid:6},old),false)});
test('answer, joker and hint each reject an expired round',()=>{for(const [name,next] of [['answer','joker'],['joker','hintIt'],['hintIt',null]]){const a=html.indexOf('function '+name+'('),b=next?html.indexOf('function '+next+'(',a):html.indexOf('const TRN=',a);const f=new Function('let G={ph:"ans",end:100,T:30}, now=()=>100,P=()=>({u:"guest",j:1}),isDuel=()=>true;'+html.slice(a,b)+';return '+name)();assert.doesNotThrow(()=>f(0,'correct'))}});
test('duplicate objection vote cannot overwrite an existing vote',()=>{const a=html.indexOf('function vote('),b=html.indexOf('function checkVotes(',a);const f=new Function('const G={ph:"res",ob:{id:1,u:"host",v:{guest:1}}};const P=()=>({u:"guest"});'+html.slice(a,b)+';return {vote,G}')();f.vote(0,1,false);assert.equal(f.G.ob.v.guest,1)});
