// Explicit, mutually exclusive host gates. Pages Preview and Production must bind
// RANKED_DB to their own physical database. Never accept an arbitrary host.
export function rankedScope(request,env){
 if(!request||!env)return null;
 const u=new URL(request.url);
 if(u.protocol!=='https:'||u.port|| (request.headers.has('origin')&&request.headers.get('origin')!==u.origin))return null;
 const preview=env.RANKED_PREVIEW_ENABLED==='true',production=env.RANKED_PRODUCTION_ENABLED==='true';
 if(preview&&production)return null;
 if(production&&env.RANKED_PRODUCTION_HOST==='ortak-oyuncu.pages.dev'&&u.hostname===env.RANKED_PRODUCTION_HOST)return 'production';
 if(preview&&typeof env.RANKED_PREVIEW_HOST==='string'&&/^[a-z0-9-]+\.ortak-oyuncu\.pages\.dev$/.test(env.RANKED_PREVIEW_HOST)&&u.hostname===env.RANKED_PREVIEW_HOST)return 'preview';
 return null;
}
