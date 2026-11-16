// Дневник: шифрованный файл + запись + строка команд.
// Разделы: Переменные · Тема · Файл · Запись · Вставка и команды · Строка ввода · Вход · События
const $ = id => document.getElementById(id), enc = new TextEncoder(), dec = new TextDecoder();
const u32 = n => new Uint8Array(new Uint32Array([n]).buffer);   // число -> 4 байта
const MAXSIDE = 2048;     // фото крупнее уменьшаем до такой стороны: файл меньше, слабым телефонам легче

// ---------- Переменные ----------
let off = false, stops = [];   // off: оформление отключено командой «стоп»; stops: функции «убрать за собой» от скриптов
let key, salt, handle, file;                 // ключ шифрования, "соль", файл diary3.bin (дескриптор и содержимое)
let idx = [], memo = {};                     // записи {s: начало, n: длина, f: есть код оформления}; запомненный код записей
let cur = 0, photos = [], urls = [], rg;     // номер открытой записи, её фото, ссылки на фото, запомненное место курсора
let dirty, timer, busy, shown = '', queue = Promise.resolve();   // есть несохранённое, таймер автосохранения, идёт вход, показанный код, очередь сохранений
const hist = []; let h = 0;                  // история команд и место в ней (h == hist.length: пустая строка)

// ---------- Тема: кнопка показывает текущую (☾ тёмная, ☼ светлая) ----------
const theme = m => { document.documentElement.dataset.theme = m; $('th').textContent = m == 'dark' ? '☾' : '☼'; localStorage.theme = m; };
theme(localStorage.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
$('th').onclick = () => theme(document.documentElement.dataset.theme == 'dark' ? 'light' : 'dark');

// ---------- Файл ----------
// Устройство:  [соль 16] затем записи подряд, каждая:  [длина 4][флаг 1][iv 12][зашифрованные данные]
// Длина - метка: по ней можно перепрыгивать записи, не читая их. Флаг = 1, если в записи есть код оформления.
const makeKey = async (pw, salt) => crypto.subtle.deriveKey(          // из пароля и соли делаем ключ AES
  {name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256'},
  await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']),
  {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);

async function write(parts) {                // записываем файл целиком из кусочков
  const w = await handle.createWritable();
  await w.write(new Blob(parts));
  await w.close();
  file = await handle.getFile();
}
async function scan() {                      // идём по меткам и запоминаем записи (сами не читаем)
  idx = []; memo = {};
  for (let pos = 16; pos < file.size;) {
    const head = new Uint8Array(await file.slice(pos, pos + 5).arrayBuffer());   // метка + флаг
    const n = new DataView(head.buffer).getUint32(0, true);
    idx.push({s: pos + 4, n, f: head[4]});
    pos += 4 + n;
  }
}
async function readEntry(i) {                // расшифровываем запись i -> {h: содержимое, c: код, p: фото}
  const {s, n} = idx[i];
  const b = new Uint8Array(await file.slice(s + 1, s + n).arrayBuffer());        // s+1: пропускаем флаг
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b.slice(0, 12)}, key, b.slice(12));
  const len = new DataView(plain).getUint32(0, true);                              // длина служебной строки
  const meta = JSON.parse(dec.decode(plain.slice(4, 4 + len)));
  let pos = 4 + len;                                                               // дальше фото подряд
  return {h: meta.h, c: meta.c, p: meta.p.map(size => new Blob([plain.slice(pos, pos += size)], {type: 'image/webp'}))};
}
async function saveEntry(meta) {             // шифруем открытую запись и кладём в файл; meta = {h, c}
  const json = enc.encode(JSON.stringify({...meta, p: photos.map(b => b.size)}));
  const plain = await new Blob([u32(json.length), json, ...photos]).arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, plain);
  const block = new Blob([u32(13 + ct.byteLength), Uint8Array.of(meta.c ? 1 : 0), iv, ct]);
  const old = idx[cur] || {s: file.size + 4, n: 0};                                // где запись лежала (новая - в конце файла)
  const parts = [salt, ...idx.map((e, k) => k == cur ? block : file.slice(e.s - 4, e.s + e.n))]; // чужие записи копируем как есть
  if (cur >= idx.length) parts.push(block);
  await write(parts);
  const n = block.size - 4;                                                        // обновляем список записей без повторного чтения файла
  idx.slice(cur + 1).forEach(e => e.s += n - old.n);
  idx[cur] = {s: old.s, n, f: meta.c ? 1 : 0};
  delete memo[cur];
}

