// Internal only. Participant UID is supplied by a trusted authenticated boundary.
import {createRankedSessionService,d1RankedSessionStore} from './ranked-session.mjs';
export const ACCEPT_MS=20000;
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const validUid=x=>typeof x==='string'&&x.length>0&&x.length<=128;
export function createRankedAdmission(db,{clock=Date.now,seed}={}){
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const first=(q,...a)=>db.prepare(q).bind(...a).first();
 const run=async(q,...a)=>{const r=await db.prepare(q).bind(...a).run();if(r?.success===false)throw Error('OFFER_WRITE_FAILED');return r};
 const sessions=createRankedSessionService(d1RankedSessionStore(db),{clock,seed});
 function now(){const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw Error('INVALID_SERVER_CLOCK');return t}
 async function load(id,uid){
  if(!validId(id)||!validUid(uid))throw Error('INVALID_OFFER_REQUEST');
  const row=await first('SELECT * FROM ranked_offers WHERE match_id=?',id);
  if(!row||![row.uid_a,row.uid_b].includes(uid))throw Error('OFFER_NOT_FOUND');
  return row;
 }
 function view(row,uid,t){const own=row.uid_a===uid?'a':'b',other=own==='a'?'b':'a';
  return {matchId:row.match_id,status:row.status,expiresAt:row.expires_at,remainingMs:row.status==='pending'?Math.max(0,row.expires_at-t):0,accepted:row['accepted_'+own]!==null,opponentAccepted:row['accepted_'+other]!==null};
 }
 async function expire(id,t){await run("UPDATE ranked_offers SET status='expired' WHERE match_id=? AND status='pending' AND expires_at<=?",id,t)}
 async function status(id,uid){
  await load(id,uid);const t=now();await expire(id,t);return view(await load(id,uid),uid,t);
 }
 async function respond(id,uid,decision){
  if(!['accept','decline'].includes(decision))throw Error('INVALID_DECISION');
  await load(id,uid);const t=now();await expire(id,t);
  if(decision==='decline'){
   await run("UPDATE ranked_offers SET status='declined' WHERE match_id=? AND status='pending' AND created_at<=? AND expires_at>? AND (uid_a=? OR uid_b=?)",id,t,t,uid,uid);
  }else{
   await run(`UPDATE ranked_offers SET
    accepted_a=CASE WHEN uid_a=? THEN COALESCE(accepted_a,?) ELSE accepted_a END,
    accepted_b=CASE WHEN uid_b=? THEN COALESCE(accepted_b,?) ELSE accepted_b END,
    status=CASE WHEN (uid_a=? OR accepted_a IS NOT NULL) AND (uid_b=? OR accepted_b IS NOT NULL) THEN 'accepted' ELSE 'pending' END
    WHERE match_id=? AND status='pending' AND created_at<=? AND expires_at>? AND (uid_a=? OR uid_b=?)`,uid,t,uid,t,uid,uid,id,t,t,uid,uid);
  }
  const row=await load(id,uid);
  return view(row,uid,t);
 }
 async function start(id,uid){
  const row=await load(id,uid);if(row.status!=='accepted')throw Error('OFFER_NOT_ACCEPTED');
  const match=await first('SELECT status FROM ranked_matches WHERE match_id=?',id);
  if(!match||match.status!=='active')throw Error('MATCH_NOT_ACTIVE');
  // Initial monitor event and session are inserted together; retries load the same game.
  await sessions.start(id,{monitor:true});
  return sessions.snapshot(id,uid);
 }
 return Object.freeze({status,respond,start});
}
