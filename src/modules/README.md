# Модули харнеса

Один самостоятельный модуль занимает один каталог `src/modules/<module-name>/`. Имя `<module-name>` — в lower-kebab-case.

Код, промпты, настройки и прочие ресурсы конкретного модуля находятся в его каталоге, не в корне репозитория и не в `dev/agents/`. Последний предназначен только для материалов агентов-разработчиков.

README модуля описывает:

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
- `memory-guide` — короткий блок про память в системном промпте, пока включён Mnemopi. Тест: `dev/tests/harness/memory-guide/`.
- `model-picker` — компактный пикер модели и усилия, Shift+стрелки, фильтр. Тест: `dev/tests/harness/model-picker/`.
- `tool-summary` — одна строка со счётчиками тулов рядом с карточками. Тест: `dev/tests/harness/tool-summary/`.
- `review` — скиллы приёмки: сборщик фактуры и ревьюер через `omp -p`, скрипт сверки. Тест: `dev/tests/harness/review/`.
- `subagent-reuse` — инструмент `reuse`: та же сессия сабагента, история с нуля через `newSession()`. Тест: `dev/tests/harness/subagent-reuse/`.
- `subscriptions` — метки `CC`, `CX`, `Go` с лимитами подписок. Тест: `dev/tests/harness/subscriptions/`.
- `compactions` — счётчик компакшенов сессии в статуслайне. Тест: `dev/tests/harness/compactions/`.
- `turn-duration` — строка `⏱ 2m 4s` после каждого хода. Тест: `dev/tests/harness/turn-duration/`.
- `base-tools` — тул `files`: карта проекта одним вызовом на движке OMP, без потолка 200 и без git; настройки `apply_patch`, контекста `grep` и порога спилла в `base-tools.yml`. Тест: `dev/tests/harness/base-tools/`.
- `task-delegation` — правило Codex для `task`, Bun по умолчанию и фильтр прямого спавна в `eval`. Тест: `dev/tests/harness/task-delegation/`.
- `ompcli` — расширение VS Code `arqawa.ompcli` для Windows VDI: вкладки OMP, комплектный runtime, локальная память, Update и установка харнеса по манифесту. Тест: `dev/tests/harness/ompcli/`.

Настройки без кода:

- `status-line` — раскладка родного статуслайна, `status-line.yml`.

Промпт без кода:

- `system-prompt` — системный промпт на базе Cursor 5.5, `SYSTEM.md`.

Каждый README описывает свой модуль.

Не создавай образцы с пустым `index.ts`. Pi API и регистрация `pi.extensions` не приняты; названия каталогов не являются автоматической регистрацией в OMP. API хоста и стек этим устройством каталогов не выбираются.

Устанавливаемый состав задаёт [install.manifest.json](../../install.manifest.json). Единственный источник процедуры установки — [INSTALL.md](../../INSTALL.md); наличие этого README не делает каталог устанавливаемым пакетом.
