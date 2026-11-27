// V25.3d internal-only durable replay. Never expose seed or journal to clients.
// Authentication and match admission must be performed by the future server boundary.
import {createRankedGame} from './ranked-game.mjs';
export const SESSION_VERSION='ranked-session-v3-top30-audit1906';
const MAX_EVENTS=256,MAX_JSON=65536,MAX_RETRIES=6;
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const uidOK=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const timeOK=x=>Number.isSafeInteger(x)&&x>0&&x<=Number.MAX_SAFE_INTEGER-20000;
const internalTypes=['tick','monitor'];
const participantTypes=['answer','heartbeat','surrender'];
function fail(code){throw Error(code)}
function seedRandom(){const v=new Uint32Array(1);globalThis.crypto.getRandomValues(v);return v[0]}
function seededChooser(seed){
 // Deterministic replay, secret seed generated server-side. Not an authentication primitive.
 let s=seed>>>0;
 return n=>{
  const limit=2**32-(2**32%n);
  let r;
  do{s=(s+0x6D2B79F5)>>>0;let x=s;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);r=(x^(x>>>14))>>>0}while(r>=limit);
  return r%n;
 };
}
function eventOK(e){
 return e&&validId(e.id)&&timeOK(e.at)&&(internalTypes.includes(e.type)||(participantTypes.includes(e.type)&&uidOK(e.uid)&&(e.type!=='answer'||(Number.isSafeInteger(e.round)&&e.round>=1&&e.round<=5&&typeof e.input==='string'&&e.input.length<=100))));
}
function stateOK(s){
 if(!s||s.version!==SESSION_VERSION||!validId(s.matchId)||!uidOK(s.uidA)||!uidOK(s.uidB)||s.uidA===s.uidB||!timeOK(s.startedAt)
   ||!Number.isSafeInteger(s.seed)||s.seed<0||s.seed>0xffffffff||!Array.isArray(s.events)||s.events.length>MAX_EVENTS)fail('INVALID_SESSION');
 const seen=new Set();let last=s.startedAt;
 for(const e of s.events){if(!eventOK(e)||seen.has(e.id)||e.at<last||(participantTypes.includes(e.type)&&e.uid!==s.uidA&&e.uid!==s.uidB))fail('INVALID_JOURNAL');seen.add(e.id);last=e.at}
}
function replay(s){
 stateOK(s);let t=s.startedAt;
 const g=createRankedGame({matchId:s.matchId,uidA:s.uidA,uidB:s.uidB},{clock:()=>t,choose:seededChooser(s.seed)});
 const apply=e=>{if(e.at<t)fail('SERVER_CLOCK_REGRESSION');t=e.at;return e.type==='tick'?{state:g.tick()}:e.type==='monitor'?g.monitor():e.type==='heartbeat'?g.heartbeat(e.uid):e.type==='surrender'?g.surrender(e.uid):g.answer(e.uid,e.round,e.input)};
 const outcomes=new Map();
 for(const e of s.events){const before=g.snapshot(),r=apply(e),after=g.snapshot();
  if(!changed(before,after,r))fail('INVALID_JOURNAL_TRANSITION');
  outcomes.set(e.id,r);
 }
 return {g,apply,outcomes};
}
function changed(before,after,r){return before.round!==after.round||before.status!==after.status||r.accepted===true||r.reason==='WRONG_ANSWER'||r.reason==='PLAYER_USED'}
function sameCommand(a,b){return a.type===b.type&&(internalTypes.includes(a.type)||(a.uid===b.uid&&(a.type!=='answer'||(a.round===b.round&&a.input===b.input))))}
function encode(s){const text=JSON.stringify(s);if(text.length>MAX_JSON)fail('SESSION_TOO_LARGE');return text}
function parse(row){
 if(!row||!Number.isSafeInteger(row.revision)||row.revision<0||row.revision>MAX_EVENTS||typeof row.state_json!=='string'||row.state_json.length>MAX_JSON)fail('INVALID_SESSION_ROW');
 let s;try{s=JSON.parse(row.state_json)}catch{fail('INVALID_SESSION_JSON')}
 stateOK(s);if(s.events.length!==row.revision||s.matchId!==row.match_id)fail('SESSION_REVISION_MISMATCH');
 return s;
}
export function createSessionState(match,{clock=Date.now,seed=seedRandom}={}){
 // Match must be read from the server-owned ranked_matches table by the caller.
 if(!match||match.status!=='active'||!validId(match.match_id))fail('MATCH_NOT_ACTIVE');
 const s={version:SESSION_VERSION,matchId:match.match_id,uidA:match.uid_a,uidB:match.uid_b,startedAt:clock(),seed:seed(),events:[]};
 stateOK(s);return s;
}
// Repository contract: read(matchId), insert(state), cas(matchId,revision,state).
// Each CAS must condition on exact prior revision and return true only for one changed row.
export function createRankedSessionService(store,{clock=Date.now,seed=seedRandom}={}){
 if(!store||!['read','insert','cas','match'].every(k=>typeof store[k]==='function'))fail('INVALID_SESSION_STORE');
 async function load(matchId){if(!validId(matchId))fail('INVALID_MATCH_ID');const row=await store.read(matchId);if(!row)fail('SESSION_NOT_FOUND');const s=parse(row);return {row,s,...replay(s)}}
 async function start(matchId,{monitor=false}={}){
  if(!validId(matchId))fail('INVALID_MATCH_ID');
  const existing=await store.read(matchId);if(existing){const snapshot=replay(parse(existing)).g.snapshot();if(monitor&&!snapshot.presenceEnabled)fail('MONITOR_REQUIRED');return snapshot}
  const match=await store.match(matchId);if(!match||match.match_id!==matchId)fail('MATCH_NOT_FOUND');
  const s=createSessionState(match,{clock,seed});
  if(monitor)s.events.push({id:'server-monitor-start',type:'monitor',at:s.startedAt});
  await store.insert(s);const snapshot=(await load(matchId)).g.snapshot();if(monitor&&!snapshot.presenceEnabled)fail('MONITOR_REQUIRED');return snapshot;
 }
 async function snapshot(matchId,uid){
  const x=await load(matchId);if(uid!==x.s.uidA&&uid!==x.s.uidB)fail('NOT_PARTICIPANT');
  return {revision:x.row.revision,state:x.g.snapshot()};
 }
 async function command(matchId,cmd){
  if(!cmd||!validId(cmd.id)||![...internalTypes,...participantTypes].includes(cmd.type))fail('INVALID_COMMAND');
  // tick and monitor are internal only. Participant UID must come from verified auth.
  const input={id:cmd.id,type:cmd.type,...(participantTypes.includes(cmd.type)?{uid:cmd.uid}:{}),...(cmd.type==='answer'?{round:cmd.round,input:cmd.input}:{})};
  const at=clock();if(!eventOK({...input,at}))fail('INVALID_COMMAND');
  for(let i=0;i<MAX_RETRIES;i++){
   const x=await load(matchId),{row,s,g}=x;
   if(participantTypes.includes(input.type)&&input.uid!==s.uidA&&input.uid!==s.uidB)fail('NOT_PARTICIPANT');
   const prior=s.events.find(e=>e.id===input.id);
   if(prior){if(!sameCommand(prior,input))fail('COMMAND_ID_CONFLICT');const r=x.outcomes.get(prior.id);
    return {revision:row.revision,replayed:true,accepted:r.accepted??null,reason:r.reason??null,state:g.snapshot()}}
   const last=s.events.at(-1)?.at??s.startedAt;
   // A concurrent committed event may have a later server time. Do not backdate commands.
   const e={...input,at:Math.max(at,last)},before=g.snapshot(),r=x.apply(e),after=g.snapshot();
   if(!changed(before,after,r))return {revision:row.revision,replayed:false,accepted:r.accepted??null,reason:r.reason??null,state:after};
   if(s.events.length>=MAX_EVENTS)fail('SESSION_EVENT_LIMIT');
   const next={...s,events:[...s.events,e]};
   if(await store.cas(matchId,row.revision,next))return {revision:row.revision+1,replayed:false,accepted:r.accepted??null,reason:r.reason??null,state:after};
  }
  fail('SESSION_RETRY_REQUIRED');
 }
 // Private result for later server-side terminal commit; not available before completion.
 async function terminal(matchId){const x=await load(matchId);return x.g.result()}
 // Internal only: result and revision from a single durable replay.
 async function terminalRecord(matchId){const x=await load(matchId);const status=x.g.snapshot().status;
  return {revision:x.row.revision,matchId:x.s.matchId,uidA:x.s.uidA,uidB:x.s.uidB,status,result:x.g.result(),termination:x.g.snapshot().termination};}
 return Object.freeze({start,snapshot,command,terminal,terminalRecord});
}
export function d1RankedSessionStore(db){
 if(!db||typeof db.prepare!=='function')fail('DB_BINDING_MISSING');
 const first=(q,...a)=>db.prepare(q).bind(...a).first();
 const run=async(q,...a)=>{const r=await db.prepare(q).bind(...a).run();if(r?.success===false)fail('SESSION_WRITE_FAILED');return r?.meta?.changes===1};
 return Object.freeze({
  match:id=>first('SELECT match_id,uid_a,uid_b,status FROM ranked_matches WHERE match_id=?',id),
  read:id=>first('SELECT match_id,revision,state_json,updated_at FROM ranked_sessions WHERE match_id=?',id),
  insert:s=>run("INSERT INTO ranked_sessions (match_id,revision,state_json,updated_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ranked_matches WHERE match_id=? AND uid_a=? AND uid_b=? AND status='active') ON CONFLICT(match_id) DO NOTHING",s.matchId,s.events.length,encode(s),s.startedAt,s.matchId,s.uidA,s.uidB),
  cas:(id,revision,s)=>run("UPDATE ranked_sessions SET revision=revision+1,state_json=?,updated_at=? WHERE match_id=? AND revision=? AND EXISTS (SELECT 1 FROM ranked_matches WHERE match_id=? AND status='active')",encode(s),s.events.at(-1).at,id,revision,id)
 });
}
