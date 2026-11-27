// V25.3e internal finalization. Never call with a browser-provided score.
// The durable game replay is the only source of the final result.
import {createRankedSessionService,d1RankedSessionStore} from './ranked-session.mjs';
import {settleRankedMatch} from './ranked-settlement.mjs';
const MATCH='SELECT * FROM ranked_matches WHERE match_id=?';
const COMPLETE="UPDATE ranked_matches SET status='completed',score_a=?,score_b=?,finished_at=? WHERE match_id=? AND uid_a=? AND uid_b=? AND status='active' AND EXISTS (SELECT 1 FROM ranked_sessions WHERE match_id=? AND revision=?)";
const VOID="UPDATE ranked_matches SET status='void' WHERE match_id=? AND uid_a=? AND uid_b=? AND status='active' AND EXISTS (SELECT 1 FROM ranked_sessions WHERE match_id=? AND revision=?)";
const first=(db,q,...a)=>db.prepare(q).bind(...a).first();
async function write(db,q,...a){const r=await db.prepare(q).bind(...a).run();if(r?.success===false)throw Error('FINALIZATION_WRITE_FAILED');}
export async function finalizeRankedSession(db,matchId){
 if(typeof matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(matchId))throw Error('INVALID_MATCH_ID');
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const match=await first(db,MATCH,matchId);if(!match)throw Error('MATCH_NOT_FOUND');
 const session=createRankedSessionService(d1RankedSessionStore(db));
 const t=await session.terminalRecord(matchId);
 if(t.matchId!==match.match_id||t.uidA!==match.uid_a||t.uidB!==match.uid_b)throw Error('SESSION_PARTICIPANT_MISMATCH');
 if(t.status==='active'){
  if(match.status!=='active')throw Error('TERMINAL_STATE_MISMATCH');
  return {status:'pending'};
 }
 if(t.status==='void'){
  if(match.status==='completed')throw Error('TERMINAL_STATE_MISMATCH');
  if(match.status==='active')await write(db,VOID,matchId,t.uidA,t.uidB,matchId,t.revision);
  const saved=await first(db,MATCH,matchId);
  if(saved?.status!=='void'||saved.uid_a!==t.uidA||saved.uid_b!==t.uidB)throw Error('FINALIZATION_RETRY_REQUIRED');
  return {status:'void'};
 }
 const r=t.result;
 if(t.status!=='completed'||!r||r.matchId!==matchId||r.uidA!==t.uidA||r.uidB!==t.uidB||
 ![r.scoreA,r.scoreB].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||
 !Number.isSafeInteger(r.finishedAt)||r.finishedAt<=0||r.finishedAt>Date.now())throw Error('INVALID_FINAL_SCORE');
 if(match.status==='void')throw Error('TERMINAL_STATE_MISMATCH');
 if(match.status==='active')await write(db,COMPLETE,r.scoreA,r.scoreB,r.finishedAt,matchId,t.uidA,t.uidB,matchId,t.revision);
 const saved=await first(db,MATCH,matchId);
 if(!saved||saved.status!=='completed')throw Error('FINALIZATION_RETRY_REQUIRED');
 if(saved.uid_a!==r.uidA||saved.uid_b!==r.uidB||saved.score_a!==r.scoreA||saved.score_b!==r.scoreB||saved.finished_at!==r.finishedAt)throw Error('FINAL_SCORE_MISMATCH');
 // Two recoverable phases: durable immutable score first, atomic ledger + both ELOs next.
 // If the second phase fails, retry the same match ID. No partial player updates.
 return settleRankedMatch(db,matchId);
}
