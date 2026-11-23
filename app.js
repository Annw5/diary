// Дневник: шифрованный файл + запись + строка команд.
// Разделы: Переменные · Тема · Файл · Запись · Вставка и команды · Строка ввода · Вход · События
const $ = id => document.getElementById(id), enc = new TextEncoder(), dec = new TextDecoder();
const u32 = n => new Uint8Array(new Uint32Array([n]).buffer);   // число -> 4 байта
const MAXSIDE = 2048;     // фото крупнее уменьшаем до такой стороны: файл меньше, слабым телефонам легче
const MAIN = 'diary3.bin', IMP = 'import.bin';   // основной файл дневника и файл, который принесла команда «импорт»
const fileName = () => sessionStorage.file || localStorage.file || MAIN;   // какой файл открывать: только сейчас, каждый раз, по умолчанию

// ---------- Переменные ----------
let sheet = null, lay = 0;   // sheet: отступы открытой записи ("1/5/2,2/7/1"), null = не в режиме листа; lay: номер последней раскладки
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

async function walk(f) {                     // идём по меткам файла f и собираем записи (сами не читаем); ok - файл похож на дневник
  const list = []; let pos = 16;
  while (pos + 5 <= f.size) {
    const head = new Uint8Array(await f.slice(pos, pos + 5).arrayBuffer());   // метка + флаг
    const n = new DataView(head.buffer).getUint32(0, true);
    list.push({s: pos + 4, n, f: head[4]});
    pos += 4 + n;
  }
  return {h: meta.h, c: meta.c, l: meta.l, p: meta.p.map(...)};
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
  cur = i; photos = e.p; rg = null; sheet = e.l || null; $('t').innerHTML = e.h;      // в show
  urls = [...$('t').querySelectorAll('img[data-i]')].map(im => im.src = URL.createObjectURL(photos[im.dataset.i])); // возвращаем фото на места

  draw();
  layout();
}
async function saveNow() {
  const t = $('t');
  if (cur >= idx.length && !t.innerText.trim() && !t.querySelector('img,table,hr,input')) return;   // пустую новую запись не сохраняем
  dirty = false;
  const imgs = [...t.querySelectorAll('img[data-i]')];
  photos = imgs.map(im => photos[im.dataset.i]);   // оставляем только фото, которые ещё есть в записи
  imgs.forEach((im, k) => im.dataset.i = k);       // и нумеруем заново
  const box = t.cloneNode(true);
  box.querySelectorAll('.pg').forEach(e => e.remove());                   // прокладки листа не храним: их пересчитает раскладка
  await saveEntry({h: box.innerHTML, c: getCode(t.innerText), l: sheet});
}
const save = () => queue = queue.catch(() => {}).then(saveNow);   // сохранения идут строго по очереди
const flush = async () => { clearTimeout(timer); if (dirty) save(); await queue; };   // дописать всё несохранённое и дождаться файла
function changed() {                         // любая правка: через 2 секунды тишины обновим оформление и сохраним
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => { deco(); layout(); save(); }, 2000);
}
async function go(i) {                       // перейти к записи i (дальше последней - новая пустая)
  if (!key || i < 0) return;
  await flush();
  if (i < idx.length) await show(i);
  else if (cur < idx.length) { cur = idx.length; photos = []; rg = null; sheet = null; $('t').innerHTML = ''; draw(); }   // в go
}

// ---------- Панель оформления текста ----------

