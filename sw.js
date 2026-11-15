// При установке кладём страницу в кэш (v3 - новая версия)
self.addEventListener('install', e => {
  e.waitUntil(caches.open('v3').then(c => c.addAll(['./', './index.html'])));
  self.skipWaiting();                               // не ждём закрытия старых вкладок
});
// При запуске удаляем все старые кэши, кроме v3
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(names =>
    Promise.all(names.filter(n => n != 'v3').map(n => caches.delete(n))))));
// На каждый запрос: сначала ищем в кэше, потом в сети
self.addEventListener('fetch', e =>
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
