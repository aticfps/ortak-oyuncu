const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const auth=import('../server/ranked-auth.mjs'),api=import('../server/ranked-foundation.mjs');
const t=1700000000,uid='A'.repeat(28),other='B'.repeat(28),claims={aud:'futbolik-bbd9e',iss:'https://securetoken.google.com/futbolik-bbd9e',sub:uid,iat:t-5,exp:t+3595,auth_time:t-10,firebase:{sign_in_provider:'google.com'}};
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
test('V25.1 Firebase claims reject wrong project, expired token, invalid UID, provider and future timestamps',async()=>{
 const {tokenClaims}=await auth;assert.deepEqual(tokenClaims(claims,t),{uid});
 for(const bad of [{aud:'other'},{iss:'https://attacker.example'},{exp:t},{iat:t+1},{auth_time:t+1},{sub:''},{sub:'a/b'},{firebase:{sign_in_provider:'anonymous'}}])assert.throws(()=>tokenClaims({...claims,...bad},t),/INVALID_TOKEN/);
});
test('V25.1 verifies real RSA signatures and rejects edited identity and algorithm confusion',async()=>{
 const {verifyFirebaseToken}=await auth,keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const h=b64({alg:'RS256',kid:'test-key'}),p=b64(claims),input=h+'.'+p,sign=Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url');
 const opts={getKeys:async()=>new Map([['test-key',keys.publicKey]]),now:()=>t};
 assert.deepEqual(await verifyFirebaseToken(input+'.'+sign,opts),{uid});
 for(const token of [h+'.'+b64({...claims,sub:other})+'.'+sign,b64({alg:'none',kid:'test-key'})+'.'+p+'.'+sign,b64({alg:'HS256',kid:'test-key'})+'.'+p+'.'+sign,h+'.'+p+'.'+sign.slice(0,-10)])await assert.rejects(verifyFirebaseToken(token,opts),/INVALID_TOKEN/);
 await assert.rejects(verifyFirebaseToken(input+'.'+sign,{...opts,getKeys:async()=>new Map()}),/INVALID_TOKEN/);
});
function dbMock(){
 const rows=new Map();return {rows,prepare(sql){let args=[];return{bind(...x){args=x;return this},async run(){assert.match(sql,/ON CONFLICT\(uid\) DO NOTHING/);if(!rows.has(args[0]))rows.set(args[0],{rating:args[1],played:0,wins:0,draws:0,losses:0});return{success:true}},async first(){return rows.get(args[0])||null}}}};
}
const req=(method,body)=>new Request('https://example.test/api/ranked/me',{method,headers:{authorization:'Bearer test.token.signature'},...(body?{body:JSON.stringify(body)}:{})});
test('V25.1 profile uses verified UID, ignores submitted rating and other UID, and registration is idempotent',async()=>{
 const {rankedMe}=await api,db=dbMock(),env={RANKED_DB:db},verify=async()=>({uid});
 let r=await rankedMe(req('GET'),env,verify);assert.equal((await r.json()).registered,false);
 r=await rankedMe(req('POST',{uid:other,rating:99999,wins:999}),env,verify);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual((await r.json()).profile,{rating:1000,played:0,wins:0,draws:0,losses:0});assert.equal(db.rows.has(other),false);
 db.rows.get(uid).rating=1111;
 r=await rankedMe(req('POST',{rating:0}),env,verify);assert.equal((await r.json()).profile.rating,1111);
 r=await rankedMe(req('GET'),env,async()=>({uid:other}));assert.equal((await r.json()).registered,false);
});
test('V25.1 unauthorized and unsupported requests fail closed and do not touch DB',async()=>{
 const {rankedMe}=await api,{AuthError}=await auth,db=dbMock(),env={RANKED_DB:db};
 assert.equal((await rankedMe(new Request('https://example.test'),env)).status,401);
 assert.equal((await rankedMe(req('POST'),env,async()=>{throw new AuthError()})).status,401);
 assert.equal((await rankedMe(req('POST'),env,async()=>{throw new AuthError('AUTH_UNAVAILABLE')})).status,503);
 assert.equal((await rankedMe(req('PUT'),env,async()=>({uid}))).status,405);assert.equal(db.rows.size,0);
});
test('V25.1 missing binding or schema fails safely, ranked remains disabled even with a DB',async()=>{
 const {rankedStatus,rankedMe}=await api;
 assert.equal((await rankedStatus({})).status,503);
 assert.equal((await rankedStatus({RANKED_DB:{prepare(){throw Error('private detail')}}})).status,503);
 const r=await rankedStatus({RANKED_DB:dbMock()});assert.deepEqual(await r.json(),{version:'25.1a',ready:true,rankedEnabled:false});
 assert.equal((await rankedMe(req('POST'),{},async()=>({uid}))).status,503);
});
test('V25.1 UI does not invent ELO offline; worker never caches authenticated API requests',()=>{
 const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),sql=fs.readFileSync(path.join(root,'server','ranked-schema.sql'),'utf8');
 for(const x of ["id=\"rankGo\"","id=\"ranked\"","user.getIdToken()","Authorization:'Bearer '+token","fetch('/api/ranked/me'","id=\"rankProfile\" hidden","<button class=\"btn\" disabled>Rakip ara","Ranked.reset()"])assert.ok(html.includes(x),x);
 assert.ok(sw.includes("u.pathname.startsWith('/api/')"));assert.ok(sw.includes("r.headers.has('authorization')"));assert.match(sql,/CHECK\(played = wins \+ draws \+ losses\)/);
});

