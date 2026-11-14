# task-delegation

Расширение OMP. Делает делегирование явным через описание `task`.
В `eval` предпочитает JavaScript на Bun.
Даёт сабагентам `task` и `sonic` пустую роль.
Даёт сабагенту `scout` роль `explore` из Cursor.

**Почему костыль:** штатной настройки описаний тулов нет.
Отдельного выключателя `agent()` и `workpool()` также нет.
Общая политика спавна ограничивает и `task`.
Ранее упомянутой настройки `tasks.delegationBias` не существует.

**Вход:** `~/.omp/agent/extensions/task-delegation.js` и соседний `task-delegation.json`. Профили: `~/.omp/agent/agents/task.md`, `~/.omp/agent/agents/sonic.md` и `~/.omp/agent/agents/scout.md`.
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

**Строка о рабочем агенте.** Родная строка `Use most specific agent.` толкала модель к `scout` и `sonic`. Она заменена правилом из `task-delegation.json` (`specificOld`, `specificNew`): без `agent` работает универсальный агент, как Codex `default`; `scout` только для чтения незнакомых файлов; `sonic` только для механических правок; названный тип агента идёт в `agent`; названные модель или уровень усилия идут в `model` как `provider/id:level` (своя модель, если названа только степень), без `agent`. Уровни названы в правиле: `low`, `medium`, `high`, `xhigh`, `max`. В конце правила одна фраза: `In every task say how thorough to be and exactly what to return.` (D-070). Причина: Cursor сам говорит главному агенту так: «When calling this agent, specify the desired thoroughness level» и «Specify exactly what information the agent should return back in its final response to you». Длинные отчёты `explore` в Cursor шли от задания вызывающего. Поля `effort` нет: `task.enableEffort` выключен, оно давало лишь `lo/med/hi`. Остальная строка про делегирование родная. Настройки модели и усилия на каждый вызов лежат в [runtime-config](../runtime-config/README.md).

**Хук `tool_result`:** в ответе `task` родная подсказка OMP `Tip: this call spawned N generic ... workers` заменяется нашей. Родная зовёт к `scout` и спорит с правилом. Настройки для неё нет (`suppressSpawnAdvisory` внутренний). Наша: `Tip:` и текст ключа `pick`. Шаблон родной лежит в ключе `tip`.

**Профили `task` и `sonic`.** Лежат в `agents/`. Тело пустое. Фронтматтер взят из `omp agents unpack`. Как у Codex: роль `default` ничего не добавляет. Родная роль OMP (`prompts/agents/task.md`) просила «minimum useful result» и «MUST concise». Свой профиль заменяет встроенный с тем же именем: `task/discovery.ts`, OMP 18.18.8. Вместе с ролью ушла родная строка `select most specific agent type...`. Хук для её замены больше не нужен. Решение: D-067.

**Профиль `scout`.** Лежит в `agents/scout.md`. Тело — роль сабагента `explore` из Cursor. Источник: `~/ai-project/cursor-pi/research/cursor/reverse/prompts/items/subagent-task-33666c41b589.md`, тот же текст в пяти захватах. Вырезано три куска, остальное дословно, кроме двух отличий (D-070). Первое: слова « for Cursor, an application to write code with AI». Второе: общая строка сабагента Cursor про спавн и Canvas. Третье: блок `<progress_reporting_instructions>`, тула `UpdateCurrentStep` в OMP нет. Ушли родные строки OMP (`prompts/agents/scout.md`): «Investigate the codebase rapidly», «brief», «finish in a few seconds», «NEVER read full files unless they're tiny». Они спорили с блоком `<file_work>` в `SYSTEM.md` и с заметкой сабагентам. Схема `output` убрана: `task.structured` выключен, схема не работает. Отчёт идёт обычным сообщением, как в Cursor. `readSummarize: false` дописан руками: `read` отдаёт файл как есть, без сводки (`task/types.ts`, `task/executor.ts`). `omp agents unpack` этот ключ не пишет. Первое отличие: убрана строка про скорость «You are meant to be a fast agent that returns output as quickly as possible» с вводной фразой; два пункта под ней вошли в «Guidelines». Второе: добавлена фраза родной роли OMP «Your report is the complete deliverable at the requested depth: tables, path:line anchors, signatures, code excerpts. Never a summary of it.» Причина: замер D-069, одна задача поиска, «very thorough», по два `scout` на `gpt-6.1-terra:xhigh`. Родная роль OMP дала отчёты 24779 и 23811 знаков, роль Cursor 16177 и 20608. Описание тоже изменено: вторая фраза теперь «Read-only scout returning a full report for handoff.» вместо «Fast read-only scout returning compressed context for handoff.» Не менялись имя, тулы и модель. Наш конфиг по-прежнему запускает `scout` на `openai-codex/gpt-6.1-terra:xhigh` через `task.agentModelOverrides`. Решение: D-069.

**Границы:** фильтр текстовый, это не изоляция.
Функции из ядра OMP не удаляются.
Алиасы и код через `%load` могут пройти.
Строки, комментарии и одноимённые методы могут блокироваться.
`task` ограничивается инструкцией модели, не фильтром разрешений.
Python остаётся включённым, выбирает язык модель.
Системный промпт главного агента не меняется.

**Установка:** файлы перечислены в [манифесте](../../../install.manifest.json); процедура — [INSTALL.md](../../../INSTALL.md).

**Выключить:** удалить расширение и соседний JSON. Профили: удалить `agents/task.md`, `agents/sonic.md` и `agents/scout.md`, вернётся родная роль.

**Тесты:** `bun test dev/tests/harness/task-delegation`.
