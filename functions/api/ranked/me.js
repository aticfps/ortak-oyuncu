import {rankedMe} from '../../../server/ranked-foundation.mjs';
export function onRequest({request,env}){return rankedMe(request,env)}
