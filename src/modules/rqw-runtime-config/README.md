# rqw-runtime-config

RQW Runtime Config: общие настройки OMP 18.22.1 одним файлом. Кода нет.

**Назначение:**
1. общие настройки харнеса: провайдеры, модели, роли, тулы, интерфейс, служебное.
2. порог сжатия контекста 400k: `compaction.modelThresholds`, 18 моделей, значение `f400000`.

**Правило:** один ключ лежит в одном месте. Здесь только настройки, которые не принадлежат ни одному плагину. Свои настройки несут `rqw-base-tools`, `rqw-harness-interface`, `rqw-codex-adapter`. Итоговый конфиг это сумма их файлов.

**Вход:** `config.yml`, 57 значений. Запись `config` в [манифесте](../../../install.manifest.json).

**Модели:** открыты `anthropic`, `openai-codex`, `opencode-go`, `openrouter`, `antigravity-cli`. Остальные 95 провайдеров стоят в `disabledProviders`: белого списка в OMP нет. `enabledModels` и роль `perCall` держат одни и те же 10 точных имён: четыре Claude, четыре GPT, DeepSeek через `openrouter`, Gemini 4 Hydrogen через `antigravity-cli`. `perCall` это модели, которые можно назвать сабагенту. Моделей `opencode-go` в списках нет; сам провайдер открыт: статуслайн показывает остаток его подписки. `modelRoles.default`: цепочка из четырёх моделей, OMP берёт первую доступную. `providers.openrouterVariant: floor` просит самого дешёвого поставщика. Ключ OpenRouter сюда не входит: его кладут руками в `~/.omp/agent/models.yml`.

**Хуки:** нет.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Прежний `modelRoles.default` машины сохраняется. Секретов нет.

**Выключение:** вернуть конфиг из копии `config.bak`.

**Тест:** `bun test dev/tests/harness/rqw-runtime-config`. Правило одного места проверяет `bun test dev/tests/install`.

**Границы:**
- `enabledModels` только прячет модели из выбора. Провайдера закрывает `disabledProviders`.
- Новый провайдер новой версии OMP надо дописать в `disabledProviders` руками.
- Новую модель надо дописать в три места: `enabledModels`, `perCall`, карта порогов.
- Модель вне карты порогов сжимается по правилам OMP.

**Механика OMP 18.22.1**, каталог `packages/coding-agent/src`: `config/compaction-threshold.ts` (формы порога, точное имя главнее шаблона), `config/model-settings.ts` (`modelRoles`, `enabledModels`, `disabledProviders`), `config/model-resolver.ts` (`normalizeModelPatternList`, `resolveModelRoleValue`: роль это список через запятую, берётся первая доступная модель), `task/model-approval.ts` (список моделей в описании тула `task` строится из `perCall`), `session/settings.ts` (`providers.openrouterVariant`, `retry.fallbackChains`), `tools/settings.ts` (`tools.approvalMode`, `dev.autoqaConsent`).
