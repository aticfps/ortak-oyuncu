// V25.4c private preview transport. Production must remain disabled.
// A separate Preview D1 binding and explicitly allowlisted Google UIDs are required.
import {authenticate,AuthError} from './ranked-auth.mjs';
import {json} from './ranked-foundation.mjs';
import {createRankedMatchmaker} from './ranked-matchmaking.mjs';
import {createRankedAdmission} from './ranked-admission.mjs';
import {createRankedSessionService,d1RankedSessionStore} from './ranked-session.mjs';
import {finalizeRankedSession} from './ranked-finalization.mjs';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const clientId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const actions={
 'queue.join':[], 'queue.status':[], 'queue.find':[], 'queue.cancel':[],
 'offer.status':['matchId'], 'offer.respond':['matchId','decision'], 'offer.start':['matchId'],
 'game.poll':['matchId'], 'game.answer':['matchId','commandId','round','input'],
 'game.heartbeat':['matchId','commandId'], 'game.surrender':['matchId','commandId']
};
function enabled(request,env){
 const u=new URL(request.url),host=env?.RANKED_PREVIEW_HOST;
 // Only explicitly configured Cloudflare branch/hash preview host for this project.
 return env?.RANKED_PREVIEW_ENABLED==='true'&&typeof host==='string'&&
 /^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(host)&&u.protocol==='https:'&&u.hostname===host&&
 (!request.headers.has('origin')||request.headers.get('origin')===u.origin);
}
async function body(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw Error('INVALID_BODY');
 const stream=request.body;if(!stream)throw Error('INVALID_BODY');
 const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let count=0,raw='';
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;
   if(count>2048){await reader.cancel();throw Error('BODY_TOO_LARGE')}
   raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();
 }catch(e){if(e?.message==='BODY_TOO_LARGE')throw e;throw Error('INVALID_BODY')}
 let x;try{x=JSON.parse(raw)}catch{throw Error('INVALID_BODY')}
 if(!x||Array.isArray(x)||typeof x!=='object'||!Object.hasOwn(actions,x.action))throw Error('INVALID_ACTION');
 const fields=actions[x.action];
 if(Object.keys(x).some(k=>k!=='action'&&!fields.includes(k))||fields.some(k=>!Object.hasOwn(x,k)))throw Error('INVALID_FIELDS');
 if(fields.includes('matchId')&&!validId(x.matchId))throw Error('INVALID_MATCH_ID');
 if(fields.includes('commandId')&&!clientId(x.commandId))throw Error('INVALID_COMMAND');
 if(x.action==='offer.respond'&&!['accept','decline'].includes(x.decision))throw Error('INVALID_DECISION');
 if(x.action==='game.answer'&&(!Number.isSafeInteger(x.round)||x.round<1||x.round>5||typeof x.input!=='string'||x.input.length>100))throw Error('INVALID_COMMAND');
 return x;
}
const BAD=new Set(['INVALID_BODY','INVALID_ACTION','INVALID_FIELDS','INVALID_MATCH_ID','INVALID_COMMAND','INVALID_DECISION']);
function safeQueue(q){const {opponentUid,...rest}=q;return rest}
function safeState(s,uid,other){
 if(!s)return null;
 const side=x=>x==null?null:x===uid?'self':x===other?'opponent':null;
 return {...s,history:s.history.map(h=>({...h,winner:side(h.winner)})),termination:s.termination?{...s.termination,...('winner'in s.termination?{winner:side(s.termination.winner),loser:side(s.termination.loser)}:{})}:null};
}
function safeSettlement(r,uid){
 if(!r)return null;
 if(!r.record)return {status:r.status};
 const x=r.record,a=x.uid_a===uid;
 return {status:r.status,outcome:x.outcome==='draw'?'draw':(x.outcome==='win')===a?'win':'loss',
 ratingBefore:a?x.rating_a_before:x.rating_b_before,ratingAfter:a?x.rating_a_after:x.rating_b_after};
}
export async function rankedPreviewPlay(request,env,verify){
 if(!enabled(request,env))return json({error:'RANKED_PREVIEW_DISABLED'},404);
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 let identity;try{identity=await authenticate(request,verify)}catch(e){return json({error:e instanceof AuthError?e.code:'AUTH_UNAVAILABLE'},e?.code==='AUTH_UNAVAILABLE'||!(e instanceof AuthError)?503:401)}
 const uid=identity?.uid,allow=String(env.RANKED_PREVIEW_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(typeof uid!=='string'||!allow.includes(uid))return json({error:'PREVIEW_FORBIDDEN'},403);
 let x;try{x=await body(request)}catch(e){return json({error:e?.message==='BODY_TOO_LARGE'?'BODY_TOO_LARGE':BAD.has(e?.message)?e.message:'INVALID_BODY'},e?.message==='BODY_TOO_LARGE'?413:400)}
 const db=env.RANKED_DB;if(!db)return json({error:'DB_BINDING_MISSING'},503);
 try{
  const q=createRankedMatchmaker(db),admission=createRankedAdmission(db),sessions=createRankedSessionService(d1RankedSessionStore(db));
  if(x.action.startsWith('queue.')){
   // Only authorized preview accounts may enter through this transport.
   return json(safeQueue(await q[x.action.split('.')[1]](uid)));
  }
  const row=await db.prepare('SELECT uid_a,uid_b,status FROM ranked_matches WHERE match_id=?').bind(x.matchId).first();
  if(!row||![row.uid_a,row.uid_b].includes(uid))return json({error:'MATCH_NOT_FOUND'},404);
  const other=row.uid_a===uid?row.uid_b:row.uid_a;
  if(!allow.includes(other))return json({error:'PREVIEW_FORBIDDEN'},403);
  if(x.action==='offer.status')return json(await admission.status(x.matchId,uid));
  if(x.action==='offer.respond')return json(await admission.respond(x.matchId,uid,x.decision));
  if(x.action==='offer.start'){
   const r=await admission.start(x.matchId,uid);
   return json({...r,state:safeState(r.state,uid,other),side:row.uid_a===uid?'a':'b'});
  }
  // Verify participant and bilateral admission before any internal tick or command.
  const offer=await admission.status(x.matchId,uid);
  if(offer.status!=='accepted')return json({error:'OFFER_NOT_ACCEPTED'},409);
  const existing=await sessions.snapshot(x.matchId,uid);
  let r=existing;
  if(existing.state.status==='active'){
   if(row.status!=='active')return json({error:'MATCH_NOT_ACTIVE'},409);
   if(x.action==='game.poll')r=await sessions.command(x.matchId,{id:'server-tick-'+crypto.randomUUID(),type:'tick'});
   else{
    const type=x.action.split('.')[1],id=(row.uid_a===uid?'pa_':'pb_')+x.commandId;
    r=await sessions.command(x.matchId,{id,type,uid,...(type==='answer'?{round:x.round,input:x.input}:{})});
   }
  }
  const settlement=r.state.status==='active'?null:await finalizeRankedSession(db,x.matchId);
  return json({...r,state:safeState(r.state,uid,other),side:row.uid_a===uid?'a':'b',settlement:safeSettlement(settlement,uid)});
 }catch(e){
  const code=e?.message;
  if(['OFFER_NOT_FOUND','MATCH_NOT_FOUND','SESSION_NOT_FOUND'].includes(code))return json({error:'MATCH_NOT_FOUND'},404);
  if(code==='NOT_PARTICIPANT')return json({error:'MATCH_NOT_FOUND'},404);
  if(['PROFILE_REQUIRED','OFFER_NOT_ACCEPTED','MATCH_NOT_ACTIVE','COMMAND_ID_CONFLICT','SESSION_RETRY_REQUIRED','SETTLEMENT_RETRY_REQUIRED','FINALIZATION_RETRY_REQUIRED'].includes(code))return json({error:code},409);
  return json({error:'RANKED_PREVIEW_UNAVAILABLE'},503);
 }
}
