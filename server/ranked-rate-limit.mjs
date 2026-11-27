
export const RATE_RULES=Object.freeze({windowMs:60000,requests:120,answers:30});
const TAKE=`
INSERT INTO ranked_request_limits(uid,window_start,requests,answers) VALUES (?,?,1,?)
ON CONFLICT(uid) DO UPDATE SET
 window_start=excluded.window_start,
 requests=CASE WHEN ranked_request_limits.window_start<excluded.window_start THEN 1 ELSE ranked_request_limits.requests+1 END,
 answers=CASE WHEN ranked_request_limits.window_start<excluded.window_start THEN excluded.answers ELSE ranked_request_limits.answers+excluded.answers END
WHERE ranked_request_limits.window_start<excluded.window_start
 OR (ranked_request_limits.window_start=excluded.window_start
 AND ranked_request_limits.requests<?
 AND ranked_request_limits.answers+excluded.answers<=?)`;
export async function takeRankedRequest(db,uid,action,{clock=Date.now}={}){
 if(typeof uid!=='string'||uid.length<1||uid.length>128)throw Error('INVALID_UID');
 if(typeof action!=='string'||!action)throw Error('INVALID_ACTION');
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const now=clock();if(!Number.isSafeInteger(now)||now<=0||now>Number.MAX_SAFE_INTEGER-RATE_RULES.windowMs)throw Error('INVALID_SERVER_CLOCK');
 const start=Math.floor(now/RATE_RULES.windowMs)*RATE_RULES.windowMs;
 const r=await db.prepare(TAKE).bind(uid,start,Number(action==='game.answer'),RATE_RULES.requests,RATE_RULES.answers).run();
 if(r?.success!==true||![0,1].includes(r?.meta?.changes))throw Error('RATE_LIMIT_WRITE_FAILED');
 return {allowed:r.meta.changes===1,retryAfter:Math.ceil((start+RATE_RULES.windowMs-now)/1000)};
}
