// Server-only Firebase ID token verification. No service account or client-selected UID.
const PROJECT='futbolik-bbd9e';
const KEY_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken%40system.gserviceaccount.com';
const CERT_URL='https://www.googleapis.com/robot/v1/metadata/x509/securetoken%40system.gserviceaccount.com';
const RSA={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
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
// Extract SubjectPublicKeyInfo from Google's X.509 certificates; no trust in JWT-provided URLs.
function der(bytes,at,limit=bytes.length){
  if(at+2>limit)throw Error('DER_HEADER');const tag=bytes[at],start=at;let pos=at+1,len=bytes[pos++];
  if(len&128){const n=len&127;if(n<1||n>4||pos+n>limit)throw Error('DER_LENGTH');len=0;for(let i=0;i<n;i++)len=len*256+bytes[pos++];if(len<128)throw Error('DER_LENGTH')}
  const end=pos+len;if(end>limit)throw Error('DER_LENGTH');return {tag,start,pos,end};
}
export function certificateSpki(pem){
  if(typeof pem!=='string'||pem.length>16000||!/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(pem))throw Error('CERT_FORMAT');
  const bytes=Uint8Array.from(atob(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g,'')),c=>c.charCodeAt(0));
  const cert=der(bytes,0);if(cert.tag!==48||cert.end!==bytes.length)throw Error('CERT_FORMAT');
  const tbs=der(bytes,cert.pos,cert.end);if(tbs.tag!==48)throw Error('CERT_FORMAT');
  let p=tbs.pos;const first=der(bytes,p,tbs.end);if(first.tag===160)p=first.end;
  for(const tag of [2,48,48,48,48]){const x=der(bytes,p,tbs.end);if(x.tag!==tag)throw Error('CERT_FORMAT');p=x.end}
  const spki=der(bytes,p,tbs.end);if(spki.tag!==48)throw Error('CERT_FORMAT');
  return bytes.slice(spki.start,spki.end);
}
let cache={until:0,keys:new Map()};
function cacheAge(res){const m=(res.headers.get('cache-control')||'').match(/max-age=(\d+)/i);return Math.min(3600,Math.max(0,m?Number(m[1]):60))*1000}
export async function loadGoogleKeys(fetcher=fetch){
  for(const [source,url] of [['jwk',KEY_URL],['x509',CERT_URL]]){
    let stage='fetch';
    try{
      const res=await fetcher(url,{headers:{accept:'application/json'},redirect:'follow'});
      if(!res.ok){stage='http_'+res.status;throw Error(stage)}
      stage='json';const body=await res.json(),keys=new Map();stage='import';
      const entries=source==='jwk'?(Array.isArray(body?.keys)?body.keys.map(k=>[k?.kid,k]):[]):Object.entries(body||{});
      for(const [kid,k] of entries){
        if(typeof kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(kid))continue;
        try{
          if(source==='jwk'){
            if(k?.kty!=='RSA'||(k.alg&&k.alg!=='RS256')||(k.use&&k.use!=='sig')||typeof k.n!=='string'||typeof k.e!=='string')continue;
            keys.set(kid,await crypto.subtle.importKey('jwk',{kty:'RSA',n:k.n,e:k.e,alg:'RS256',ext:true,key_ops:['verify']},RSA,false,['verify']));
          }else keys.set(kid,await crypto.subtle.importKey('spki',certificateSpki(k),RSA,false,['verify']));
        }catch(e){/* Invalid individual keys never prevent importing other trusted keys. */}
      }
      if(!keys.size){stage='no_usable_keys';throw Error(stage)}
      return {keys,until:Date.now()+cacheAge(res),source};
    }catch(e){console.warn('ranked_auth_keys',source,stage)}
  }
  throw new AuthError('AUTH_UNAVAILABLE');
}
async function publicKeys(kid){
  if(cache.until>Date.now()&&cache.keys.has(kid))return cache.keys;
  // Workers must not share a pending fetch promise across requests.
  // A short cache miss cooldown prevents unknown-kid requests repeatedly fetching keys.
  if(cache.until>Date.now()&&Date.now()-(cache.loadedAt||0)<30000)return cache.keys;
  const next=await loadGoogleKeys();cache={...next,loadedAt:Date.now()};return cache.keys;
}
export async function verifyFirebaseToken(token,{getKeys=publicKeys,now=()=>Math.floor(Date.now()/1000)}={}){
  if(typeof token!=='string'||token.length>8192)throw new AuthError();
  const parts=token.split('.');if(parts.length!==3)throw new AuthError();
  const [h,p,s]=parts,header=json(h),payload=json(p);
  if(!header||header.alg!=='RS256'||typeof header.kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)||header.crit!==undefined)throw new AuthError();
  const claims=tokenClaims(payload,now()),keys=await getKeys(header.kid),key=keys.get(header.kid);
  if(!key||!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),utf8.encode(h+'.'+p)))throw new AuthError();
  return claims;
}
export async function authenticate(request,verify=verifyFirebaseToken){
  const auth=request.headers.get('authorization')||'',m=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(auth);
  if(!m)throw new AuthError('AUTH_REQUIRED');
  return verify(m[1]);
}
