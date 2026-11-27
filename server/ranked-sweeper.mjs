
import {recoverRankedQueue,START_GRACE_MS} from './ranked-recovery.mjs';
import {QUEUE_RULES} from './ranked-matchmaking.mjs';
import {PRESENCE_RULES} from './ranked-game.mjs';

// Small bounded batches keep cron work predictable on the preview plan.
export const SWEEP_RULES=Object.freeze({matches:3,offers:50,queue:100});
const EXPIRE=`UPDATE ranked_offers SET status='expired'
 WHERE status='pending' AND expires_at<=? AND match_id IN
 (SELECT match_id FROM ranked_offers WHERE status='pending' AND expires_at<=?
 ORDER BY expires_at,match_id LIMIT ?)`;
const PRUNE=`DELETE FROM ranked_queue WHERE seen_at<=? AND uid IN
 (SELECT uid FROM ranked_queue WHERE seen_at<=? ORDER BY seen_at,uid LIMIT ?)`;
const CANDIDATES=`SELECT m.match_id,m.uid_a,m.status
 FROM ranked_matches m JOIN ranked_offers o ON o.match_id=m.match_id
 LEFT JOIN ranked_sessions s ON s.match_id=m.match_id
 LEFT JOIN ranked_settlements l ON l.match_id=m.match_id
 WHERE o.status='accepted' AND (
 (m.status='completed' AND l.match_id IS NULL AND s.match_id IS NOT NULL)
 OR (m.status='active' AND (
 (s.match_id IS NULL AND MAX(o.accepted_a,o.accepted_b)<=?)
 OR (s.match_id IS NOT NULL AND s.updated_at<=?))))
 ORDER BY COALESCE(s.updated_at,MAX(o.accepted_a,o.accepted_b)),m.match_id LIMIT ?`;
async function write(db,q,...args){
 const r=await db.prepare(q).bind(...args).run();
 if(r?.success!==true||!Number.isSafeInteger(r.meta?.changes)||r.meta.changes<0)throw Error('SWEEP_WRITE_FAILED');
 return r.meta.changes;
}
export async function sweepRanked(db,{clock=Date.now}={}){
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw Error('INVALID_SERVER_CLOCK');
 const expiredOffers=await write(db,EXPIRE,t,t,SWEEP_RULES.offers);
 const cutoff=t-QUEUE_RULES.leaseMs;
 const prunedQueue=await write(db,PRUNE,cutoff,cutoff,SWEEP_RULES.queue);
 const selected=await db.prepare(CANDIDATES).bind(t-START_GRACE_MS,t-PRESENCE_RULES.graceMs,SWEEP_RULES.matches).all();
 if(selected?.success!==true||!Array.isArray(selected.results)||selected.results.length>SWEEP_RULES.matches)throw Error('SWEEP_READ_FAILED');
 let checked=0,failed=0;
 for(const row of selected.results){
  try{
   await recoverRankedQueue(db,null,row.uid_a,{matchId:row.match_id,status:row.status==='completed'?'settlement_pending':'reserved'},{clock:()=>t,refreshQueue:false});
   checked++;
  }catch{failed++}
 }
 return {expiredOffers,prunedQueue,selected:selected.results.length,checked,failed};
}
