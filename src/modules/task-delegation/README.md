# task-delegation

Расширение OMP. Делает делегирование явным через описание `task`.
В `eval` предпочитает JavaScript на Bun.

**Почему костыль:** штатной настройки описаний тулов нет.
Отдельного выключателя `agent()` и `workpool()` также нет.
Общая политика спавна ограничивает и `task`.
Документация: `omp://extensions.md`, `omp://tools/eval.md`, `omp://task-agent-discovery.md`.
Ранее упомянутой настройки `tasks.delegationBias` не существует.

**Вход:** `~/.omp/agent/extensions/task-delegation.js` и соседний `task-delegation.json`.
Код, строки описаний и сообщения ошибок разделены.

**Строка:** `Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.` Взята дословно из Codex CLI, описание тула `spawn_agent`.

**Хук `before_provider_request`:**
- строка Codex идёт под первой строкой `task`;
- обязательные призывы использовать `scout` удаляются;
- сам `scout` остаётся доступен по просьбе;
- `eval` рекомендует Bun, Python оставляет редким случаем;
- пример `%load` использует JavaScript;
- файловые чтение и поиск направляются специализированным тулам;
- подсказки `agent()` и `workpool()` из `eval` удаляются;
- поддерживаются вложенные и плоские описания тулов;
- префикс `_` Anthropic OAuth учитывается;
- повторная обработка не дублирует строки.

**Хук `tool_call`:** блокирует прямые `agent()` и `workpool()` внутри `eval`.
Для явного делегирования остаётся тул `task`.

**Строка о рабочем агенте.** Родная строка `Use most specific agent.` толкала модель к `scout` и `sonic`. Она заменена правилом из `task-delegation.json` (`specificOld`, `specificNew`): без `agent` работает универсальный агент, как Codex `default`; `scout` только для чтения незнакомых файлов; `sonic` только для механических правок; названный тип агента идёт в `agent`; названные модель или уровень усилия идут в `model` как `provider/id:level` (своя модель, если названа только степень), без `agent`. Уровни названы в правиле: `low`, `medium`, `high`, `xhigh`, `max`. Поля `effort` нет: `task.enableEffort` выключен, оно давало лишь `lo/med/hi`. Остальная строка про делегирование родная. Настройки модели и усилия на каждый вызов лежат в [runtime-config](../runtime-config/README.md).

**Хук `tool_result`:** в ответе `task` родная подсказка OMP `Tip: this call spawned N generic ... workers` заменяется нашей. Родная зовёт к `scout` и спорит с правилом. Настройки для неё нет (`suppressSpawnAdvisory` внутренний). Наша: `Tip:` и текст ключа `pick`. Шаблон родной лежит в ключе `tip`.

**Хук `before_agent_start`:** только у сабагента (`ctx.agent.kind === "sub"`). Родная строка тела `task` и `sonic` `` `task` delegation: select most specific `agent` type... `` (ключ `stockPick`) заменяется текстом `pick`.

**Границы:** фильтр текстовый, это не изоляция.
Функции из ядра OMP не удаляются.
Алиасы и код через `%load` могут пройти.
Строки, комментарии и одноимённые методы могут блокироваться.
`task` ограничивается инструкцией модели, не фильтром разрешений.
Python остаётся включённым, выбирает язык модель.
Системный промпт главного агента не меняется.

**Установка:** файл перечислен в [манифесте](../../../install.manifest.json); процедура — [INSTALL.md](../../../INSTALL.md).

**Выключить:** удалить расширение и соседний JSON.

**Тесты:** `bun test dev/tests/harness/task-delegation`.
