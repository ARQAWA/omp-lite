# rqw-runtime-config

RQW Runtime Config: общие настройки OMP 19.1.0. Кода нет.

**Назначение:**
1. общие настройки харнеса: провайдеры, модели, роли, тулы, интерфейс, служебное.
2. порог сжатия контекста 400k: `compaction.modelThresholds`, 20 моделей, значение `f400000`.

**Правило:** один ключ лежит в одном месте. Здесь только настройки, которые не принадлежат ни одному плагину. Свои настройки несут `rqw-base-tools`, `rqw-harness-interface`, `rqw-codex-adapter`. Итоговый конфиг это сумма их файлов.

**Вход:** `config.yml` и фрагмент `zai-models.yml`. Оба в [манифесте](../../../install.manifest.json).

**Подогрев:** `providers.cacheWarmingStrategy: keepalive` не запускает сжатие ради сохранения кэша при долгом вызове тула. Когда подогрев перестаёт окупаться, кэш может истечь. `providers.cacheWarming` не задан: штатный `idle` допускает подогрев и в простое. Обычные пороги сжатия не меняются.

**Руление на лету:** `providers.openaiLiveSteering: true`. Сообщение, набранное во время ответа модели GPT-6, уходит в этот же ответ по WebSocket Codex, а не ждёт границы тула. Работает только на `openai-codex` и только пока соединение идёт по WebSocket (`providers.openaiWebsockets`, по умолчанию `auto`).

**Экран:** `display.smoothStreaming: false` показывает текст и аргументы тулов по мере получения, без искусственной печати. Сам стриминг и остальные анимации не выключены. `display.collapseCompacted: true` прячет чат до компакшена за сводкой. `tui.autoGraph: "off"`: графиков под таблицами и запросов судье нет.

**Модели:** открыты `anthropic`, `openai-codex`, `opencode-go`, `openrouter`, `zai`. `enabledModels` и `perCall` держат одни и те же 12 имён: четыре Claude, четыре GPT, DeepSeek и три GLM. Моделей `opencode-go` в списках нет: провайдер открыт для остатков подписки. `providers.openrouterVariant: floor` просит самого дешёвого поставщика. Ключ OpenRouter кладут руками в `~/.omp/agent/models.yml`.

**Z.ai:** `zai/glm-5.3` и `zai/glm-5.3-flash` используют штатные маршруты OMP для Coding Plan. `zai-api/glm-5.3-flashx` использует отдельный стандартный ключ и оплачивается по токенам, независимо от подписки.

**Хуки:** нет.

**Модель по умолчанию не закреплена:** ключа `modelRoles.default` нет. В OMP 19.1.0 без сохранённого выбора и `--model` сессия берёт первую доступную модель из `enabledModels`, сейчас это `anthropic/claude-sonnet-5-5`. Роль `default` ставится только твоим выбором через `/model`, и тогда выбор запоминается. Пресеты и `--model` работают как раньше. Роли `web` (Luna) и `perCall` остались.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Секретов нет.

**Выключение:** вернуть `config.bak` и убрать добавленную секцию `providers.zai-api` из `models.yml`.

**Тест:** `bun test dev/tests/harness/rqw-runtime-config`. Правило одного места проверяет `bun test dev/tests/install`.

**Границы:**
- **Обвязка Claude Code выключена:** в `disabledProviders` стоят `claude` (`.claude/` проекта и `~/.claude/`: `CLAUDE.md`, скиллы, команды, хуки, тулы, расширения, `settings.json`, `SYSTEM.md`, MCP), `claude-md` (`CLAUDE.md` в проекте и выше) и `claude-plugins` (плагины Claude Code и их сабагенты). Модели Claude и вход в подписку Anthropic работают. Не выключаются штатно: разовое чтение `~/.claude/history.jsonl` демоном подсказок композера при пустой базе, импорт `--from-claude`, `omp claude-trace`.
- `enabledModels` только прячет модели из выбора. Провайдера закрывает `disabledProviders`.
- Новый провайдер новой версии OMP надо дописать в `disabledProviders` руками.
- Новую модель надо дописать в три места: `enabledModels`, `perCall`, карта порогов.
- Модель вне карты порогов сжимается по правилам OMP.

**Механика OMP 19.1.0**, каталог `packages/coding-agent/src`: `config/compaction-threshold.ts` (формы порога, точное имя главнее шаблона), `config/model-settings.ts` (`modelRoles`, `enabledModels`, `disabledProviders`), `config/model-resolver.ts` (`normalizeModelPatternList`, `resolveModelRoleValue`: роль это список через запятую, берётся первая доступная модель), `task/model-approval.ts` (список моделей в описании тула `task` строится из `perCall`), `session/settings.ts` (`providers.openrouterVariant`, подогрев, `retry.fallbackChains`), `session/cache-warmer.ts` (подогрев и стратегия), `tools/settings.ts` (`tools.approvalMode`, `dev.autoqaConsent`), `modes/controllers/event-controller.ts` (плавное появление текста и аргументов).

**Маршруты Z.ai в OMP 19.1.0:** `packages/catalog/src/compat/rules/providers/zai.kdl` (штатные модели), `packages/coding-agent/src/config/custom-models.ts` (отдельный провайдер для платного API), `config/resolve-config-value.ts` (чтение ключа из окружения).
