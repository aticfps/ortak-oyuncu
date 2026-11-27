// Ağ öncelikli: her zaman en güncel sürüm, bağlantı yoksa son kopya.
const C='oo-v2';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k==='oo-v1').map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||r.headers.has('authorization'))return;
  e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp)).catch(()=>{})}return res}).catch(()=>caches.match(r)));
});
