
 // Read-only private preview leaderboard. No raw UID or Google profile data leaves the server.
const QUERY=`
WITH eligible AS (
 SELECT uid,rating,played,wins,
 RANK() OVER (ORDER BY rating DESC) AS position,
 COUNT(*) OVER () AS total
 FROM ranked_players WHERE played>0
), top AS (
 SELECT * FROM eligible ORDER BY position,uid LIMIT 20
)
SELECT *,0 AS own FROM top
UNION ALL
SELECT *,1 AS own FROM eligible WHERE uid=?
ORDER BY own,position,uid`;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
async function alias(uid){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ranked-public-v1:'+uid));
 return 'Oyuncu '+Array.from(new Uint8Array(bytes).slice(0,6),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();
}
export async function readRankedLeaderboard(db,uid){
 if(typeof uid!=='string'||uid.length<1||uid.length>128)throw Error('INVALID_UID');
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const result=await db.prepare(QUERY).bind(uid).all();
 if(result?.success!==true||!Array.isArray(result.results)||result.results.length>21)throw Error('LEADERBOARD_RESPONSE_INVALID');
 let self=null,total=0,prior=0;const rows=[],seen=new Set();
 for(const r of result.results){
  if(typeof r.uid!=='string'||!r.uid||![0,1].includes(r.own)||!int(r.rating,0,100000)||!int(r.played,1,Number.MAX_SAFE_INTEGER)||!int(r.wins,0,r.played)||!int(r.total,1,Number.MAX_SAFE_INTEGER)||!int(r.position,1,r.total)||(total&&total!==r.total))throw Error('LEADERBOARD_RESPONSE_INVALID');
  total=r.total;
  const item={name:await alias(r.uid),position:r.position,rating:r.rating,played:r.played,wins:r.wins,isSelf:r.uid===uid};
  if(r.own){if(!item.isSelf||self)throw Error('LEADERBOARD_RESPONSE_INVALID');self=item}
  else{if(seen.has(r.uid)||r.position<prior||rows.length>=20)throw Error('LEADERBOARD_RESPONSE_INVALID');seen.add(r.uid);prior=r.position;rows.push(item)}
 }
 return {rows,self,total};
}
