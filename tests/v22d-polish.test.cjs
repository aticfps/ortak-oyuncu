const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('const countdownRing='),html.indexOf('function tickUI(force){'));
const ring=new Function(source+';return countdownRing')();
test('V22.6 full countdown is seamless and zero hides the remaining stroke',()=>{
  for(const left of [30000,30800])assert.deepEqual(ring(left,30000),{dash:'none',offset:'0',visibility:'visible'});
  assert.deepEqual(ring(0,30000),{dash:'100 100',offset:'100',visibility:'hidden'});
  assert.deepEqual(ring(-100,30000),ring(0,30000));
});
test('V22.6 countdown progress is normalized and finite for arbitrary round durations',()=>{
  assert.deepEqual(ring(15000,30000),{dash:'100 100',offset:'50',visibility:'visible'});
  assert.equal(ring(1000,10000).offset,'90');
  for(const args of [[NaN,30000],[100,0],[100,Infinity],[Infinity,100]])assert.equal(ring(...args).visibility,'hidden');
});
test('V22.6 timer uses normalized SVG path and retains existing deadline calculation',()=>{
  assert.match(html,/<circle id="ring"[^>]*pathLength="100"/);
  assert.match(html,/const left=Math.max\(0,\(\+G.end\|\|0\)-gameNow\(\)\)/);
  assert.match(html,/rs\.strokeDasharray=ring\.dash;rs\.strokeDashoffset=ring\.offset;rs\.visibility=ring\.visibility/);
});
test('V22.6 compact responsive layout retains optical crest, focus and mobile timer rules',()=>{
  const css=html.slice(html.indexOf('/* V22.6:'),html.indexOf('</style>'));
  for(const token of ['data-club="DEP"','button:focus-visible','@media(max-width:350px)','#ans #clock svg{display:block;position:absolute;inset:0','html[data-theme="light"] #ans #clock'])assert.ok(css.includes(token),token);
  assert.match(html,/document\.body\.dataset\.screen=id/);
});
