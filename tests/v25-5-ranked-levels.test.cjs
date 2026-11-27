const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fixture(){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
 const a=html.indexOf('const RANK_LEVEL_MIN='),b=html.indexOf('const rankedSides=',a);
 const f=new Function('$',html.slice(a,b)+';return {rankedLevel,renderRankedLevel,rankedLevelChange,renderRankedLevelNotice}')($);
 return {...f,$};
}
test('V25.5 all ten level boundaries are exact and gap-free',()=>{
 const f=fixture(),mins=[0,500,750,1000,1150,1300,1450,1600,1800,2000];
 for(let i=0;i<mins.length;i++){
  assert.equal(f.rankedLevel(mins[i]).level,i+1);
  if(i)assert.equal(f.rankedLevel(mins[i]-1).level,i);
 }
 assert.equal(f.rankedLevel(100000).level,10);
});
test('V25.5 progress is bounded and next threshold is derived from rating',()=>{
 const f=fixture();assert.deepEqual(f.rankedLevel(1075),{level:4,min:1000,next:1150,remaining:75,progress:50});
 assert.deepEqual(f.rankedLevel(2000),{level:10,min:2000,next:null,remaining:0,progress:100});
 for(let n=0;n<=100000;n+=17){const l=f.rankedLevel(n);assert.ok(l.progress>=0&&l.progress<=100)}
});
test('V25.5 invalid or unavailable rating is never rendered as a real level',()=>{
 const f=fixture();for(const n of [null,undefined,-1,1.5,'1000',NaN,100001])assert.equal(f.rankedLevel(n),null);
 f.renderRankedLevel(1000);assert.equal(f.$('rkLevelName').textContent,'Seviye 4');f.renderRankedLevel(null);
 assert.equal(f.$('rkLevelBadge').textContent,'—');assert.equal(f.$('rankRating').textContent,'—');assert.equal(f.$('rkLevelProgress').value,0);
});
test('V25.5 promotion and demotion notices only appear on a level crossing',()=>{
 const f=fixture();f.renderRankedLevelNotice({ratingBefore:1125,ratingAfter:1150});assert.equal(f.$('rkLevelNotice').textContent,'Seviye atladın! 4 → 5');assert.equal(f.$('rkLevelNotice').hidden,false);
 f.renderRankedLevelNotice({ratingBefore:1000,ratingAfter:975});assert.equal(f.$('rkLevelNotice').textContent,'Seviye düştü: 4 → 3');
 for(const s of [null,{ratingBefore:1025,ratingAfter:1050},{ratingAfter:1500}]){f.renderRankedLevelNotice(s);assert.equal(f.$('rkLevelNotice').hidden,true)}
});
test('V25.5 verified profile and server settlement feed level display, reset clears it',()=>{
 for(const x of ['renderRankedLevel(p.rating)','renderRankedLevel(p.ratingAfter)','renderRankedLevelNotice(p)','RankedPreview.reset();renderRankedLevel(null)','id="rkLevelProgress"','id="rkLevelNotice" role="status" hidden'])assert.ok(html.includes(x),x);
});
