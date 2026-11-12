// При установке кладём страницу в кэш
self.addEventListener('install', e =>
  e.waitUntil(caches.open('v2').then(c => c.addAll(['./', './index.html']))));
// На каждый запрос: сначала ищем в кэше, потом в сети
self.addEventListener('fetch', e =>
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
