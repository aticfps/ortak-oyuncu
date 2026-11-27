// V25.3a internal settlement only. No public route. A future authoritative
// game engine must be the sole producer of ranked_matches terminal scores.
// Never construct completed matches from browser/host claims.
import {planEloResult} from './ranked-elo.mjs';
const READ=`SELECT m.*,a.rating AS a_rating,a.played AS a_played,a.wins AS a_wins,a.draws AS a_draws,a.losses AS a_losses,
 b.rating AS b_rating,b.played AS b_played,b.wins AS b_wins,b.draws AS b_draws,b.losses AS b_losses
 FROM ranked_matches m JOIN ranked_players a ON a.uid=m.uid_a JOIN ranked_players b ON b.uid=m.uid_b WHERE m.match_id=?`;
const LEDGER='SELECT * FROM ranked_settlements WHERE match_id=?';
const WRITE=`INSERT INTO ranked_settlements
 (match_id,uid_a,uid_b,outcome,model,rating_a_before,rating_b_before,rating_a_after,rating_b_after,played_a_before,played_b_before,settled_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?
 WHERE NOT EXISTS (SELECT 1 FROM ranked_settlements WHERE match_id=?)
 AND EXISTS (SELECT 1 FROM ranked_matches m JOIN ranked_players a ON a.uid=m.uid_a JOIN ranked_players b ON b.uid=m.uid_b
 WHERE m.match_id=? AND m.status='completed' AND a.rating=? AND b.rating=? AND a.played=? AND b.played=?)`;
const get=(db,q,...args)=>db.prepare(q).bind(...args).first();
function profile(row,k){return {uid:row['uid_'+k],rating:row[k+'_rating'],played:row[k+'_played'],wins:row[k+'_wins'],draws:row[k+'_draws'],losses:row[k+'_losses']};}
export async function settleRankedMatch(db,matchId){
  if(typeof matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(matchId))throw new TypeError('INVALID_MATCH_ID');
  if(!db||typeof db.prepare!=='function')throw new TypeError('DB_BINDING_MISSING');
  for(let attempt=0;attempt<4;attempt++){
    const existing=await get(db,LEDGER,matchId);
    if(existing)return {status:'already_settled',record:existing};
    const m=await get(db,READ,matchId);
    if(!m)throw new Error('MATCH_NOT_FOUND');
    if(m.status!=='completed')throw new Error('MATCH_NOT_COMPLETED');
    if(![m.score_a,m.score_b].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)
      ||!Number.isSafeInteger(m.finished_at)||m.finished_at<=0||m.finished_at>Date.now())throw new Error('INVALID_FINAL_SCORE');
    const a=profile(m,'a'),b=profile(m,'b');
    const outcome=m.score_a>m.score_b?'win':m.score_a<m.score_b?'loss':'draw';
    const p=planEloResult(a,b,outcome);
    const result=await db.prepare(WRITE).bind(matchId,a.uid,b.uid,outcome,p.elo.model,a.rating,b.rating,p.a.rating,p.b.rating,a.played,b.played,Date.now(),
      matchId,matchId,a.rating,b.rating,a.played,b.played).run();
    if(result?.success===false)throw new Error('SETTLEMENT_WRITE_FAILED');
    const saved=await get(db,LEDGER,matchId);
    if(saved)return {status:result?.meta?.changes===1?'settled':'already_settled',record:saved};
    // Another match changed a player's snapshot: re-read both and recompute.
  }
  throw new Error('SETTLEMENT_RETRY_REQUIRED');
}
