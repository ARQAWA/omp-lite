# rqw-system-core

Основа харнеса: системный промпт, правила общения и памятка. Версия OMP: 18.22.0.

**Состав:**

- `SYSTEM.md` — системный промпт. Его получают все агенты: главный и сабагенты. Вход: `~/.omp/agent/SYSTEM.md`.
- `rules/rqw-system-core-main.md` — правила общения главного агента: `alwaysApply: true`, `agents: main`. Вход: `~/.omp/agent/rules/`.
- `rules/rqw-system-core-subagent.md` — заметка об отчёте для сабагентов: `alwaysApply: true`, `agents: "!main"`. Вход: `~/.omp/agent/rules/`.
- `index.js` — памятка: код и текст. Вход: `~/.omp/agent/extensions/rqw-system-core.js`.

**Памятка:** константа `REMINDER`, два блока: `## Communication` и `## Workflow`. Она дописывается последним блоком в каждое сообщение владельца по пути к модели. Модель видит одно сообщение: текст владельца и памятку. История и экран не меняются. Сабагенты памятку не получают.

**Хук:** `context`, перед каждым запросом (`extensibility/extensions/runner.ts`, `emitContext`).

**Костыль в коде модуля, файлы OMP не правятся:**

- Threads. Модуль ставит `PI_ANTHROPIC_MESSAGE_THREADS=0`: штатный флаг OMP (`packages/ai/src/providers/anthropic-threads.ts`, `wantsAnthropicThreads`). Флаг общий для процесса: threads выключены у главного агента и у сабагентов.

**Установка:** четыре записи в `install.manifest.json`. Настроек и зависимостей нет.

**Выключить:** памятка: `extension-module:rqw-system-core` в `disabledExtensions`. Правила: удалить два файла из `rules`. Промпт: удалить `SYSTEM.md`.

**Тесты:** `bun test dev/tests/harness/rqw-system-core/rqw-system-core.test.js`.
