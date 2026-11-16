// Офлайн-режим: файлы сайта лежат в кэше и открываются без интернета, а при наличии сети обновляются в фоне
// (новая версия сайта появится при следующем заходе). Добавил новый файл сайта - допиши его в список.
const FILES = ['./', 'index.html', 'style.css', 'app.js'];

self.addEventListener('install', e => e.waitUntil(caches.open('d').then(c => c.addAll(FILES))));
self.addEventListener('fetch', e => e.respondWith(caches.open('d').then(async c => {
  const old = await c.match(e.request);                                                           // копия из кэша
  const fresh = fetch(e.request).then(r => (r.ok && c.put(e.request, r.clone()), r)).catch(() => old); // свежая из сети
  return old || fresh;                                                                            // копия есть - отдаём сразу
})));
