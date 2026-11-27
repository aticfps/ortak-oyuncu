
 // V25.7: private, read-only history. Order by the player's ledger sequence,
 // not wall-clock time, so late settlement cannot distort ELO progression.
const HISTORY=`
WITH own AS (
 SELECT m.match_id AS matchId,m.finished_at AS finishedAt,s.settled_at AS settledAt,
 s.played_a_before+1 AS sequence,m.score_a AS score,m.score_b AS opponentScore,
 s.outcome AS outcome,s.rating_a_before AS ratingBefore,s.rating_a_after AS ratingAfter
 FROM ranked_matches m JOIN ranked_settlements s ON s.match_id=m.match_id
 WHERE m.uid_a=? AND m.status='completed'
 UNION ALL
 SELECT m.match_id,m.finished_at,s.settled_at,s.played_b_before+1,m.score_b,m.score_a,
 CASE s.outcome WHEN 'win' THEN 'loss' WHEN 'loss' THEN 'win' ELSE 'draw' END,
 s.rating_b_before,s.rating_b_after
 FROM ranked_matches m JOIN ranked_settlements s ON s.match_id=m.match_id
 WHERE m.uid_b=? AND m.status='completed'
)
SELECT * FROM own ORDER BY sequence DESC,matchId DESC LIMIT 21`;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export async function readRankedHistory(db,uid){
 if(typeof uid!=='string'||uid.length<1||uid.length>128)throw Error('INVALID_UID');
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const data=await db.prepare(HISTORY).bind(uid,uid).all();
 if(data?.success!==true||!Array.isArray(data.results)||data.results.length>21)throw Error('HISTORY_RESPONSE_INVALID');
 let last=Infinity;const ids=new Set();
 const matches=data.results.map(r=>{
  if(typeof r.matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.matchId)||ids.has(r.matchId)||
  !int(r.sequence,1,Number.MAX_SAFE_INTEGER)||r.sequence>=last||
  !int(r.finishedAt,1,253402300799999)||!int(r.settledAt,r.finishedAt,253402300799999)||
  !int(r.score,0,100000)||!int(r.opponentScore,0,100000)||
  r.outcome!==(r.score>r.opponentScore?'win':r.score<r.opponentScore?'loss':'draw')||
  !int(r.ratingBefore,0,100000)||!int(r.ratingAfter,0,100000)||Math.abs(r.ratingAfter-r.ratingBefore)>50)throw Error('HISTORY_RESPONSE_INVALID');
  ids.add(r.matchId);last=r.sequence;
  const {matchId,finishedAt,settledAt,sequence,score,opponentScore,outcome,ratingBefore,ratingAfter}=r;
  return {matchId,finishedAt,settledAt,sequence,score,opponentScore,outcome,ratingBefore,ratingAfter};
 });
 return {matches:matches.slice(0,20),hasMore:matches.length>20};
}
