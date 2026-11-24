# rqw-runtime-config

RQW Runtime Config: общие настройки и список моделей OMP 19.1.1.

**Назначение:**
1. общие настройки харнеса: провайдеры, модели, роли, тулы, интерфейс, служебное.
2. единый список выбора и фиксированный порог `f400000` для окон от 500 000 токенов.

**Правило:** один ключ лежит в одном месте. Здесь только настройки, которые не принадлежат ни одному плагину. Свои настройки несут `rqw-base-tools`, `rqw-harness-interface`, `rqw-codex-adapter`. Итоговый конфиг это сумма их файлов.

**Вход:** `index.js` и `config.yml` из [манифеста](../../../install.manifest.json).

**Подогрев:** `providers.cacheWarmingStrategy: keepalive` не запускает сжатие ради сохранения кэша при долгом вызове тула. Когда подогрев перестаёт окупаться, кэш может истечь. `providers.cacheWarming` не задан: штатный `idle` допускает подогрев и в простое. Обычные пороги сжатия не меняются.

**Руление на лету:** `providers.openaiLiveSteering: true`. Сообщение, набранное во время ответа модели GPT-6, уходит в этот же ответ по WebSocket Codex, а не ждёт границы тула. Работает только на `openai-codex` и только пока соединение идёт по WebSocket (`providers.openaiWebsockets`, по умолчанию `auto`).

**Экран:** `display.smoothStreaming: false` показывает текст и аргументы тулов по мере получения, без искусственной печати. Сам стриминг и остальные анимации не выключены. `display.collapseCompacted: true` прячет чат до компакшена за сводкой. `tui.autoGraph: "off"`: графиков под таблицами и запросов судье нет.

**Модели:** `anthropic`, `openai-codex`, `opencode-go`, `openrouter`, `zai`. Каталог OMP за вычетом `blocked-models.json` задаёт `enabledModels` и `modelRoles.perCall` в сессии. Новинки появляются автоматически. Из OpenRouter проходит только `openrouter/deepseek/deepseek-v4.1-flash-1017`; режим `floor` остаётся.

**Z.ai:** только Coding Plan, без GLM-5.3-FlashX-Legal. Платный `zai-api` выключен.

**Хуки:** `session_start` отслеживает каталог и ограничения `perCall`. `session_shutdown` снимает обе подписки.

**Старт:** Sonnet 5.5 идёт первой. До загрузки фильтра используются шаблоны подключённых провайдеров, чтобы OMP мог восстановить выбор. Расширение не меняет `modelRoles.default` и `web`.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Секретов нет.

**Выключение:** отключить `extension-module:rqw-runtime-config`.

**Тест:** `bun test dev/tests/harness/rqw-runtime-config`. Правило одного места проверяет `bun test dev/tests/install`.

**Границы:**
- **Обвязка Claude Code выключена:** в `disabledProviders` стоят `claude` (`.claude/` проекта и `~/.claude/`: `CLAUDE.md`, скиллы, команды, хуки, тулы, расширения, `settings.json`, `SYSTEM.md`, MCP), `claude-md` (`CLAUDE.md` в проекте и выше) и `claude-plugins` (плагины Claude Code и их сабагенты). Модели Claude и вход в подписку Anthropic работают. Не выключаются штатно: разовое чтение `~/.claude/history.jsonl` демоном подсказок композера при пустой базе, импорт `--from-claude`, `omp claude-trace`.
- Это фильтр нашего пикера и `perCall`, не запрет ручного `--model`.
- Новый провайдер надо добавить в список явно.
- Остальные окна сжимаются по правилам OMP.

**Механика OMP 19.1.1**, каталог `packages/coding-agent/src`: `config/compaction-threshold.ts` (формы порога, точное имя главнее шаблона), `config/model-settings.ts` (`modelRoles`, `enabledModels`, `disabledProviders`), `config/model-resolver.ts` (`normalizeModelPatternList`, `resolveModelRoleValue`: роль это список через запятую, берётся первая доступная модель), `task/model-approval.ts` (список моделей в описании тула `task` строится из `perCall`), `session/settings.ts` (`providers.openrouterVariant`, подогрев, `retry.fallbackChains`), `session/cache-warmer.ts` (подогрев и стратегия), `tools/settings.ts` (`tools.approvalMode`, `dev.autoqaConsent`), `modes/controllers/event-controller.ts` (плавное появление текста и аргументов).

Обновление каталога: `config/model-registry.ts` (`getAvailableForProviders`, `subscribeMirror`). Настройки: `config/registry.ts` (`override`).

**Маршруты Z.ai в OMP 19.1.1:** `packages/catalog/src/compat/rules/providers/zai.kdl`.
