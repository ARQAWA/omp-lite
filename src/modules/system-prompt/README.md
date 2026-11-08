# system-prompt

Ресурсный модуль. Кода нет. Системный промпт главного агента.

**Вход:** `~/.omp/agent/SYSTEM.md`. Штатный путь и правила взяты из `omp://system-prompt-customization.md`.

**Что заменяет:** блок инструкций OMP по умолчанию. Навыки, всегда включённые правила и контекст проекта `<project-context>` остаются. Своего блока инвентаря тулов и каталога внутренних URL OMP не добавляет. Отдельные блоки он всё же ставит: память и наставления MCP-серверов.

**Основа:** системный промпт Cursor 5.5 для GPT-5.5, снимок `runs-2026-10-16`. Ствол и текст Cursor сохранены. Модель по имени не названа: первая строка говорит «coding agent».

**Принятые замены.** Меняются только имена тулов и механики OMP:

- модель и среда: `GPT-5.5` → `coding agent`, `Cursor` и `Cursor IDE` → `OMP`;
- тулы: `Shell` → `bash`, `bash commands` вместо `shell commands`, `ReadFile` → `read`, `ApplyPatch` → `edit`, `terminal command` → `bash command`;
- вызовы: `multi_tool_use.parallel` → обычные параллельные вызовы в одном ответе;
- номера строк: `Lxxx:` → `12|`;
- теги: `<system_reminder>`, `<attached_files>`, `<system_notification>` → `<system-reminder>`, `<project-context>`, `<system-notification>`;
- каналы `commentary` и `final` → обычные сообщения;
- `<user_query>` → `in each message`;
- ссылка на код: только `filepath`, без `startLine:endLine` и без пометки «в редакторе»;
- строка bash: `working_directory` вместо `cd`, без обещания общего окружения;
- рендер: `styled by Cursor` → `rendered by OMP`.

**Удалено:** блоки `<mode_selection>`, `<dynamic_tools>` и `<terminal_files_information>`, строка про markdown-картинки.

**Строка про саб-агентов.** Добавлена дословно из Codex CLI, тул `spawn_agent`: `Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.` Стоит в `<general>`.

**Дислексия не дублируется.** Правило дислексии дописывает расширение [dyslexia](../dyslexia/index.js) в конец пользовательского сообщения. В промпте его нет.

**Границы:** MCP-тулы приходят обычными тулами, блока их поиска нет. Режимов `plan`, `goal`, `vibe` в промпте нет; переключать их промптом нельзя.

**Установка:** файл перечислен в [манифесте](../../../install.manifest.json); процедура — [INSTALL.md](../../../INSTALL.md).

**Выключить:** удалить `~/.omp/agent/SYSTEM.md`. Модуль выключен. Другой найденный `SYSTEM.md` или шаблон тогда главнее.

**Проверка:** реальным запуском. Постоянного теста нет: только ресурс.
