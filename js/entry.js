// Запись: показ, оформление, сохранение, переходы, вставка элементов.
import {$, S} from './state.js';
import {readEntry, saveEntry} from './storage.js';

let shownCode = '';   // оформление, которое сейчас применено

// ---------- Оформление: код между <<< и >>> ----------
export const getCode = text => (text.match(/<<<([\s\S]*?)>>>/g) || []).map(m => m.slice(3, -3)).join('\n');

// Применяем код этой записи, а если его нет - код ближайшей предыдущей записи с кодом
export async function deco() {
  let code = getCode($('t').innerText);
  for (let k = S.cur - 1; !code && k >= 0; k--)
    if (S.idx[k].f) code = S.memo[k] ??= (await readEntry(k)).c;
  if (code !== shownCode) $('deco').innerHTML = shownCode = code || '';   // меняем только при изменении (без мигания)
}

// ---------- Показ ----------
export function draw() {
  $('num').textContent = (S.cur + 1) + ' / ' + Math.max(S.idx.length, S.cur + 1);
  deco();
}
export async function show(i) {
  const e = await readEntry(i);
  S.cur = i; S.photos = e.p; S.rg = null;
  $('t').innerHTML = e.h;
  $('t').querySelectorAll('img[data-i]').forEach(im => im.src = URL.createObjectURL(S.photos[im.dataset.i])); // возвращаем фото на места
  draw();
}

// ---------- Сохранение ----------
async function save() {
  const t = $('t');
  if (!t.innerText.trim() && !t.querySelector('img,table,hr,input')) return;   // пустое не сохраняем
  const imgs = [...t.querySelectorAll('img[data-i]')];
  S.photos = imgs.map(im => S.photos[im.dataset.i]);   // оставляем только фото, которые ещё есть в записи
  imgs.forEach((im, k) => im.dataset.i = k);           // и нумеруем заново
  const box = t.cloneNode(true);
  box.querySelectorAll('img').forEach(im => im.removeAttribute('src'));   // ссылки на фото не храним: фото лежат отдельно
  await saveEntry({h: box.innerHTML, c: getCode(t.innerText)});
  S.dirty = false;
}
function changed() {            // любая правка: сохраним через 1.5 секунды тишины
  S.dirty = true;
  clearTimeout(S.timer);
  S.timer = setTimeout(save, 1500);
  deco();
}

// ---------- Переходы между записями ----------
export async function go(i) {
  if (!S.key || i < 0) return;
  clearTimeout(S.timer);
  if (S.dirty) await save();
  if (i < S.idx.length) await show(i);
  else if (S.cur < S.idx.length) {   // дальше последней: новая пустая запись
    S.cur = S.idx.length; S.photos = []; S.rg = null;
    $('t').innerHTML = '';
    draw();
  }
}

// ---------- Курсор и вставка элементов ----------
// Переносим ввод в запись: в элемент el, иначе туда, где был курсор, иначе в конец
export function edit(el) {
  $('t').focus();
  const sel = getSelection();
  if (el) return sel.selectAllChildren(el);
  sel.removeAllRanges();
  if (S.rg) sel.addRange(S.rg); else { sel.selectAllChildren($('t')); sel.collapseToEnd(); }
}
// Вставляем HTML-строку или элемент и ставим курсор в первую ячейку/пункт/поле
export function ins(x) {
  const frag = typeof x == 'string' ? document.createRange().createContextualFragment(x) : x;
  const el = (frag.firstChild || frag).querySelector?.('td,li,.box,h2');
  if (S.rg) { S.rg.collapse(false); S.rg.insertNode(frag); S.rg.collapse(false); } else $('t').append(frag);
  changed();
  edit(el);
}
// Фото -> WebP -> в запись (в списке S.photos; в тексте остаётся только номер data-i)
export async function addPhotos(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const bmp = await createImageBitmap(f), canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await canvas.convertToBlob({type: 'image/webp', quality: 0.9}), img = new Image();
    img.src = URL.createObjectURL(blob);
    img.dataset.i = S.photos.push(blob) - 1;
    ins(img);
  }
}

// ---------- Подключаем события ----------
$('t').oninput = changed;
$('t').onclick = e => {                  // запоминаем галочки в списках дел
  if (e.target.type == 'checkbox') { e.target.toggleAttribute('checked', e.target.checked); changed(); }
};
$('t').onkeydown = e => { if (e.key == 'Tab') { e.preventDefault(); $('pw').focus(); } };   // Tab - к командам
$('page').onclick = e => e.target == $('page') && edit();                                   // клик по пустому месту - писать
document.addEventListener('selectionchange', () => {                                        // запоминаем курсор в записи
  const sel = getSelection();
  if (sel.rangeCount && $('t').contains(sel.anchorNode)) S.rg = sel.getRangeAt(0).cloneRange();
});
document.ondragover = e => e.preventDefault();                                              // фото можно перетащить на страницу
document.ondrop = e => { e.preventDefault(); addPhotos(e.dataTransfer.files); };