// ---------- Запись ----------
const getCode = text => (text.match(/<<<([\s\S]*?)>>>/g) || []).map(m => m.slice(3, -3)).join('\n');  // код между <<< и >>>

const onStop = f => stops.push(f);          // скрипт оформления вызывает onStop(() => ...), чтобы зарегистрировать уборку
function stopScripts() {
  stops.forEach(f => { try { f(); } catch (e) { console.error(e); } });   // вызываем каждую уборку, ошибка в одной не мешает остальным
  stops = [];                                // список очищаем
}
function runScripts() {
  for (const old of $('deco').querySelectorAll('script')) {   // все <script> из оформления (они сейчас «мёртвые»)
    const s = document.createElement('script');                // создаём живой
    s.textContent = '(() => { try {' + old.textContent + '\n} catch (e) { alert("Ошибка в оформлении: " + e.message) } })()';
    old.replaceWith(s);                                        // подменяем: при вставке в страницу он выполняется
  }
}

async function deco() {                      // оформление: свой код записи, иначе от ближайшей предыдущей с кодом
  let code = getCode($('t').innerText);
  for (let k = cur - 1; !code && k >= 0; k--) if (idx[k].f) code = memo[k] ??= (await readEntry(k)).c;
  if (off) code = '';                        // отключено командой «стоп»: показываем без оформления
  if (code !== shown) { stopScripts(); $('deco').innerHTML = shown = code || ''; }
}
function draw() {
  $('num').textContent = (cur + 1) + ' / ' + Math.max(idx.length, cur + 1);
  deco();
}
async function show(i) {
  const e = await readEntry(i);
  urls.forEach(URL.revokeObjectURL);         // освобождаем память от фото прошлой записи
  cur = i; photos = e.p; rg = null; $('t').innerHTML = e.h;
  urls = [...$('t').querySelectorAll('img[data-i]')].map(im => im.src = URL.createObjectURL(photos[im.dataset.i])); // возвращаем фото на места
  draw();
}
async function saveNow() {
  const t = $('t');
  if (cur >= idx.length && !t.innerText.trim() && !t.querySelector('img,table,hr,input')) return;   // пустую новую запись не сохраняем
  dirty = false;
  const imgs = [...t.querySelectorAll('img[data-i]')];
  photos = imgs.map(im => photos[im.dataset.i]);   // оставляем только фото, которые ещё есть в записи
  imgs.forEach((im, k) => im.dataset.i = k);       // и нумеруем заново
  const box = t.cloneNode(true);
  box.querySelectorAll('img').forEach(im => im.removeAttribute('src'));   // ссылки на фото не храним: фото лежат отдельно
  await saveEntry({h: box.innerHTML, c: getCode(t.innerText)});
}
const save = () => queue = queue.catch(() => {}).then(saveNow);   // сохранения идут строго по очереди
function changed() {                         // любая правка: через 2 секунды тишины обновим оформление и сохраним
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => { deco(); save(); }, 2000);
}
async function go(i) {                       // перейти к записи i (дальше последней - новая пустая)
  if (!key || i < 0) return;
  clearTimeout(timer);
  if (dirty) save();
  await queue;                               // ждём, пока допишется файл
  if (i < idx.length) await show(i);
  else if (cur < idx.length) { cur = idx.length; photos = []; rg = null; $('t').innerHTML = ''; draw(); }
}

// ---------- Вставка элементов и команды ----------
function edit(el) {                          // переносим ввод в запись: в el, иначе где был курсор, иначе в конец
  $('t').focus();
  const sel = getSelection();
  if (el) return sel.selectAllChildren(el);
  sel.removeAllRanges();
  if (rg) sel.addRange(rg); else { sel.selectAllChildren($('t')); sel.collapseToEnd(); }
}
function ins(x) {                            // вставляем HTML-строку или элемент и ставим курсор в первую ячейку/пункт/поле
  const frag = typeof x == 'string' ? document.createRange().createContextualFragment(x) : x;
  const el = (frag.firstChild || frag).querySelector?.('td,li,.box,h2');
  if (rg) { rg.collapse(false); rg.insertNode(frag); rg.collapse(false); } else $('t').append(frag);
  changed();
  edit(el);
}
async function addPhotos(files) {            // фото -> уменьшить -> WebP -> в запись (в тексте остаётся номер data-i)
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const bmp = await createImageBitmap(f), k = Math.min(1, MAXSIDE / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();                             // сразу освобождаем память
    const blob = await canvas.convertToBlob({type: 'image/webp', quality: 0.9}), img = new Image();
    urls.push(img.src = URL.createObjectURL(blob));
    img.dataset.i = photos.push(blob) - 1;
    ins(img);
  }
}

