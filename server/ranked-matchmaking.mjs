// V25.4a internal matchmaking reservation. No public API or game start.
// Caller must supply a verified UID; never use a client-provided rating or clock.
export const QUEUE_RULES=Object.freeze({baseGap:100,stepGap:50,stepMs:15000,maxGap:400,leaseMs:30000});
const uidOK=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const busy=(uid)=>`EXISTS (SELECT 1 FROM ranked_matches m WHERE (m.uid_a=${uid} OR m.uid_b=${uid}) AND (m.status='active' OR (m.status='completed' AND NOT EXISTS (SELECT 1 FROM ranked_settlements s WHERE s.match_id=m.match_id))))`;
const MATCH=`SELECT m.match_id,m.status,m.uid_a,m.uid_b FROM ranked_matches m WHERE (m.uid_a=? OR m.uid_b=?) AND (m.status='active' OR (m.status='completed' AND NOT EXISTS (SELECT 1 FROM ranked_settlements s WHERE s.match_id=m.match_id))) LIMIT 1`;
const JOIN=`INSERT INTO ranked_queue(uid,joined_at,seen_at)
 SELECT uid,?,? FROM ranked_players p WHERE uid=? AND NOT ${busy('p.uid')}
 ON CONFLICT(uid) DO UPDATE SET
 joined_at=CASE WHEN ranked_queue.seen_at<=? THEN excluded.joined_at ELSE ranked_queue.joined_at END,
 seen_at=MAX(ranked_queue.seen_at,excluded.seen_at)
 WHERE ranked_queue.seen_at<=excluded.seen_at`;
const FIND=`INSERT INTO ranked_matches(match_id,uid_a,uid_b,status,score_a,score_b,finished_at)
 SELECT ?,q.uid,r.uid,'active',NULL,NULL,NULL
 FROM ranked_queue q JOIN ranked_players a ON a.uid=q.uid
 JOIN ranked_queue r ON r.uid<>q.uid JOIN ranked_players b ON b.uid=r.uid
 WHERE q.uid=? AND q.seen_at>? AND q.seen_at<=? AND r.seen_at>? AND r.seen_at<=?
 AND NOT ${busy('q.uid')} AND NOT ${busy('r.uid')}
 AND ABS(a.rating-b.rating)<=MIN(400,100+50*CAST((?-q.joined_at)/15000 AS INTEGER))
 AND ABS(a.rating-b.rating)<=MIN(400,100+50*CAST((?-r.joined_at)/15000 AS INTEGER))
 ORDER BY ABS(a.rating-b.rating),r.joined_at,r.uid LIMIT 1`;
export function allowedGap(waitMs){
 if(!Number.isSafeInteger(waitMs)||waitMs<0)throw Error('INVALID_WAIT');
 return Math.min(QUEUE_RULES.maxGap,QUEUE_RULES.baseGap+QUEUE_RULES.stepGap*Math.floor(waitMs/QUEUE_RULES.stepMs));
}
export function createRankedMatchmaker(db,{clock=Date.now,newId=()=>globalThis.crypto.randomUUID()}={}){
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const first=(q,...a)=>db.prepare(q).bind(...a).first();
 const run=async(q,...a)=>{const r=await db.prepare(q).bind(...a).run();if(r?.success===false)throw Error('QUEUE_WRITE_FAILED');return r};
 function validate(uid){if(!uidOK(uid))throw Error('INVALID_UID')}
 function now(){const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw Error('INVALID_SERVER_CLOCK');return t}
 async function statusAt(uid,t){
  const m=await first(MATCH,uid,uid);
  if(m)return {status:m.status==='active'?'reserved':'settlement_pending',matchId:m.match_id,opponentUid:m.uid_a===uid?m.uid_b:m.uid_a};
  const q=await first('SELECT joined_at,seen_at FROM ranked_queue WHERE uid=?',uid);
  if(!q||q.seen_at<=t-QUEUE_RULES.leaseMs||q.seen_at>t)return {status:'idle'};
  const waitMs=Math.max(0,t-q.joined_at);
  return {status:'searching',waitMs,maxGap:allowedGap(waitMs)};
 }
 async function status(uid){validate(uid);return statusAt(uid,now())}
 async function join(uid){
  validate(uid);const t=now();
  if(!await first('SELECT uid FROM ranked_players WHERE uid=?',uid))throw Error('PROFILE_REQUIRED');
  await run(JOIN,t,t,uid,t-QUEUE_RULES.leaseMs);
  return statusAt(uid,t);
 }
 async function cancel(uid){
  validate(uid);const t=now();await run('DELETE FROM ranked_queue WHERE uid=?',uid);
  return statusAt(uid,t);
 }
 async function find(uid){
  validate(uid);const t=now(),before=await statusAt(uid,t);
  if(before.status!=='searching')return before;
  const id=newId();if(!idOK(id))throw Error('INVALID_MATCH_ID');
  // Pair selection, busy checks, reservation and queue consumption occur in one SQL statement.
  await run(FIND,id,uid,t-QUEUE_RULES.leaseMs,t,t-QUEUE_RULES.leaseMs,t,t,t);
  return statusAt(uid,t);
 }
 async function prune(){const t=now();await run('DELETE FROM ranked_queue WHERE seen_at<=?',t-QUEUE_RULES.leaseMs)}
 return Object.freeze({join,status,cancel,find,prune});
}
