import {sweepRanked} from './ranked-sweeper.mjs';

// Separate production Worker. Never reuse the preview binding or accept HTTP commands.
export default {
 async fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}})},
 async scheduled(_controller,env){
  if(env?.RANKED_SWEEPER_ENABLED!=='true'||env?.RANKED_SWEEPER_SCOPE!=='production'||!env?.RANKED_PRODUCTION_DB||env.RANKED_PREVIEW_DB)throw Error('PRODUCTION_SWEEPER_NOT_CONFIGURED');
  const report=await sweepRanked(env.RANKED_PRODUCTION_DB);
  console.log('ranked_production_sweep',JSON.stringify(report));
  if(report.failed)throw Error('RANKED_SWEEP_PARTIAL_FAILURE');
 }
};
