// V25.3b: internal, in-memory authoritative 1v1 prototype. No HTTP or D1 writes.
// UID, clock, RNG and catalog are provided only by trusted server code.
import pinnedCatalog from './ranked-catalog.mjs';
export const RULES=Object.freeze({rounds:5,roundMs:20000,wrongMs:3000,usedMs:1500});
export const PRESENCE_RULES=Object.freeze({graceMs:45000,heartbeatMinMs:5000});
export const normalizeName=s=>s.toLocaleLowerCase('tr').replace(/ı/g,'i').replace(/ø/g,'o').replace(/ł/g,'l').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const uidOK=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const keyOf=(a,b)=>[a,b].sort().join('|');
function randomIndex(n){
 const max=2**32-(2**32%n),buf=new Uint32Array(1);
 do{globalThis.crypto.getRandomValues(buf)}while(buf[0]>=max);
 return buf[0]%n;
}
function makeCatalog(c){
 const all=[],pairs=new Map(),full=new Map(),aliases=new Map();
 const put=(map,key,p)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(p)};
 for(const x of c.players){
  const n=normalizeName(x.n);
  if(!n||all.some(p=>p.id===n))throw Error('CATALOG_PLAYER');
  const p={id:n,name:x.n,clubs:[...new Set(x.c)]};all.push(p);
  if(p.clubs.some(id=>!Object.hasOwn(c.teams,id)))throw Error('CATALOG_CLUB');
  for(const k of [n,n.replace(/ /g,'')])put(full,k,p);
  for(const k of x.keys)if(k)put(aliases,k,p);
  for(let i=0;i<p.clubs.length;i++)for(let j=i+1;j<p.clubs.length;j++){
   const k=keyOf(p.clubs[i],p.clubs[j]);if(!pairs.has(k))pairs.set(k,new Set());pairs.get(k).add(p.id);
  }
 }
 for(const id of Object.keys(c.teams))if(!Number.isSafeInteger(c.stars[id])||c.stars[id]<1||c.stars[id]>5)throw Error('CATALOG_STAR');
 return {pairs,full,aliases,stars:{...c.stars}};
}
export const ACTIVE_CLUBS=Object.freeze('GS FB BJK TS IBF RMA BAR ATM SEV VAL JUV MIL INT NAP ROM MUN MCI LIV CHE ARS BAY BVB B04 RBL SGE PSG OM OL MON LIL'.split(' '));
const activeSet=new Set(ACTIVE_CLUBS);
const defaultCatalog=makeCatalog(pinnedCatalog);
// Keep full global answer resolution, but restrict selectable pairs only.
for(const key of defaultCatalog.pairs.keys())if(!key.split('|').every(id=>activeSet.has(id)))defaultCatalog.pairs.delete(key);
export function createRankedGame({matchId,uidA,uidB},{clock=Date.now,choose=randomIndex,catalog}={}){
 if(typeof matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(matchId))throw Error('INVALID_MATCH_ID');
 if(!uidOK(uidA)||!uidOK(uidB)||uidA===uidB)throw Error('INVALID_PARTICIPANTS');
 const data=catalog?makeCatalog(catalog):defaultCatalog;
 const uids=[uidA,uidB],scores=[0,0],locks=[0,0],used=new Set(),seen=new Set(),history=[];
 let lastTime=-1,round=0,status='active',current=null,finishedAt=null;
 let presence=null,termination=null;
 function now(){const t=clock();if(!Number.isSafeInteger(t)||t<=0||t<lastTime||t>Number.MAX_SAFE_INTEGER-RULES.roundMs)throw Error('INVALID_SERVER_CLOCK');lastTime=t;return t}
 function finish(t){status='completed';current=null;finishedAt=t}
 function start(t){
  if(round>=RULES.rounds){finish(t);return}
  const pool=[...data.pairs].filter(([k,ids])=>!seen.has(k)&&[...ids].some(id=>!used.has(id)));
  if(!pool.length){status='void';current=null;finishedAt=null;return}
  const i=choose(pool.length);if(!Number.isSafeInteger(i)||i<0||i>=pool.length)throw Error('INVALID_SERVER_RNG');
  const [key,ids]=pool[i],clubs=key.split('|');seen.add(key);round++;
  current={clubs,ids,points:Math.ceil((data.stars[clubs[0]]+data.stars[clubs[1]])/2),deadline:t+RULES.roundMs};locks.fill(0);
 }
 function close(t,winner=null,player=null){
  history.push(Object.freeze({round,clubs:Object.freeze([...current.clubs]),winner,player,points:winner===null?0:current.points}));
  if(winner!==null){scores[uids.indexOf(winner)]+=current.points;used.add(player.id)}
  start(t);
 }
 // History only reveals answers after the relevant round closes.
 function snapshot(){return {matchId,status,round,scoreA:scores[0],scoreB:scores[1],current:current?{clubs:[...current.clubs],points:current.points,deadline:current.deadline}:null,
 history:history.map(h=>({...h,clubs:[...h.clubs],player:h.player?h.player.name:null})),finishedAt,
 presenceEnabled:presence!==null,termination:termination?{...termination}:null}}
 function forfeit(t,idx,reason){
  const winner=1-idx;
  // The legacy settlement schema derives outcome from scores. Preserve the
  // existing scores unless an adjustment is necessary to encode a forfeit.
  const original=[...scores];
  scores[winner]=Math.max(scores[winner],scores[idx]+1);
  termination={reason,loser:uids[idx],winner:uids[winner],scoreABefore:original[0],scoreBBefore:original[1]};
  finish(t);
 }
 function advance(t){
  if(status!=='active')return;
  if(presence){
   const expired=presence.map(seen=>t-seen>=PRESENCE_RULES.graceMs);
   if(expired.every(Boolean)){termination={reason:'BOTH_ABSENT'};status='void';current=null;finishedAt=null;return}
   if(expired.some(Boolean)){forfeit(t,expired.indexOf(true),'DISCONNECT');return}
  }
  if(t>=current.deadline)close(t);
 }
 // Trusted server admission only; never expose this command to clients.
 function monitor(){
  const t=now();
  if(status!=='active')return {accepted:false,reason:'MATCH_CLOSED'};
  if(presence)return {accepted:false,reason:'MONITOR_ALREADY_ENABLED'};
  if(round!==1||history.length||t>=current.deadline)return {accepted:false,reason:'MONITOR_TOO_LATE'};
  presence=[t,t];return {accepted:true,state:snapshot()};
 }
 function heartbeat(uid){
  const idx=uids.indexOf(uid);if(idx<0)return {accepted:false,reason:'NOT_PARTICIPANT'};
  const t=now();advance(t);
  if(status!=='active')return {accepted:false,reason:'MATCH_CLOSED'};
  if(!presence)return {accepted:false,reason:'MONITOR_NOT_ENABLED'};
  if(t-presence[idx]<PRESENCE_RULES.heartbeatMinMs)return {accepted:false,reason:'HEARTBEAT_THROTTLED'};
  presence[idx]=t;return {accepted:true,state:snapshot()};
 }
 function surrender(uid){
  const idx=uids.indexOf(uid);if(idx<0)return {accepted:false,reason:'NOT_PARTICIPANT'};
  const t=now();advance(t);
  if(status!=='active')return {accepted:false,reason:'MATCH_CLOSED'};
  forfeit(t,idx,'SURRENDER');return {accepted:true,state:snapshot()};
 }
 function tick(){const t=now();advance(t);return snapshot()}
 function answer(uid,turn,input){
  const idx=uids.indexOf(uid);
  if(idx<0)return {accepted:false,reason:'NOT_PARTICIPANT'};
  const t=now();advance(t);
  if(status!=='active')return {accepted:false,reason:'MATCH_CLOSED'};
  if(!Number.isSafeInteger(turn)||turn!==round)return {accepted:false,reason:'STALE_ROUND'};
  if(t<locks[idx])return {accepted:false,reason:'COOLDOWN'};
  if(typeof input!=='string'||input.length>100)return {accepted:false,reason:'INVALID_ANSWER'};
  const q=normalizeName(input);if(q.length<2||q.length>60)return {accepted:false,reason:'INVALID_ANSWER'};
  // Strict global resolution: no fuzzy matching or ambiguous surname guesses in ranked.
  const hits=data.full.get(q)||data.aliases.get(q);
  const p=hits?.size===1?[...hits][0]:null;
  if(!p||!current.ids.has(p.id)){locks[idx]=t+RULES.wrongMs;return {accepted:false,reason:'WRONG_ANSWER'}}
  if(used.has(p.id)){locks[idx]=t+RULES.usedMs;return {accepted:false,reason:'PLAYER_USED'}}
  close(t,uid,p);return {accepted:true,state:snapshot()};
 }
 function result(){if(status!=='completed')return null;return Object.freeze({matchId,uidA,uidB,scoreA:scores[0],scoreB:scores[1],finishedAt})}
 start(now());
 return Object.freeze({snapshot,tick,answer,monitor,heartbeat,surrender,result});
}
