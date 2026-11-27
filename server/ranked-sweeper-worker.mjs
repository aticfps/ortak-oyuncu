
import {sweepRanked} from './ranked-sweeper.mjs';
export default {
 async fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}})},
 async scheduled(_controller,env){
  // Separate preview-only binding. No fallback to Pages or production binding.
  if(env?.RANKED_SWEEPER_ENABLED!=='true'||env?.RANKED_SWEEPER_SCOPE!=='preview'||!env?.RANKED_PREVIEW_DB)throw Error('PREVIEW_SWEEPER_NOT_CONFIGURED');
  const report=await sweepRanked(env.RANKED_PREVIEW_DB);
  console.log('ranked_preview_sweep',JSON.stringify(report));
  if(report.failed)throw Error('RANKED_SWEEP_PARTIAL_FAILURE');
 }
};
