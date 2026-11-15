// Команды терминала. Чтобы добавить новую, допиши строку в cmds: слово: () => что сделать.
// Порядок важен: при вводе первых букв Enter выполнит первую подходящую команду.
import {$, S} from './state.js';
import {ins, go, addPhotos} from './entry.js';

const END = '<div><br></div>';   // пустая строка после элемента, чтобы можно было писать дальше

// Таблица из c столбцов и r строк
const table = (c, r) => '<table>' + ('<tr>' + '<td>&nbsp;</td>'.repeat(c) + '</tr>').repeat(r) + '</table>' + END;

// Календарь на месяц m и год y (если не указаны, берётся текущий)
function calendar(m, y) {
  const now = new Date();
  const d = new Date(+y || now.getFullYear(), m ? m - 1 : now.getMonth(), 1);     // первое число месяца
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();          // сколько дней в месяце
  const cells = [...Array((d.getDay() + 6) % 7).fill(''),                         // пустые клетки до 1-го числа (неделя с понедельника)
                 ...Array.from({length: days}, (_, i) => i + 1)];                 // числа месяца
  while (cells.length % 7) cells.push('');                                        // добиваем последнюю неделю
  const td = x => `<td>${x || '&nbsp;'}</td>`;
  let rows = '';
  for (let i = 0; i < cells.length; i += 7) rows += '<tr>' + cells.slice(i, i + 7).map(td).join('') + '</tr>';
  const title = d.toLocaleString('ru', {month: 'long', year: 'numeric'});
  const week = 'Пн Вт Ср Чт Пт Сб Вс'.split(' ').map(td).join('');
  return `<table><tr><td colspan=7>${title}</td></tr><tr>${week}</tr>${rows}</table>` + END;
}

// Окно выбора фото
function pickPhotos() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
  input.onchange = () => addPhotos(input.files);
  input.click();
}

export const cmds = {
  фото: pickPhotos,
  таблица: (c = 3, r = 3) => ins(table(Math.min(+c, 20), Math.min(+r, 50))),   // таблица [столбцы строки]
  календарь: (m, y) => ins(calendar(m, y)),                                    // календарь [месяц год]
  список: () => ins('<ul><li>&nbsp;</li></ul>'),
  чек: () => ins('<div><input type="checkbox"> &nbsp;</div>'),
  поле: () => ins('<div class="box"><br></div>' + END),
  заголовок: () => ins('<h2>Заголовок</h2>' + END),
  линия: () => ins('<hr>'),
  дата: () => ins(new Date().toLocaleDateString('ru')),
  тема: () => $('th').click(),
  новая: () => go(S.idx.length),
  назад: () => go(S.cur - 1),
  вперёд: () => go(S.cur + 1)
};