const END = '<div><br></div>';               // пустая строка после элемента, чтобы можно было писать дальше
const table = (c, r) => '<table>' + ('<tr>' + '<td>&nbsp;</td>'.repeat(c) + '</tr>').repeat(r) + '</table>' + END;
function calendar(m, y) {                    // месяц m и год y (если не указаны, текущие)
  const now = new Date(), d = new Date(+y || now.getFullYear(), m ? m - 1 : now.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells = [...Array((d.getDay() + 6) % 7).fill(''), ...Array.from({length: days}, (_, i) => i + 1)]; // пустые клетки до 1-го числа (неделя с понедельника) + числа
  while (cells.length % 7) cells.push('');
  const td = x => `<td>${x || '&nbsp;'}</td>`;
  let rows = '';
  for (let i = 0; i < cells.length; i += 7) rows += '<tr>' + cells.slice(i, i + 7).map(td).join('') + '</tr>';
  const week = 'Пн Вт Ср Чт Пт Сб Вс'.split(' ').map(td).join('');
  return `<table><tr><td colspan=7>${d.toLocaleString('ru', {month: 'long', year: 'numeric'})}</td></tr><tr>${week}</tr>${rows}</table>` + END;
}
// Команды. Чтобы добавить новую, допиши строку: слово: () => что сделать.
// Порядок важен: при вводе первых букв Enter выполнит первую подходящую команду.
const cmds = {
  фото: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true; i.onchange = () => addPhotos(i.files); i.click(); },
  таблица: (c = 3, r = 3) => ins(table(Math.min(+c, 20), Math.min(+r, 50))),   // таблица [столбцы строки]
  календарь: (m, y) => ins(calendar(m, y)),                                    // календарь [месяц год]
  список: () => ins('<ul><li>&nbsp;</li></ul>'),
  чек: () => ins('<div><input type="checkbox"> &nbsp;</div>'),
  поле: () => ins('<div class="box"><br></div>' + END),
  заголовок: () => ins('<h2>Заголовок</h2>' + END),
  линия: () => ins('<hr>'),
  дата: () => ins(new Date().toLocaleDateString('ru')),
  тема: () => $('th').click(),
  новая: () => go(idx.length),
  назад: () => go(cur - 1),
  вперёд: () => go(cur + 1),
  запуск: async () => { off = false; shown = null; await deco(); runScripts(); },
  стоп: () => { off = true; deco(); },
  хелп: () => { const i = $('info'); i.textContent = HELP; i.hidden = !i.hidden; }
};

// ---------- Строка ввода: пароль, потом команды ----------
const HELP = 'Команды: ' + Object.keys(cmds).join(' · ') + '. Enter - выполнить первую подсказку, ↑↓ - история команд, ' +
  'Tab - писать в запись (в записи Tab или Esc - обратно), Alt+←/→ - листать записи. Параметры: таблица [столбцы строки], календарь [месяц год].';
const parse = () => $('pw').value.trim().toLowerCase().split(/\s+/);   // ['слово', 'число', ...]
function match(word) {                       // подходящие команды и та, что выполнится
  const list = Object.keys(cmds).filter(n => word && n.startsWith(word));
  return {list, pick: list.includes(word) ? word : list[0]};
}
function sync() {                            // настоящее поле невидимо: рисуем текст до курсора, мигающий _, текст после и подсказки
  const p = $('pw'), v = key ? p.value : '•'.repeat(p.value.length), i = p.selectionStart;   // до входа показываем точки
  $('pa').textContent = v.slice(0, i);
  $('pb').textContent = v.slice(i);
  const {list, pick} = key ? match(parse()[0]) : {list: []};
  $('hints').innerHTML = list.map(c => `<span class="${c == pick ? 'on' : ''}">${c}</span>`).join('');
}
function setLine(v = '') {                   // заменить текст в строке и поставить курсор в конец
  $('pw').value = v;
  $('pw').setSelectionRange(v.length, v.length);
  sync();
}
const flash = m => {                         // сообщение вместо слова "команда"/"пароль" на секунду
  $('lab').textContent = m;
  setTimeout(() => $('lab').textContent = key ? 'команда' : 'пароль', 1200);
};
function run() {                             // выполнить команду из строки
  const [word, ...args] = parse(), {pick} = match(word);
  setLine();
  if (!pick) return word && flash('нет такой команды');
  hist.push([pick, ...args].join(' '));      // в историю пишем полное имя, а не сокращение
  h = hist.length;
  cmds[pick](...args);
}

