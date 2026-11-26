const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('const Theme=(()=>{'),html.indexOf('</script>',html.indexOf('const Theme=(()=>{')));
function harness(initial,systemDark=true,blocked=false){
  const data=new Map(initial===undefined?[]:[['oo-theme',initial]]),meta={},select={},root={dataset:{}};
  const storage={getItem:k=>{if(blocked)throw Error('blocked');return data.get(k)},setItem:(k,v)=>{if(blocked)throw Error('blocked');data.set(k,v)}};
  const document={documentElement:root,querySelector:()=>meta,getElementById:()=>select};
  const mq={matches:systemDark,addEventListener:(name,fn)=>mq.change=fn};
  const Theme=new Function('localStorage','document','matchMedia',source+';return Theme')(storage,document,()=>mq);
  return {Theme,data,meta,select,root,mq};
}
test('V22.5 defaults to dark and validates saved theme preferences',()=>{
  for(const mode of [undefined,'invalid','',null]){const h=harness(mode);assert.equal(h.Theme.get(),'dark');assert.equal(h.root.dataset.theme,'dark')}
  const h=harness('light');assert.equal(h.root.dataset.theme,'light');assert.equal(h.meta.content,'#f0f3f8');
});
test('V22.5 theme changes update document, control, browser color and storage',()=>{
  const h=harness('dark');assert.equal(h.Theme.set('light'),'light');assert.equal(h.data.get('oo-theme'),'light');assert.equal(h.select.value,'light');assert.equal(h.root.dataset.themeMode,'light');assert.equal(h.meta.content,'#f0f3f8');
  assert.equal(h.Theme.set('dark'),'dark');assert.equal(h.meta.content,'#101322');assert.equal(harness(h.data.get('oo-theme')).root.dataset.theme,'dark');
});
test('V22.5 system mode follows OS changes but manual preferences do not',()=>{
  const h=harness('system',false);assert.equal(h.root.dataset.theme,'light');h.mq.matches=true;h.mq.change();assert.equal(h.root.dataset.theme,'dark');assert.equal(h.select.value,'system');
  h.Theme.set('light');h.mq.matches=true;h.mq.change();assert.equal(h.root.dataset.theme,'light');
  h.Theme.set('system');assert.equal(h.data.get('oo-theme'),'system');assert.equal(h.root.dataset.theme,'dark');
});
test('V22.5 works when local storage is unavailable',()=>{
  const h=harness(undefined,true,true);assert.equal(h.root.dataset.theme,'dark');assert.equal(h.Theme.set('light'),'light');assert.equal(h.root.dataset.theme,'light');
});
test('V22.5 theme boot runs before CSS and light theme covers main game surfaces',()=>{
  assert.ok(html.indexOf('const Theme=')<html.indexOf('<style>'));assert.match(html,/id="themeMode"/);
  const css=html.slice(html.indexOf('/* V22.5:'),html.indexOf('</style>'));
  for(const selector of ['.hero','.cards>.card.v22-create','.board','.slot.full','#nine .team','#ans .vs','#ansI','#ans .tools .jk','#res .v224-result','#end .v224-result','.pfg div','.stabs button','.ibox','.banner','.rxb button'])assert.ok(css.includes('html[data-theme="light"] '+selector),selector);
});
