# tool-summary

Расширение OMP. Прячет карточки тулов штатной настройкой и показывает одну строку со счётчиками над редактором.

**Вход OMP:** `omp://extensions.md` — `ctx.ui.setWidget`, события `session_start`, `agent_start`, `tool_execution_start`, `tool_execution_end`, `omp://settings.md` — `display.hideToolActivity`.

**Настройка OMP:**
```yaml
display:
  hideToolActivity: true
```

**Строка:** `read 2 · edit 1 · run 3 · failed 1`. Нулевые части опущены. Счётчики начинаются заново на каждом шаге агента.

**Установка:** скопировать два файла в `~/.omp/agent/extensions/`:
```bash
cp src/modules/tool-summary/index.js ~/.omp/agent/extensions/tool-summary.js
cp src/modules/tool-summary/tool-summary.json ~/.omp/agent/extensions/tool-summary.json
```

**Выключить:** удалить `tool-summary.js`.

**Границы:** только TUI. Старые карточки истории скрыты, отдельной строки для них нет.

**Тесты:** `bun test dev/tests/harness/tool-summary`.