test('V25.1a Google JWK loader accepts valid public key and ignores malformed siblings',async()=>{
 const {loadGoogleKeys}=await auth,pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 let calls=0;const result=await loadGoogleKeys(async(url,opts)=>{calls++;assert.ok(url.includes('securetoken%40'));assert.equal(opts.redirect,'follow');return new Response(JSON.stringify({keys:[{kty:'RSA',kid:'bad',n:'bad',e:'AQAB'},{...jwk,kid:'good'}]}),{headers:{'cache-control':'max-age=120'}})});
 assert.equal(calls,1);assert.equal(result.source,'jwk');assert.equal(result.keys.has('good'),true);assert.ok(result.until>Date.now());
});
test('V25.1a certificate fallback extracts actual RSA SPKI and verifies signature',async()=>{
 const {loadGoogleKeys,certificateSpki}=await auth,pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const spki=Buffer.from(await webcrypto.subtle.exportKey('spki',pair.publicKey));
 // Minimal DER certificate-shaped fixture with a real SPKI; TLS establishes trust in Google's certificate feed.
 const der=(tag,body)=>Buffer.concat([Buffer.from(body.length<128?[tag,body.length]:body.length<256?[tag,129,body.length]:[tag,130,body.length>>8,body.length&255]),body]);
 const seq=body=>der(48,body),empty=seq(Buffer.alloc(0)),tbs=seq(Buffer.concat([der(160,der(2,Buffer.from([2]))),der(2,Buffer.from([1])),empty,empty,empty,empty,spki]));
 const pem='-----BEGIN CERTIFICATE-----\n'+seq(Buffer.concat([tbs,empty,der(3,Buffer.from([0]))])).toString('base64')+'\n-----END CERTIFICATE-----\n';
 assert.deepEqual(Buffer.from(certificateSpki(pem)),spki);assert.throws(()=>certificateSpki('invalid'));
 let calls=0;const result=await loadGoogleKeys(async()=>++calls===1?new Response('unavailable',{status:503}):new Response(JSON.stringify({good:pem})));
 assert.equal(calls,2);assert.equal(result.source,'x509');const msg=new TextEncoder().encode('verification');const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,msg);assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5',result.keys.get('good'),sig,msg),true);
});
test('V25.1a key service failure still refuses authentication',async()=>{
 const {loadGoogleKeys}=await auth;await assert.rejects(loadGoogleKeys(async()=>new Response('{}',{status:503})),/AUTH_UNAVAILABLE/);
});