// ---------- Вход по паролю ----------
async function login() {
  if (busy) return;                          // повторный Enter во время входа игнорируем (на слабых телефонах вход долгий)
  busy = true; $('lab').textContent = 'проверка...';
  try {
    handle = await (await navigator.storage.getDirectory()).getFileHandle('diary3.bin', {create: true});
    file = await handle.getFile();
    if (file.size) salt = new Uint8Array(await file.slice(0, 16).arrayBuffer());   // старый дневник: читаем соль
    else await write([salt = crypto.getRandomValues(new Uint8Array(16))]);          // новый: создаём соль
    key = await makeKey($('pw').value, salt);
    await scan();
    idx.length ? await show(idx.length - 1) : draw();                               // открываем последнюю запись
  } catch (e) {
    key = null; busy = false; setLine(); $('lab').textContent = 'пароль';
    if (e.name != 'OperationError') throw e; // OperationError = не расшифровалось, то есть пароль неверный
    return flash('неверно');
  }
  busy = false; setLine();
  $('lab').textContent = 'команда';          // строка пароля становится строкой команд
  $('lock').style.marginTop = 0;
  $('info').hidden = true;                   // после входа подсказка скрыта, её показывает команда «хелп»
  $('page').style.display = 'block';
}

// ---------- События ----------
$('t').oninput = changed;
$('t').onclick = e => {                      // запоминаем галочки в списках дел
  if (e.target.type == 'checkbox') { e.target.toggleAttribute('checked', e.target.checked); changed(); }
};
$('t').onkeydown = e => { if (e.key == 'Tab') { e.preventDefault(); $('pw').focus(); } };   // Tab в записи - к командам
$('page').onclick = e => e.target == $('page') && edit();                                   // клик по пустому месту - писать
$('lock').onsubmit = e => { e.preventDefault(); key ? run() : $('pw').value && login(); };  // Enter (и кнопка "Ввод" на экранной клавиатуре)
$('lock').onclick = () => $('pw').focus();                                                  // клик по строке - ввод
document.body.onclick = () => !key && $('pw').focus();                                      // до входа клик в любом месте = ввод пароля
for (const ev of ['input', 'keyup', 'click', 'focus', 'select']) $('pw').addEventListener(ev, sync);
$('pw').onkeydown = e => {
  if (!key) return;
  if (e.key == 'Tab') { e.preventDefault(); edit(); }                           // Tab - писать в запись
  if (e.key == 'ArrowUp') { e.preventDefault(); if (h) setLine(hist[--h]); }    // назад по истории
  if (e.key == 'ArrowDown') {
    e.preventDefault();
    if (h < hist.length - 1) setLine(hist[++h]);                                // вперёд по истории
    else if (h == hist.length - 1) { h = hist.length; setLine(); }              // дошли до конца: пустая строка
    else edit();                                                                // истории больше нет: в запись
  }
};
document.onkeydown = e => {
  if (e.key == 'Escape') $('pw').focus();                                                      // Esc - в строку команд
  else if (e.altKey && /Arrow[LR]/.test(e.key)) go(cur + (e.key == 'ArrowRight' ? 1 : -1));   // Alt+стрелки - листать записи
};
document.addEventListener('selectionchange', () => {                                           // запоминаем курсор в записи
  const s = getSelection();
  if (s.rangeCount && $('t').contains(s.anchorNode)) rg = s.getRangeAt(0).cloneRange();
});
document.onvisibilitychange = () => document.hidden && dirty && save();                        // свернули вкладку: сохраняем сразу
document.ondragover = e => e.preventDefault();                                                 // фото можно перетащить на страницу
document.ondrop = e => { e.preventDefault(); addPhotos(e.dataTransfer.files); };
let x0, y0;                                                                                    // свайп: влево - дальше, вправо - назад
document.ontouchstart = e => [x0, y0] = [e.touches[0].clientX, e.touches[0].clientY];
document.ontouchend = e => {
  const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
  if (Math.abs(dx) > 100 && Math.abs(dx) > 2 * Math.abs(dy) && getSelection().isCollapsed) go(cur + (dx < 0 ? 1 : -1)); // не листаем при прокрутке и выделении
};

navigator.storage?.persist();                    // просим браузер не удалять данные сам
navigator.serviceWorker?.register('sw.js');      // офлайн-режим
sync();
