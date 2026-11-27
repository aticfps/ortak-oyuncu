import {rankedPreviewPlay} from '../../../server/ranked-preview-api.mjs';
export function onRequest({request,env}){return rankedPreviewPlay(request,env)}
