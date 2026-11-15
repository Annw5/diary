// Версия кэша. Изменил любой файл сайта - увеличь число, и браузеры обновят свою копию.
const V = 'v7';
const FILES = ['./', 'index.html', 'style.css', 'js/debug.js', 'js/main.js', 'js/state.js',
               'js/storage.js', 'js/entry.js', 'js/commands.js', 'js/terminal.js', 'js/ui.js'];

// Установка: кладём все файлы в кэш
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
// Активация: удаляем кэши старых версий
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n != V).map(n => caches.delete(n))))));
// Запрос: сначала ищем в кэше, потом в сети
self.addEventListener('fetch', e =>
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
