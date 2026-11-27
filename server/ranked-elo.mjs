// V25.2: server-only, pure competitive Elo calculation.
// Not an authorization or settlement API. Never trust client-supplied outcomes.
export const ELO_K=50, MIN_RATING=0, MAX_RATING=100000;
export const ELO_MODEL='elo-v1-k50';
function rating(value){
  if(!Number.isSafeInteger(value)||value<MIN_RATING||value>MAX_RATING)throw new RangeError('INVALID_RATING');
  return value;
}
export function expectedScore(own,opponent){
  rating(own);rating(opponent);
  return 1/(1+10**((opponent-own)/400));
}
// outcome is from A's perspective. One rounded transfer, symmetric and zero-sum.
export function calculateElo(a,b,outcome){
  rating(a);rating(b);
  if(!['win','draw','loss'].includes(outcome))throw new RangeError('INVALID_OUTCOME');
  const actual=outcome==='win'?1:outcome==='draw'?0.5:0;
  const expected=expectedScore(a,b);
  const raw=ELO_K*(actual-expected);
  const rounded=Math.sign(raw)*Math.round(Math.abs(raw));
  // Both ratings must stay within the DB schema bounds. Do not create/destroy points at a cap.
  const low=Math.max(MIN_RATING-a,b-MAX_RATING);
  const high=Math.min(MAX_RATING-a,b-MIN_RATING);
  const deltaA=Math.max(low,Math.min(high,rounded))||0;
  return Object.freeze({model:ELO_MODEL,expectedA:expected,deltaA,deltaB:-deltaA||0,ratingA:a+deltaA,ratingB:b-deltaA});
}
const counters=['played','wins','draws','losses'];
function profile(p){
  if(!p||typeof p.uid!=='string'||p.uid.length<1||p.uid.length>128)throw new TypeError('INVALID_PLAYER');
  rating(p.rating);
  for(const k of counters)if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>=Number.MAX_SAFE_INTEGER)throw new RangeError('INVALID_STATS');
  if(p.played!==p.wins+p.draws+p.losses)throw new RangeError('INVALID_STATS');
  return p;
}
function next(p,newRating,outcome){
  return Object.freeze({uid:p.uid,rating:newRating,played:p.played+1,wins:p.wins+Number(outcome==='win'),draws:p.draws+Number(outcome==='draw'),losses:p.losses+Number(outcome==='loss')});
}
// Internal future settlement planner. No DB writes, no endpoint, no mutable state.
// V25.3 must supply an authoritative result and atomically enforce a unique match
// ledger and compare-and-set player versions before persisting either player.
export function planEloResult(a,b,outcome){
  profile(a);profile(b);
  if(a.uid===b.uid)throw new RangeError('SAME_PLAYER');
  const elo=calculateElo(a.rating,b.rating,outcome);
  const inverse=outcome==='win'?'loss':outcome==='loss'?'win':'draw';
  return Object.freeze({elo,a:next(a,elo.ratingA,outcome),b:next(b,elo.ratingB,inverse)});
}
