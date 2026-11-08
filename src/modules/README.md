# Модули харнеса

Один самостоятельный модуль занимает один каталог `src/modules/<module-name>/`. Имя `<module-name>` — в lower-kebab-case.

Код, промпты, настройки и прочие ресурсы конкретного модуля находятся в его каталоге, не в корне репозитория и не в `dev/agents/`. Последний предназначен только для материалов агентов-разработчиков.

Будущий README модуля описывает:

- назначение и наблюдаемое поведение;
- фактический вход OMP;
- ресурсы и зависимости;
- подключение и отключение;
- соответствующие тесты в `dev/tests/harness/<module-name>/` согласно [правилам тестов](../../dev/tests/harness/README.md).

Сырые снимки рантайма от 2026-11-08, без правок:

- `runtime-config` — `config.yml`, 109 строк;
- `compaction-400k` — 16 порогов `f400000`;
- `web-search` — Codex-поиск, 5 файлов;
- `codex-transport` — правка тела запроса, 16 строк;
- `codex-luna-search` — правка поиска Luna, 43 строки.

Написанный код:

- `dyslexia` — правило дислексии в хвосте отправленного сообщения. Тест: `dev/tests/harness/dyslexia/`.
- `skill-alias` — короткий `/имя` вместо `/skill:имя`. Тест: `dev/tests/harness/skill-alias/`.
- `memory-tool-prompts` — точная подмена описаний тулов памяти в рантайме. Тест: `dev/tests/harness/memory-tool-prompts/`.
- `model-picker` — компактный пикер модели и усилия, Shift+стрелки, фильтр. Тест: `dev/tests/harness/model-picker/`.
- `tool-summary` — одна строка со счётчиками тулов вместо карточек. Тест: `dev/tests/harness/tool-summary/`.
- `review` — навыки `blindreview`, `highreview`, `reviewer` и агенты `spotty`, `bossy`. Тестов нет: только ресурсы, проверка реальным запуском.
- `define-goal` — `/define-goal` вместо встроенной `/guided-goal` и скрытие старой из автокомплита. Тест: `dev/tests/harness/define-goal/`.
- `subscriptions` — метки `CC`, `CX`, `Go` с лимитами подписок. Тест: `dev/tests/harness/subscriptions/`.
- `background-jobs` — счётчик фоновых процессов в статуслайне. Тест: `dev/tests/harness/background-jobs/`.
- `compactions` — счётчик компакшенов сессии в статуслайне. Тест: `dev/tests/harness/compactions/`.
- `turn-duration` — строка `⏱ 2m 4s` после долгого хода. Тест: `dev/tests/harness/turn-duration/`.
- `cursor-tools` — аргументы поиска курсора над родным движком: `grep` с контекстом, режимами и типом, `bash` с `block_until_ms: 0`, режим правок `apply_patch`. Описания тулов перенесены из курсора под наши имена. Тест: `dev/tests/harness/cursor-tools/`.

Настройки без кода:

- `status-line` — раскладка родного статуслайна, `status-line.yml`.

Каждый README описывает свой модуль.

Не создавай образцы с пустым `index.ts`. Pi API и регистрация `pi.extensions` не приняты; названия каталогов не являются автоматической регистрацией в OMP. API хоста и стек этим устройством каталогов не выбираются.

Механизм установки не реализован. Единственный источник процедуры установки — [INSTALL.md](../../INSTALL.md); наличие этого README не делает каталог устанавливаемым пакетом.
