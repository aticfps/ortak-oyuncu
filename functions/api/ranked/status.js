import {rankedStatus,json} from '../../../server/ranked-foundation.mjs';
export function onRequest({request,env}){return request.method==='GET'?rankedStatus(env):json({error:'METHOD_NOT_ALLOWED'},405)}