const FONTS = ['ser', 'hand', 'tiny'];       // классы шрифтов по умолчанию
function pick() {                            // текстовые узлы внутри выделения, разрезанные по его границам
  const r = rg;                              // запомненное выделение (живое теряется, когда фокус уходит на список)
  if (r.endContainer.nodeType == 3) r.endContainer.splitText(r.endOffset);
  if (r.startContainer.nodeType == 3) r.startContainer.splitText(r.startOffset);
  const root = r.commonAncestorContainer.nodeType == 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: n =>
    n.length && r.comparePoint(n, 0) == 0 && !n.parentElement.closest('[contenteditable=false]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function wrap(apply) {
  if (!rg || rg.collapsed) return;
  const spans = pick().map(n => {
    let s = n.parentElement;
    if (!(s.classList.contains('f') && s.childNodes.length == 1)) {
      s = document.createElement('span'); s.className = 'f';
      n.replaceWith(s); s.append(n);
    }
    return s;
  });
  if (!spans.length) return;
  apply(spans);
  rg.setStartBefore(spans[0]); rg.setEndAfter(spans.at(-1));
  getSelection().removeAllRanges(); getSelection().addRange(rg);
  changed();
}

function placeBar() {
  const s = getSelection(), r = s.rangeCount && s.getRangeAt(0), b = $('bar');
  b.hidden = !(r && !r.collapsed && $('t').contains(r.commonAncestorContainer));
  if (b.hidden) return;
  const box = r.getBoundingClientRect();
  b.style.left = Math.max(4, Math.min(box.left, innerWidth - b.offsetWidth - 4)) + 'px';
  b.style.top = Math.max(4, matchMedia('(pointer:coarse)').matches ? box.bottom + 8 : box.top - b.offsetHeight - 8) + 'px';
}

const toggle = cls => wrap(sp => { const on = !sp[0].classList.contains(cls); sp.forEach(s => s.classList.toggle(cls, on)); });

$('fs').innerHTML = '<option value="">px</option>' + [12, 14, 16, 18, 24, 32, 48].map(n => `<option>${n}</option>`).join('');
$('bar').onmousedown = e => e.target.closest('button') && e.preventDefault();   // кнопки не забирают фокус; списки должны открываться, им нельзя
$('bar').onclick = e => e.target.closest('button') && toggle(e.target.closest('button').dataset.f);
$('fs').onchange = e => {
  const v = e.target.value; e.target.value = '';                                // сразу возвращаем список к заголовку
  if (v) wrap(sp => sp.forEach(s => s.style.fontSize = v + 'px'));
};
$('ff').onchange = e => {
  const v = e.target.value; e.target.value = '';
  if (v) wrap(sp => sp.forEach(s => { s.classList.remove(...FONTS); s.classList.add(v); }));
};

// ---------- Лист A4 ----------
const MM = 96 / 25.4, GAP = 16;              // пикселей в одном мм (так считает CSS); зазор между листами на экране
function margins(str) {                      // "1/5/2,2/7/1" -> поля в мм {l, r, t, b}; null, если записано неверно
  const g = str.split(',').map(p => p.split('/').map(Number));   // [[1,5,2],[2,7,1]]
  if (g.length != 2 || g.some(p => p.length != 3 || p.some(n => !(n >= 0)) || !(p[1] > 0))) return null;   // две тройки, числа не отрицательные, середина больше 0
  const [x, y] = g, kx = 210 / (x[0] + x[1] + x[2]), ky = 297 / (y[0] + y[1] + y[2]);   // сколько мм в одной доле
  return {l: x[0] * kx, r: x[2] * kx, t: y[0] * ky, b: y[2] * ky};
}
function wrapLoose(t) {                      // россыпь (текст, фото, span прямо в записи) -> в div, чтобы у каждой строки была "коробка"
  const s = getSelection(), keep = t.contains(s.anchorNode) && [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset];   // запоминаем курсор
  let run = null;                            // div, куда складываем подряд идущие россыпные куски
  for (const n of [...t.childNodes]) {
    if (n.nodeType == 1 && !getComputedStyle(n).display.startsWith('inline')) { run = null; continue; }   // это уже блок: оставляем
    if (!run) t.insertBefore(run = document.createElement('div'), n);
    run.append(n);
  }
  if (keep && keep[0] != t) s.setBaseAndExtent(...keep);   // переезд узлов сбросил курсор: возвращаем на место
}
async function layout() {                    // расставить блоки записи по листам
  const t = $('t'), m = sheet && margins(sheet), id = ++lay;   // id: если раскладка запустится снова, эта прекратится
  t.querySelectorAll('.pg').forEach(e => e.remove());          // старые прокладки убираем: считаем с нуля
  t.classList.toggle('sheet', !!m); document.body.classList.toggle('sheet', !!m);
  if (!m) return t.removeAttribute('style');                   // не лист: убираем всё, что насчитали
  const H = 297 * MM, P = H + GAP, mt = m.t * MM, mb = m.b * MM;   // высота листа, шаг между листами, верхнее и нижнее поля в px
  t.style.padding = `0 ${m.r}mm 0 ${m.l}mm`;                  // левое и правое поля
  await Promise.all([document.fonts.ready, ...[...t.querySelectorAll('img')].map(i => i.decode().catch(() => {}))]);   // ждём шрифты и фото: от них зависят высоты
  if (id != lay) return;
  wrapLoose(t);
  for (const el of [...t.children]) {                          // копия списка: прокладки, которые вставим, в обход не попадут
    const y = el.offsetTop, ht = el.offsetHeight, k = Math.floor(y / P);   // где блок и на каком он листе
    const start = k * P + mt, end = k * P + H - mb;            // где на этом листе начинается и кончается текст
    const to = y < start ? start : y + ht > end && y > start + 20 ? start + P : 0;   // куда сдвинуть блок: на начало текста / на следующий лист / не двигать
    if (!to) continue;                                         // y > start + 20: блок, который сам начинает лист и всё равно не влезает, оставляем
    const sp = document.createElement('div');
    sp.className = 'pg'; sp.contentEditable = false;
    sp.style.height = to - y + 'px';
    t.insertBefore(sp, el);
    sp.style.height = to - y + (to - el.offsetTop) + 'px';     // подгон: поля соседних блоков могли сложиться иначе
  }
  const last = t.lastElementChild, pages = Math.max(1, Math.floor(((last ? last.offsetTop + last.offsetHeight : 0) - 1) / P) + 1);
  t.style.minHeight = pages * P - GAP + 'px';                  // последний лист дорисовываем целиком
  const fit = Math.min(1, (document.documentElement.clientWidth - 16) / t.offsetWidth);   // узкий экран: лист уменьшаем по ширине
  t.style.transform = `scale(${fit})`; t.style.transformOrigin = '0 0';
  t.style.marginBottom = -(1 - fit) * t.offsetHeight + 'px';   // убираем пустоту под уменьшенным листом
}

// ---------- Вставка элементов и команды ----------
function edit(el, end) {                          // переносим ввод в запись: в el, иначе где был курсор, иначе в конец
  $('t').focus();
  const sel = getSelection();
  if (el) { sel.selectAllChildren(el); return end && sel.collapseToEnd(); }
}
function ins(x) {                            // вставляем HTML-строку или элемент и ставим курсор в первую ячейку/пункт/поле
  const frag = typeof x == 'string' ? document.createRange().createContextualFragment(x) : x;
  const first = frag.firstChild || frag, el = first.matches?.(FIRST) ? first : first.querySelector?.(FIRST);
  if (rg) { rg.collapse(false); rg.insertNode(frag); rg.collapse(false); } else $('t').append(frag);
  changed();
  edit(el, el?.className == 'chk');;
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
const CHK = '<div class="chk"><span class="cb" contenteditable="false">☐</span>&nbsp;</div>';  // строка дел: квадратик ☐ (его можно нажимать) и текст
const FIRST = 'td,li,.box,h2,.chk';          // куда ставить курсор после вставки: первая ячейка/пункт/поле/строка дел
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

// Экспорт и импорт: файл дневника переносится между устройствами как есть (он зашифрован, пароль остаётся прежним)
async function exportFile() {                // скачать текущий файл дневника
  await flush();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = 'diary-' + new Date().toISOString().slice(0, 10) + '.bin';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function importFile() {                      // выбрать файл дневника, положить рядом со старым и спросить, открывать ли его каждый раз
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    await flush();                           // сначала дописываем открытый дневник
    if (!(await walk(f)).ok) return flash('это не дневник');
    const w = await (await (await navigator.storage.getDirectory()).getFileHandle(IMP, {create: true})).createWritable();
    await w.write(f); await w.close();       // копия лежит отдельно, старое сохранение не трогаем
    const always = confirm('Открывать этот файл каждый раз?\nОК - да, он станет основным (вернуться к старому: команда «старое»).\nОтмена - открыть один раз, потом снова старое сохранение.');
    if (always) localStorage.file = IMP; else sessionStorage.file = IMP;
    location.reload();                       // заново к вводу пароля: нужен пароль импортированного файла
  };
  input.click();
}

// Команды. Чтобы добавить новую, допиши строку: слово: () => что сделать.
// Порядок важен: при вводе первых букв Enter выполнит первую подходящую команду.
const cmds = {
  фото: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true; i.onchange = () => addPhotos(i.files); i.click(); },
  таблица: (c = 3, r = 3) => ins(table(Math.min(+c, 20), Math.min(+r, 50))),   // таблица [столбцы строки]
  календарь: (m, y) => ins(calendar(m, y)),                                    // календарь [месяц год]
  список: () => ins('<ul><li>&nbsp;</li></ul>'),
  чек: () => ins(CHK),
  рандом: () => ins('<div class="rnd"><ul><li>&nbsp;</li></ul><div class="res" contenteditable="false"><button class="star">☆</button> <span></span></div></div>' + END),
  поле: () => ins('<div class="box"><br></div>' + END),
  заголовок: () => ins('<h2>Заголовок</h2>' + END),
  линия: () => ins('<hr>'),
    лист: m => {                                                 // лист [отступы]: без отступов включает или выключает режим
    if (m && !margins(m)) return flash('вид: 1/5/2,2/7/1');
    sheet = m || (sheet ? null : '1/8/1,1/8/1');
    changed(); layout();
  },
  дата: () => ins(new Date().toLocaleDateString('ru')),
  тема: () => $('th').click(),
  экспорт: exportFile,
  импорт: importFile,
  старое: async () => { await flush(); delete localStorage.file; delete sessionStorage.file; location.reload(); },   // вернуться к старому сохранению
  новая: () => go(idx.length),
  назад: () => go(cur - 1),
  вперёд: () => go(cur + 1),
  запуск: async () => { off = false; shown = null; await deco(); runScripts(); },
  стоп: () => { off = true; deco(); },
  хелп: () => $('info').hidden = !$('info').hidden      // спрятать/показать подсказку сверху
};

// ---------- Строка ввода: пароль, потом команды ----------
const HELP = 'Команды: ' + Object.keys(cmds).join(' · ') + '. Enter - выполнить первую подсказку, ↑↓ - история команд, ' +
     'Tab - писать в запись (в записи Tab или Esc - обратно), Alt+←/→ - листать записи. Параметры: таблица [столбцы строки], календарь [месяц год]. ' +   'Экспорт - скачать файл дневника, импорт - открыть другой файл дневника (с его паролем), старое - вернуться к старому сохранению. ' + 'Рандом: пиши пункты списка, кнопка ☆ выберет случайный. Стоп - отключить оформление, запуск - включить его и запустить скрипты. Хелп - спрятать или вернуть эту подсказку.';
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

const lbl = () => key ? 'терминал' : fileName() == MAIN ? 'пароль' : 'пароль импорта';   // подпись строки ввода
const flash = m => {                         // сообщение вместо подписи на секунду
  $('lab').textContent = m;
  setTimeout(() => $('lab').textContent = lbl(), 1200);
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
    handle = await (await navigator.storage.getDirectory()).getFileHandle(fileName(), {create: true});
    file = await handle.getFile();
    if (file.size) salt = new Uint8Array(await file.slice(0, 16).arrayBuffer());   // старый дневник: читаем соль
    else await write([salt = crypto.getRandomValues(new Uint8Array(16))]);          // новый: создаём соль
    key = await makeKey($('pw').value, salt);
    idx = (await walk(file)).list; memo = {};
    idx.length ? await show(idx.length - 1) : draw();                               // открываем последнюю запись
  } catch (e) {
    key = null; busy = false; setLine(); $('lab').textContent = lbl();
    if (e.name != 'OperationError') throw e; // OperationError = не расшифровалось, то есть пароль неверный
    return flash('неверно');
  }
  busy = false; setLine();
  $('lab').textContent = 'команда';          // строка пароля становится строкой команд
  $('lock').style.marginTop = 0;
  $('info').textContent = HELP;              // после входа подсказка заменяется списком команд
  $('info').hidden = true;                   // и скрыта: её показывает команда «хелп»
  $('page').style.display = 'block';
}

