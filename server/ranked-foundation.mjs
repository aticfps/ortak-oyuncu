import {authenticate,AuthError} from './ranked-auth.mjs';
import {rankedScope} from './ranked-access.mjs';
import {takeRankedRequest} from './ranked-rate-limit.mjs';
export const VERSION='25.1a',INITIAL_RATING=1000;
export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function rankedStatus(env,request){
  if(!env?.RANKED_DB)return json({version:VERSION,ready:false,rankedEnabled:false,reason:'DB_BINDING_MISSING'},503);
  try{
    await env.RANKED_DB.prepare('SELECT uid FROM ranked_players LIMIT 1').first();
    const production=rankedScope(request,env)==='production';
    if(production){
      for(const table of ['ranked_matches','ranked_offers','ranked_queue','ranked_request_limits','ranked_sessions','ranked_settlements','ranked_names'])await env.RANKED_DB.prepare('SELECT 1 FROM '+table+' LIMIT 1').first();
    }
    return json({version:VERSION,ready:true,rankedEnabled:production});
  }
  catch{return json({version:VERSION,ready:false,rankedEnabled:false,reason:'DB_SCHEMA_OR_CONNECTION'},503)}
}
export async function rankedMe(request,env,verify){
  if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405);
  const origin=request.headers.get('origin');
  if(origin!==null&&origin!==new URL(request.url).origin)return json({error:'ORIGIN_FORBIDDEN'},403);
  const scope=rankedScope(request,env);
  let identity;
  try{identity=await authenticate(request,verify)}catch(e){return json({error:e instanceof AuthError?e.code:'AUTH_UNAVAILABLE'},e?.code==='AUTH_UNAVAILABLE'||!(e instanceof AuthError)?503:401)}
  if(!env?.RANKED_DB)return json({error:'DB_BINDING_MISSING'},503);
  try{
    const db=env.RANKED_DB,uid=identity?.uid;
    if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))return json({error:'INVALID_TOKEN'},401);
    if(scope==='preview'&&!String(env.RANKED_PREVIEW_UIDS||'').split(',').map(x=>x.trim()).includes(uid))return json({error:'PREVIEW_FORBIDDEN'},403);
    if(scope){
      const budget=await takeRankedRequest(db,uid,'profile.me');
      if(!budget.allowed){const res=json({error:'RATE_LIMITED',retryAfter:budget.retryAfter},429);res.headers.set('retry-after',String(budget.retryAfter));return res;}
    }
    // Initial rating is a server constant; arbitrary input is never read or applied.
    if(request.method==='POST')await db.prepare('INSERT INTO ranked_players (uid,rating,played,wins,draws,losses,created_at) VALUES (?, ?, 0, 0, 0, 0, ?) ON CONFLICT(uid) DO NOTHING').bind(uid,INITIAL_RATING,Date.now()).run();
    const row=await db.prepare('SELECT rating,played,wins,draws,losses FROM ranked_players WHERE uid = ?').bind(uid).first();
    return json({version:VERSION,rankedEnabled:rankedScope(request,env)==='production',registered:!!row,profile:row?{rating:row.rating,played:row.played,wins:row.wins,draws:row.draws,losses:row.losses}:null});
  }catch{return json({error:'DB_SCHEMA_OR_CONNECTION'},503)}
}
