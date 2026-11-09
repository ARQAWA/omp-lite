# tool-summary

Расширение OMP. Показывает одну строку со счётчиками тулов под редактором. Карточки тулов не трогает.

**Вход OMP:** `omp://extensions.md` — `ctx.ui.setWidget`, события `session_start`, `agent_start`, `tool_execution_start`, `tool_execution_end`.

**Настройка OMP:** не нужна. Карточки тулов видны: в конфиге `display.hideToolActivity: false`.

**Строка:** `read 2 · edit 1 · run 3 · failed 1`. Нулевые части опущены. Счётчики начинаются заново на каждом шаге агента.

**Установка:** скопировать два файла в `~/.omp/agent/extensions/`:
```bash
cp src/modules/tool-summary/index.js ~/.omp/agent/extensions/tool-summary.js
cp src/modules/tool-summary/tool-summary.json ~/.omp/agent/extensions/tool-summary.json
```

**Выключить:** удалить `tool-summary.js`.

**Границы:** только TUI.

**Тесты:** `bun test dev/tests/harness/tool-summary`.
