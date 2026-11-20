# Модули харнеса

Один самостоятельный модуль занимает один каталог `src/modules/<module-name>/`. Имя `<module-name>` — в lower-kebab-case.

Код, промпты, настройки и прочие ресурсы конкретного модуля находятся в его каталоге, не в корне репозитория и не в `dev/agents/`. Последний предназначен только для материалов агентов-разработчиков.

README модуля описывает:

- назначение и наблюдаемое поведение;
- фактический вход OMP;
- ресурсы и зависимости;
- подключение и отключение;
- соответствующие тесты в `dev/tests/harness/<module-name>/` согласно [правилам тестов](../../dev/tests/harness/README.md).

Модули:

- `rqw-runtime-config` — общие настройки OMP одним `config.yml`: провайдеры, модели, роли, порог сжатия 400k. Кода нет. Тест: `dev/tests/harness/rqw-runtime-config/`.
- `rqw-system-core` — основа: системный промпт, правила общения, памятка внутри каждого сообщения владельца. Тест: `dev/tests/harness/rqw-system-core/`.
- `rqw-harness-interface` — пикер модели и усилия, статуслайн, лимиты, счётчики компакшенов и тулов, время хода. Тест: `dev/tests/harness/rqw-harness-interface/`.
- `rqw-reviewer` — приёмка: профили сабагентов `collector` и `acceptor`, три скилла. Кода нет. Тест: `dev/tests/harness/rqw-reviewer/`.
- `rqw-base-tools` — родные тулы OMP со своими строками в описаниях `bash`, `edit`, `write`, `glob`, сторож, правка по файлам; настройки тулов в `rqw-base-tools.yml`. Тест: `dev/tests/harness/rqw-base-tools/`.
- `rqw-codex-adapter` — одно расширение: делегирование как в Codex и три профиля сабагентов, `AGENTS.md` для сабагентов, Codex-поиск `web_search`, тюнинг транспорта Codex; настройки `task` в `rqw-codex-adapter.yml`. Тест: `dev/tests/harness/rqw-codex-adapter/`.
- `rqw-windows-pack` — харнес на Windows VDI: расширение VS Code `arqawa.ompcli` (вкладки OMP, комплектные программы, Update, установка харнеса по манифесту) и своя диктовка через Soniox, только во вкладке OMP CLI. Тест: `dev/tests/harness/rqw-windows-pack/`.

Каждый README описывает свой модуль.

Не создавай образцы с пустым `index.ts`. Pi API и регистрация `pi.extensions` не приняты; названия каталогов не являются автоматической регистрацией в OMP. API хоста и стек этим устройством каталогов не выбираются.

Устанавливаемый состав задаёт [install.manifest.json](../../install.manifest.json). Единственный источник процедуры установки — [INSTALL.md](../../INSTALL.md); наличие этого README не делает каталог устанавливаемым пакетом.