// ---------- События ----------
$('t').oninput = changed;
$('t').onclick = e => {
  const x = e.target;
  if (x.className == 'cb') { x.textContent = x.textContent == '☐' ? '☑' : '☐'; changed(); }   // ☐ <-> ☑: отмечаем задачу выполненной
  if (x.className == 'star') {                                                         // ☆: показываем случайный пункт списка выше
    const box = x.closest('.rnd'), items = [...box.querySelectorAll('li')].map(li => li.textContent.trim()).filter(Boolean);
    if (items.length) { box.querySelector('span').textContent = items[Math.floor(Math.random() * items.length)]; changed(); }
  }
};
$('t').onbeforeinput = e => {                // Enter в списке дел: новая строка с квадратиком (на пустой строке - выход из списка)
  const a = getSelection().anchorNode, line = (a?.closest ? a : a?.parentElement)?.closest('.chk');
  if (e.inputType != 'insertParagraph' || !line) return;
  e.preventDefault();
  const empty = !line.textContent.replace(/[☐☑]/, '').trim();   // в строке нет текста, кроме квадратика
  line.insertAdjacentHTML('afterend', empty ? END : CHK);
  const next = line.nextElementSibling;
  if (empty) line.remove();
  changed(); edit(next, !empty);
};
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
document.addEventListener('selectionchange', () => {   // запоминаем курсор в записи
  placeBar();
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
$('lab').textContent = lbl();
sync();
