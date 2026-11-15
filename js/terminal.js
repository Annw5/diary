// Строка пароля и команд: рисует текст с курсором _, подсказки, историю, вход.
import {$, S} from './state.js';
import {unlock} from './storage.js';
import {show, draw, edit} from './entry.js';
import {cmds} from './commands.js';

const HELP = 'Команды: фото · таблица [столбцы строки] · календарь [месяц год] · список · чек · поле · заголовок · линия · дата · тема · новая · назад · вперёд. ' +
  'Enter - выполнить первую подсказку, ↑↓ - история команд, Tab - писать в запись (в записи Tab или Esc - обратно), Alt+←/→ - листать записи.';
const names = Object.keys(cmds);   // все команды
const hist = [];                   // история введённых команд
let h = 0;                         // где мы в истории (h == hist.length: в конце, на пустой строке)

// ---------- Разбор строки ----------
const parse = () => $('pw').value.trim().toLowerCase().split(/\s+/);     // ['слово', 'число', ...]
function match(word) {                                                   // подходящие команды и та, что выполнится
  const list = names.filter(n => word && n.startsWith(word));
  return {list, pick: list.includes(word) ? word : list[0]};
}

// ---------- Отрисовка ----------
// Настоящее поле невидимо: рисуем текст до курсора, мигающий _ и текст после; под ними подсказки
export function sync() {
  const p = $('pw'), v = S.key ? p.value : '•'.repeat(p.value.length), i = p.selectionStart;   // до входа показываем точки
  $('pa').textContent = v.slice(0, i);
  $('pb').textContent = v.slice(i);
  const {list, pick} = S.key ? match(parse()[0]) : {list: []};
  $('hints').innerHTML = list.map(c => `<span class="${c == pick ? 'on' : ''}">${c}</span>`).join('');
}
function setLine(v = '') {                           // заменить текст в строке и поставить курсор в конец
  $('pw').value = v;
  $('pw').setSelectionRange(v.length, v.length);
  sync();
}
const flash = m => {                                 // сообщение вместо слова "команда"/"пароль" на секунду
  $('lab').textContent = m;
  setTimeout(() => $('lab').textContent = S.key ? 'команда' : 'пароль', 1200);
};

// ---------- Выполнение команды ----------
function run() {
  const [word, ...args] = parse(), {pick} = match(word);
  setLine();
  if (!pick) return word && flash('нет такой команды');
  hist.push([pick, ...args].join(' '));              // в историю пишем полное имя, а не сокращение
  h = hist.length;
  cmds[pick](...args);
}

// ---------- Вход по паролю ----------
async function login() {
  await unlock($('pw').value);
  try { S.idx.length ? await show(S.idx.length - 1) : draw(); }       // открываем последнюю запись
  catch { S.key = null; setLine(); return flash('неверно'); }         // не расшифровалось: пароль неверный
  setLine();
  $('lab').textContent = 'команда';                  // строка пароля становится строкой команд
  $('lock').style.marginTop = 0;
  $('info').textContent = HELP;
  $('page').style.display = 'block';
}

// ---------- События ----------
for (const ev of ['input', 'keyup', 'click', 'focus', 'select']) $('pw').addEventListener(ev, sync);
document.addEventListener('selectionchange', sync);
$('lock').onsubmit = e => { e.preventDefault(); S.key ? run() : login(); };     // Enter (и кнопка "Ввод" на экранной клавиатуре)
$('pw').onkeydown = e => {
  if (!S.key) return;
  if (e.key == 'Tab') { e.preventDefault(); edit(); }                           // Tab - писать в запись
  if (e.key == 'ArrowUp') { e.preventDefault(); if (h) setLine(hist[--h]); }    // назад по истории
  if (e.key == 'ArrowDown') {
    e.preventDefault();
    if (h < hist.length - 1) setLine(hist[++h]);                                // вперёд по истории
    else if (h == hist.length - 1) { h = hist.length; setLine(); }              // дошли до конца: пустая строка
    else edit();                                                                // истории больше нет: в запись
  }
};
document.body.onclick = () => !S.key && $('pw').focus();    // до входа клик в любом месте = ввод пароля
$('lock').onclick = () => $('pw').focus();                  // после входа клик по строке команд
sync();
