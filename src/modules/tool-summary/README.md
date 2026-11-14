# tool-summary

Расширение OMP. Показывает одну строку со счётчиками тулов под редактором. Карточки тулов не трогает.

**Вход OMP:** `ctx.ui.setWidget`, события `agent_start`, `before_agent_start`, `tool_execution_start`, `tool_execution_end`.

**Настройка OMP:** не нужна. Карточки тулов видны: в конфиге `display.hideToolActivity: false`.

**Строка:** `read 2 · edit 1 · run 3 · failed 1`. Нулевые части опущены. Счётчики начинаются заново на каждом шаге агента и на каждом новом запросе, в том числе из очереди.

**Виды:** карта имён тулов лежит в `tool-summary.json`. `read` — чтение; `edit`, `apply_patch`, `write` — правка; `grep`, `glob`, `find`, `web_search` — поиск; `bash`, `eval` — запуск. Прочие тулы идут в `other`.

**Установка:** файлы перечислены в [манифесте](../../../install.manifest.json); процедура — [INSTALL.md](../../../INSTALL.md).

**Выключить:** удалить `tool-summary.js`.

**Границы:** только TUI.

**Тесты:** `bun test dev/tests/harness/tool-summary`.
