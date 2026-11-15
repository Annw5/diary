// Файл дневника: шифрование, чтение и запись.
// Устройство файла:  [соль 16] затем записи подряд, каждая:  [длина 4][флаг 1][iv 12][зашифрованные данные]
// Длина - это метка: по ней можно перепрыгивать записи, не читая их. Флаг = 1, если в записи есть код оформления.
import {S} from './state.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const u32 = n => new Uint8Array(new Uint32Array([n]).buffer);   // число -> 4 байта

// Из пароля и соли делаем ключ AES
const makeKey = async (pw, salt) => crypto.subtle.deriveKey(
  {name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256'},
  await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']),
  {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);

// Записываем файл целиком из кусочков
async function write(parts) {
  const w = await S.handle.createWritable();
  await w.write(new Blob(parts));
  await w.close();
  S.file = await S.handle.getFile();
}

// Идём по меткам и запоминаем, где какая запись (сами записи не читаем)
async function scan() {
  S.idx = []; S.memo = {};
  for (let pos = 16; pos < S.file.size;) {
    const head = new Uint8Array(await S.file.slice(pos, pos + 5).arrayBuffer());  // метка + флаг
    const n = new DataView(head.buffer).getUint32(0, true);
    S.idx.push({s: pos + 4, n, f: head[4]});    // s - где начинается, n - длина, f - флаг кода
    pos += 4 + n;
  }
}

// Открываем файл (создаём, если нет) и готовим ключ из пароля
export async function unlock(pw) {
  S.handle = await (await navigator.storage.getDirectory()).getFileHandle('diary3.bin', {create: true});
  S.file = await S.handle.getFile();
  if (S.file.size) S.salt = new Uint8Array(await S.file.slice(0, 16).arrayBuffer());   // старый дневник: читаем соль
  else await write([S.salt = crypto.getRandomValues(new Uint8Array(16))]);              // новый: создаём соль
  S.key = await makeKey(pw, S.salt);
  await scan();
}

// Расшифровываем запись i. Возвращает {h: содержимое, c: код оформления, p: фото}
export async function readEntry(i) {
  const {s, n} = S.idx[i];
  const b = new Uint8Array(await S.file.slice(s + 1, s + n).arrayBuffer());      // s+1: пропускаем флаг
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b.slice(0, 12)}, S.key, b.slice(12));
  const len = new DataView(plain).getUint32(0, true);                              // длина служебной строки
  const meta = JSON.parse(dec.decode(plain.slice(4, 4 + len)));
  let pos = 4 + len;                                                               // дальше фото подряд
  const p = meta.p.map(size => new Blob([plain.slice(pos, pos += size)], {type: 'image/webp'}));
  return {h: meta.h, c: meta.c, p};
}

// Сохраняем открытую запись (meta = {h, c}); фото берём из S.photos
export async function saveEntry(meta) {
  const json = enc.encode(JSON.stringify({...meta, p: S.photos.map(b => b.size)}));
  const plain = await new Blob([u32(json.length), json, ...S.photos]).arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, S.key, plain);
  const block = new Blob([u32(13 + ct.byteLength), Uint8Array.of(meta.c ? 1 : 0), iv, ct]);
  const parts = [S.salt, ...S.idx.map((e, k) => k == S.cur ? block : S.file.slice(e.s - 4, e.s + e.n))]; // чужие записи копируем как есть
  if (S.cur >= S.idx.length) parts.push(block);                                                          // новая запись - в конец
  await write(parts);
  await scan();
}
