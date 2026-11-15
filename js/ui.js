// Интерфейс: тема, горячие клавиши, свайпы.
import {$, S} from './state.js';
import {go} from './entry.js';

// ---------- Тема: кнопка показывает текущую (☾ тёмная, ☼ светлая) ----------
const setTheme = m => {
  document.documentElement.dataset.theme = m;
  $('th').textContent = m == 'dark' ? '☾' : '☼';
  localStorage.theme = m;                       // запоминаем выбор
};
setTheme(localStorage.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
$('th').onclick = () => setTheme(document.documentElement.dataset.theme == 'dark' ? 'light' : 'dark');

// ---------- Клавиши ----------
document.onkeydown = e => {
  if (e.key == 'Escape') $('pw').focus();                                                      // Esc - в строку команд
  else if (e.altKey && /Arrow[LR]/.test(e.key)) go(S.cur + (e.key == 'ArrowRight' ? 1 : -1));  // Alt+стрелки - листать записи
};

// ---------- Свайп пальцем: влево - дальше (с последней записи откроет новую), вправо - назад ----------
let x0;
document.ontouchstart = e => x0 = e.touches[0].clientX;
document.ontouchend = e => {
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 100) go(S.cur + (dx < 0 ? 1 : -1));
};
