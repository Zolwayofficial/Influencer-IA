// Service Worker — Avatar Control PWA
// Sin cache agresiva: el panel siempre carga del servidor (datos en tiempo real)
const CACHE = 'avatar-control-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo cachear assets estáticos del propio origen (CSS, JS, íconos, manifest)
  const isStatic = /\.(css|js|png|json|svg|woff2?)$/.test(url.pathname);
  if (e.request.method === 'GET' && isStatic && url.origin === location.origin) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached =>
          cached || fetch(e.request).then(res => { cache.put(e.request, res.clone()); return res; })
        )
      )
    );
  }
  // Todo lo demás (API calls /ctrl/, /agent/, etc.) siempre va a la red
});
