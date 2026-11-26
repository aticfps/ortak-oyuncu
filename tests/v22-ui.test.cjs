const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const markup=html.slice(0,html.indexOf('<script src=')).split('</style>')[0];
const body=html.slice(html.indexOf('<body>'),html.lastIndexOf('</body>'));
const ids=[...body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const css=html.slice(html.indexOf('/* V22: compact sports studio theme'),html.indexOf('</style>'));
test('V22 lobby keeps required controls and mode cards',()=>{
  for(const id of ['lobby','gIn','gOut','whoName','myName','create','joinF','code','joinB','watchB','botL','botGo','dGo','pfGo','seasonT','howB'])assert.ok(ids.includes(id),id);
  for(const mode of ['v22-create','v22-join','v22-bot','v22-daily'])assert.ok(body.includes('class="card '+mode+'"'),mode);
});
test('gameplay screens and control IDs survive the design update',()=>{
  for(const id of ['wait','pick','rev','ans','res','end','board','chips','rd','slots','start','addBot','nine','tA','tB','clock','aSec','ansF','ansI','ansGo','jkB','ipB','obj','next','again'])assert.ok(ids.includes(id),id);
  assert.match(html,/\[hidden\]\{display:none!important\}/);
});
test('responsive V22 style includes mobile fallback, safe area and reduced motion',()=>{
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/@media\(max-width:350px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/viewport-fit=cover/);
});
test('V22 match theme retains selection, disabled and countdown states',()=>{
  for(const selector of ['.team.mypick','.team:disabled','.btn:disabled','.clock.low #ring','.chip.me','.slot.full'])assert.ok(css.includes(selector),selector);
  assert.match(css,/--flood:#b8f568/);
});
