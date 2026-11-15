// Показывает окно с текстом любой ошибки (пока сайт дорабатывается). Потом файл можно убрать.
onerror = m => alert(m);
onunhandledrejection = e => alert(e.reason);
