# rqw-system-core

Основа харнеса: системный промпт, правила общения и памятка. Версия OMP: 19.1.1.

**Состав:**

- `SYSTEM.md` — системный промпт. Его получают все агенты: главный и сабагенты. Вход: `~/.omp/agent/SYSTEM.md`.
- `rules/rqw-system-core-main.md` — правила главного агента: особые запросы, смешанное сообщение, новые сообщения и компакт. `alwaysApply: true`, `agents: main`. Вход: `~/.omp/agent/rules/`.
- `rules/rqw-system-core-subagent.md` — заметка об отчёте для сабагентов: `alwaysApply: true`, `agents: "!main"`. Вход: `~/.omp/agent/rules/`.
- `index.js` — памятка: код и текст. Вход: `~/.omp/agent/extensions/rqw-system-core.js`.

**Проверка результата:** «проверь» не означает «запусти». Агент выбирает первое подходящее правило из [SYSTEM.md](SYSTEM.md):

1. Запуск запрещён: не запускать.
2. Запуск предписан: выполнить его по указанию.
3. Результат следует из кода: достаточно чтения.
4. Иначе выбрать кратчайшую доступную прямую проверку.

Вывод по коду нельзя выдавать за выполненный запуск. Пользователь или применимый `AGENTS.md` может потребовать тест. Это не разрешает строить стенд или заказывать его сабагенту. Повтор актуальной проверки тоже требует явного указания.

**Памятка:** константа `REMINDER`, два блока: `## Communication` и `## Workflow`. Она дописывается последним блоком в каждое сообщение владельца по пути к модели. Модель видит одно сообщение: текст владельца и памятку. История и экран не меняются. Сабагенты памятку не получают.

**Хуки:** `context`, перед каждым запросом (`extensibility/extensions/runner.ts`, `emitContext`). `before_provider_request`, перед отправкой каждого запроса (`emitBeforeProviderRequest`).

**Блок `<critical>` OMP:** OMP всегда дописывает его после `SYSTEM.md` (`prompts/system/project-prompt.md`, `system-prompt.ts`, `buildSystemPrompt`), выключателя нет. Главному агенту блок велит запускать проверку перед сдачей: это спорит с `SYSTEM.md`. Хук `before_provider_request` вырезает блок из запроса у главного агента и у сабагентов. Другие блоки `<critical>` остаются. Хук отдаёт копию запроса: OMP сравнивает свой запрос со следующим (`packages/ai/src/providers/openai-codex-responses.ts`, `buildCodexChainedRequestBody`). Граница: провайдер `agy` хук не зовёт, там блок остаётся. После обновления OMP сверь текст блока с регуляркой `CRITICAL`.

**Костыль в коде модуля, файлы OMP не правятся:**

- Threads. Модуль ставит `PI_ANTHROPIC_MESSAGE_THREADS=0`: штатный флаг OMP (`packages/ai/src/providers/anthropic-threads.ts`, `wantsAnthropicThreads`). Флаг общий для процесса: threads выключены у главного агента и у сабагентов.

**Установка:** четыре записи в `install.manifest.json`. Настроек и зависимостей нет.

Чтобы обновить только промпт, выполни из корня репозитория:

```bash
cp src/modules/rqw-system-core/SYSTEM.md ~/.omp/agent/SYSTEM.md
```

Затем открой новую сессию OMP.

**Выключить:** памятка: `extension-module:rqw-system-core` в `disabledExtensions`. Правила: удалить два файла из `rules`. Промпт: удалить `SYSTEM.md`.

**Тесты:** `bun test dev/tests/harness/rqw-system-core/rqw-system-core.test.js`.
