
 // V26.0a recovery shared by authenticated queue access and internal cron.
import {createRankedSessionService,d1RankedSessionStore} from './ranked-session.mjs';
import {finalizeRankedSession} from './ranked-finalization.mjs';
export const START_GRACE_MS=120000;
const first=(db,q,...a)=>db.prepare(q).bind(...a).first();
export async function recoverRankedQueue(db,queue,uid,entry,{clock=Date.now,refreshQueue=true}={}){
 if(!entry||!['reserved','settlement_pending'].includes(entry.status))return entry;
 const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw Error('INVALID_SERVER_CLOCK');
 const id=entry.matchId;
 const row=await first(db,`SELECT m.status,m.uid_a,m.uid_b,o.status AS offer_status,o.accepted_a,o.accepted_b,
 s.revision,s.updated_at
 FROM ranked_matches m JOIN ranked_offers o ON o.match_id=m.match_id
 LEFT JOIN ranked_sessions s ON s.match_id=m.match_id WHERE m.match_id=?`,id);
 if(!row||![row.uid_a,row.uid_b].includes(uid))return refreshQueue?queue.status(uid):null;
 if(row.offer_status!=='accepted')return entry;
 if(row.revision==null){
  if(row.status!=='active')return refreshQueue?queue.status(uid):null;
  if(!Number.isSafeInteger(row.accepted_a)||!Number.isSafeInteger(row.accepted_b))throw Error('INVALID_OFFER');
  if(t-Math.max(row.accepted_a,row.accepted_b)<START_GRACE_MS)return entry;
  // Do not race a session creation: the absence check and void are atomic.
  const result=await db.prepare(`UPDATE ranked_matches SET status='void'
   WHERE match_id=? AND status='active' AND (uid_a=? OR uid_b=?)
   AND EXISTS (SELECT 1 FROM ranked_offers o WHERE o.match_id=? AND o.status='accepted'
      AND MAX(o.accepted_a,o.accepted_b)<=?)
   AND NOT EXISTS (SELECT 1 FROM ranked_sessions s WHERE s.match_id=?)`)
   .bind(id,uid,uid,id,t-START_GRACE_MS,id).run();
  if(result?.success===false)throw Error('RECOVERY_WRITE_FAILED');
  return refreshQueue?queue.status(uid):null;
 }
 const sessions=createRankedSessionService(d1RankedSessionStore(db),{clock});
 let r=await sessions.snapshot(id,uid);
 if(r.state.status==='active'){
  if(row.status!=='active')throw Error('TERMINAL_STATE_MISMATCH');
  // Tick only from the durable journal, never synthesize scores or presence.
  if(t-row.updated_at<45000)return entry;
  r=await sessions.command(id,{id:'recovery-'+crypto.randomUUID(),type:'tick'});
 }
 if(r.state.status==='active')return entry;
 await finalizeRankedSession(db,id);
 // Return the terminal session once so a returning player can see the result.
 // A later queue request sees idle because the match is no longer busy.
 return {...entry,status:'settlement_pending'};
}
