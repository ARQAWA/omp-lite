# rqw-codex-adapter

RQW Codex Adapter: одно расширение OMP 19.1.0. Оно делает четыре вещи.

1. **Делегирование как в Codex.** Сабагенты только по прямой просьбе. Агент по умолчанию равен главному. `scout` и `sonic` только по своему назначению. `eval` по умолчанию пишет на JavaScript, прямые `agent()` и `workpool()` в нём блокируются.
2. **`AGENTS.md` для сабагентов.** Сабагент получает эти файлы так же, как главный агент.
3. **Поиск.** `web_search` ищет в живом интернете через бэкенд ChatGPT Codex: планировщик `gpt-6.1-terra`, усилие `max`, тир по умолчанию.
4. **Транспорт Codex.** Запросы `openai-codex-responses` с тулами получают `parallel_tool_calls: true`, `reasoning.context: all_turns`. `text.verbosity: low` шлёт сам OMP: настройка `textVerbosity`, по умолчанию `low`. Модель с `luna` в id получает `service_tier: priority`. Усилие не трогается.

Из описания `eval` убрана ссылка `help://eval/agents`, остальные справки сохранены.

## Файлы

- `index.js`: хуки `before_provider_request`, `tool_call`, `tool_result`, регистрация `web_search`, тексты для модели.
- `agentsmd.js`: патч рантайма. OMP грузит его первым в каждый рабочий поток сабагента, поэтому файл отдельный.
- `websearch.js`: связь с Codex и цикл поиска.
- `web-run.schema.json`: схема родного тула `web.run`.
- `agents/task.md`, `agents/sonic.md`: профили с пустой ролью, уровень `medium`. `agents/scout.md`: роль исследователя, полный отчёт.
- `rqw-codex-adapter.yml`: раздел настроек `task`. `perCallModel: "on"` включает поле `model` в `task`, уровень идёт хвостом `:level`. Кавычки нужны: голое `on` YAML читает как `true`. `scout` и `sonic` закреплены на Terra. Родные `reviewer` и `security-reviewer` выключены.
  `agentIdleTtlMs: 60000`: законченный сабагент выгружается из памяти через минуту и оживает с диска, когда ему пишут.
  `completionProbe: false`: побочных запросов об оценке готовности сабагента нет.

## Вход

`~/.omp/agent/extensions/rqw-codex-adapter/` и три профиля в `~/.omp/agent/agents/`. `rqw-codex-adapter.yml` сливается в `config.yml`. Состав: [install.manifest.json](../../../install.manifest.json).

Нужно от окружения: вход `openai-codex` для поиска.

## Механика OMP 19.1.0

Каталог исходников: `packages/coding-agent/src`.

- `discovery/helpers.ts`, `discoverExtensionModulePaths`: папка `extensions/<имя>/` с `index.js` это одно расширение.
- `extensibility/extensions/runner.ts`, `emitBeforeProviderRequest`: ответ хука становится запросом.
- `sdk.ts`: тул расширения с именем встроенного встаёт на его место.
- `system-prompt.ts`, `withoutAgentsMd` и `task/executor.ts`, `excludeAgentsMd: true`: OMP вырезает `AGENTS.md` у сабагента фильтром по имени, выключателя нет. Поэтому `agentsmd.js` это костыль: патч `Array.prototype.filter` и `preload` в рабочие потоки.
- `task/discovery.ts`: профиль пользователя главнее встроенного.
- `packages/ai/src/auth-retry.ts`, `withOAuthAccess`: поиск берёт аккаунт сессии. Ответ 401: OMP обновляет токен, потом идёт по остальным аккаунтам. Ошибка выходит, когда аккаунты кончились.
- `packages/catalog/src/wire/codex-version.ts`, `getCodexClientVersion`: заголовок версии клиента в обоих запросах поиска.
- `tools/settings.ts`, `web_search.enabled`: при `false` наш тул не регистрируется.

## Поиск

Потолки: 4 раунда, 8 вызовов, 2 МиБ входа планировщика, 180 секунд на запрос. Потолок достигнут: возвращается добытое. Тайм-аут или ошибка планировщика после первой находки: результат с последней строкой `[incomplete]`. Находки идут с заголовками `[fetch N]`. Из команд `web.run` дальше уходят только `search_query`, `open`, `click`, `find` и `response_length`.

## Запуск `omp usage`

`omp usage` грузит расширения до настроек: чтение `pi.pi.settings` там бросает ошибку. Адаптер в таком процессе не регистрирует `web_search` и грузится без ошибки.

## Выключение

- всё расширение: строка `extension-module:rqw-codex-adapter` в настройке `disabledExtensions`;
- поиск целиком: `web_search.enabled: false`;
- вернуть встроенный поиск OMP: пустой файл `disabled` рядом с `index.js`;
- профили: удалить три файла из `~/.omp/agent/agents/`.

После любого шага нужна новая сессия OMP.

## Известные проблемы

Их решено пока не трогать.

- Патч `filter` широкий: чужой код с таким же текстом фильтра тоже попадёт под него. Патч привязан к OMP 19.1.0.
- Фильтр `eval` текстовый: псевдоним или код из файла его обходят.
- Правки описаний не доходят до моделей, которым тулы идут текстом в промпте.
- Команды `web.run` вне четырёх ключей молча становятся обычным поиском.
- Модели `scout` и `sonic` закреплены настройками: названная владельцем модель идёт обычным `task`.
- `all_turns` ставится и старым моделям Codex.

## Тест

`bun test dev/tests/harness/rqw-codex-adapter`. Транспорт тестом не покрыт: так решено.
