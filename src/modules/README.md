# Модули харнеса

Один самостоятельный модуль занимает один каталог `src/modules/<module-name>/`. Имя `<module-name>` — в lower-kebab-case.

Код, промпты, настройки и прочие ресурсы конкретного модуля находятся в его каталоге, не в корне репозитория и не в `dev/agents/`. Последний предназначен только для материалов агентов-разработчиков.

Будущий README модуля описывает:

- назначение и наблюдаемое поведение;
- фактический вход OMP;
- ресурсы и зависимости;
- подключение и отключение;
- соответствующие тесты в `dev/tests/harness/<module-name>/` согласно [правилам тестов](../../dev/tests/harness/README.md).

Ресурсы на основе снимков рантайма от 2026-11-08:

- `runtime-config` — `config.yml` и штатная маршрутизация bash;
- `compaction-400k` — 16 порогов `f400000`;
- `web-search` — Codex-поиск, 5 файлов;
- `codex-transport` — правка тела запроса, 16 строк;
- `codex-luna-search` — правка поиска Luna, 43 строки.

Написанный код:

- `dyslexia` — правило дислексии в хвосте отправленного сообщения. Тест: `dev/tests/harness/dyslexia/`.
- `skill-alias` — короткий `/имя` вместо `/skill:имя`. Тест: `dev/tests/harness/skill-alias/`.
- `memory-tool-prompts` — точная подмена описаний тулов памяти в рантайме. Тест: `dev/tests/harness/memory-tool-prompts/`.
- `model-picker` — компактный пикер модели и усилия, Shift+стрелки, фильтр. Тест: `dev/tests/harness/model-picker/`.
- `tool-summary` — одна строка со счётчиками тулов рядом с карточками. Тест: `dev/tests/harness/tool-summary/`.
- `review` — навыки `blindreview`, `highreview`, `reviewer` и агенты `spotty`, `bossy`. Тестов нет: только ресурсы, проверка реальным запуском.
- `subagent-reuse` — инструмент `reuse`: та же сессия сабагента, история с нуля через `newSession()`. Тест: `dev/tests/harness/subagent-reuse/`.
- `subscriptions` — метки `CC`, `CX`, `Go` с лимитами подписок. Тест: `dev/tests/harness/subscriptions/`.
- `compactions` — счётчик компакшенов сессии в статуслайне. Тест: `dev/tests/harness/compactions/`.
- `turn-duration` — строка `⏱ 2m 4s` после долгого хода. Тест: `dev/tests/harness/turn-duration/`.
- `cursor-tools` — аргументы сбора контекста курсора над родными тулами: `grep` с контекстом, режимами и типом, `bash` с `block_until_ms: 0`, `glob` и `read` со своими полями, режим правок `apply_patch`. Описания тулов и их параметров перенесены из курсора под наши имена и лежат в `descriptions.json`. Тест: `dev/tests/harness/cursor-tools/`.
- `task-delegation` — правило Codex для `task`, Bun по умолчанию и фильтр прямого спавна в `eval`. Тест: `dev/tests/harness/task-delegation/`.
- `ompcli` — расширение VS Code `arqawa.ompcli` для Windows VDI: вкладки OMP, комплектный runtime, локальная память, Update и установка харнеса по манифесту. Тест: `dev/tests/harness/ompcli/`.

Настройки без кода:

- `status-line` — раскладка родного статуслайна, `status-line.yml`.

Промпт без кода:

- `system-prompt` — системный промпт на базе Cursor 5.5, `SYSTEM.md`.

Каждый README описывает свой модуль.

Не создавай образцы с пустым `index.ts`. Pi API и регистрация `pi.extensions` не приняты; названия каталогов не являются автоматической регистрацией в OMP. API хоста и стек этим устройством каталогов не выбираются.

Устанавливаемый состав задаёт [install.manifest.json](../../install.manifest.json). Единственный источник процедуры установки — [INSTALL.md](../../INSTALL.md); наличие этого README не делает каталог устанавливаемым пакетом.
