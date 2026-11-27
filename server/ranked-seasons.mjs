// Read-only monthly season statistics, derived from immutable settled matches.
// Lifetime ELO is not reset; a delayed settlement belongs to the match's finish month.
export function rankedSeasonAt(now=Date.now()){
 if(!Number.isSafeInteger(now)||now<=0||now>253402300799999)throw Error('INVALID_SERVER_CLOCK');
 const d=new Date(now),y=d.getUTCFullYear(),m=d.getUTCMonth();
 const startsAt=Date.UTC(y,m,1),endsAt=Date.UTC(y,m+1,1);
 return {id:String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0'),startsAt,endsAt};
}
const READ_SEASON=String.raw`
WITH own AS (
 SELECT s.outcome AS outcome,s.rating_a_after-s.rating_a_before AS delta
 FROM ranked_matches m JOIN ranked_settlements s ON s.match_id=m.match_id
 WHERE m.uid_a=? AND m.status='completed' AND m.finished_at>=? AND m.finished_at<?
 UNION ALL
 SELECT CASE s.outcome WHEN 'win' THEN 'loss' WHEN 'loss' THEN 'win' ELSE 'draw' END,
        s.rating_b_after-s.rating_b_before
 FROM ranked_matches m JOIN ranked_settlements s ON s.match_id=m.match_id
 WHERE m.uid_b=? AND m.status='completed' AND m.finished_at>=? AND m.finished_at<?
)
SELECT EXISTS(SELECT 1 FROM ranked_players WHERE uid=?) AS registered,
 COUNT(*) AS played,COALESCE(SUM(outcome='win'),0) AS wins,
 COALESCE(SUM(outcome='draw'),0) AS draws,COALESCE(SUM(outcome='loss'),0) AS losses,
 COALESCE(SUM(delta),0) AS eloDelta FROM own
`;
export async function readRankedSeason(db,uid,{clock=Date.now}={}){
 if(typeof uid!=='string'||uid.length<1||uid.length>128)throw Error('INVALID_UID');
 if(!db||typeof db.prepare!=='function')throw Error('DB_BINDING_MISSING');
 const season=rankedSeasonAt(clock()),{startsAt,endsAt}=season;
 const row=await db.prepare(READ_SEASON).bind(uid,startsAt,endsAt,uid,startsAt,endsAt,uid).first();
 if(!row||![0,1].includes(row.registered))throw Error('SEASON_RESPONSE_INVALID');
 if(!row.registered)return {season,registered:false,stats:null};
 const {played,wins,draws,losses,eloDelta}=row;
 if(![played,wins,draws,losses].every(x=>Number.isSafeInteger(x)&&x>=0)||played!==wins+draws+losses||!Number.isSafeInteger(eloDelta))throw Error('SEASON_RESPONSE_INVALID');
 return {season,registered:true,stats:{played,wins,draws,losses,eloDelta}};
}
