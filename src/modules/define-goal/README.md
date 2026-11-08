# define-goal

Команда `/define-goal` вместо встроенной `/guided-goal`. Текст интервью тот же.

Встроенную команду OMP переименовать нельзя: имя вшито в бинарь. Поэтому две части.

- `define-goal.md` — файл-команда с тем же текстом интервью.
- `index.js` — прячет `/guided-goal` из автокомплита.

**Вход:** `~/.omp/agent/commands/define-goal.md` и `~/.omp/agent/extensions/define-goal.js`.

**Выключить:** удалить оба файла. Вернётся встроенная `/guided-goal`.

**Тесты:** `bun test dev/tests/harness/define-goal`.
