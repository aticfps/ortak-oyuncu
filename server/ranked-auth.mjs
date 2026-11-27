// Server-only Firebase ID token verification. No service account or client-selected UID.
const PROJECT='futbolik-bbd9e';
const KEY_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export class AuthError extends Error {constructor(code='INVALID_TOKEN'){super(code);this.code=code}}
function decode(s){if(typeof s!=='string'||!s||!/^[A-Za-z0-9_-]+$/.test(s)||s.length%4===1)throw new AuthError();return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0))}
function json(s){try{return JSON.parse(decoder.decode(decode(s)))}catch(e){throw new AuthError()}}
export function tokenClaims(payload,t,project=PROJECT){
  if(!payload||payload.aud!==project||payload.iss!=='https://securetoken.google.com/'+project||
    typeof payload.sub!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)||
    !Number.isSafeInteger(payload.exp)||payload.exp<=t||!Number.isSafeInteger(payload.iat)||payload.iat>t||
    !Number.isSafeInteger(payload.auth_time)||payload.auth_time>t||payload.auth_time>payload.iat||
    payload.exp<=payload.iat||payload.exp-payload.iat>3700||payload.firebase?.sign_in_provider!=='google.com')throw new AuthError();
  return {uid:payload.sub};
}
let cache={until:0,keys:new Map()},loading=null;
async function publicKeys(){
  if(cache.until>Date.now())return cache.keys;
  if(!loading)loading=(async()=>{
    const res=await fetch(KEY_URL,{headers:{accept:'application/json'},redirect:'error'});
    if(!res.ok)throw new AuthError('AUTH_UNAVAILABLE');
    const body=await res.json(),keys=new Map();
    for(const k of Array.isArray(body.keys)?body.keys:[])if(k.kty==='RSA'&&typeof k.kid==='string'&&(!k.alg||k.alg==='RS256')){
      keys.set(k.kid,await crypto.subtle.importKey('jwk',k,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']));
    }
    if(!keys.size)throw new AuthError('AUTH_UNAVAILABLE');
    const age=Number((res.headers.get('cache-control')||'').match(/max-age=(\d+)/i)?.[1]||60);
    cache={keys,until:Date.now()+Math.min(3600,Math.max(1,age))*1000};return keys;
  })().catch(()=>{throw new AuthError('AUTH_UNAVAILABLE')}).finally(()=>{loading=null});
  return loading;
}
export async function verifyFirebaseToken(token,{getKeys=publicKeys,now=()=>Math.floor(Date.now()/1000)}={}){
  if(typeof token!=='string'||token.length>8192)throw new AuthError();
  const parts=token.split('.');if(parts.length!==3)throw new AuthError();
  const [h,p,s]=parts,header=json(h),payload=json(p);
  if(!header||header.alg!=='RS256'||typeof header.kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)||header.crit!==undefined)throw new AuthError();
  const claims=tokenClaims(payload,now()),keys=await getKeys(),key=keys.get(header.kid);
  if(!key||!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),utf8.encode(h+'.'+p)))throw new AuthError();
  return claims;
}
export async function authenticate(request,verify=verifyFirebaseToken){
  const auth=request.headers.get('authorization')||'',m=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(auth);
  if(!m)throw new AuthError('AUTH_REQUIRED');
  return verify(m[1]);
}
