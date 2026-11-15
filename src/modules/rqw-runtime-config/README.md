# rqw-runtime-config

RQW Runtime Config: общие настройки OMP 18.20.2 одним файлом. Кода нет.

**Назначение:**
1. общие настройки харнеса: провайдеры, модели, роли, тулы, интерфейс, служебное.
2. порог сжатия контекста 400k: `compaction.modelThresholds`, 18 моделей, значение `f400000`.

**Правило:** один ключ лежит в одном месте. Здесь только настройки, которые не принадлежат ни одному плагину. Свои настройки несут `rqw-base-tools`, `rqw-harness-interface`, `rqw-codex-adapter`. Итоговый конфиг это сумма их файлов.

**Вход:** `config.yml`, 57 значений. Запись `config` в [манифесте](../../../install.manifest.json).

**Модели:** открыты `anthropic`, `openai-codex`, `opencode-go`, `openrouter`. Остальные 94 провайдера стоят в `disabledProviders`: белого списка в OMP нет. `enabledModels`: десять точных имён. Роль `perCall`: 80 моделей, которые можно назвать сабагенту. `providers.openrouterVariant: floor` просит самого дешёвого поставщика. Ключ OpenRouter сюда не входит: его кладут руками в `~/.omp/agent/models.yml`.

**Хуки:** нет.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Прежний `modelRoles.default` машины сохраняется. Секретов нет.

**Выключение:** вернуть конфиг из копии `config.bak`.

**Тест:** `bun test dev/tests/harness/rqw-runtime-config`. Правило одного места проверяет `bun test dev/tests/install`.

**Границы:**
- `enabledModels` только прячет модели из выбора. Провайдера закрывает `disabledProviders`.
- Новый провайдер новой версии OMP надо дописать в `disabledProviders` руками.
- Новую модель надо дописать в три места: `enabledModels`, `perCall`, карта порогов.
- Модель вне карты порогов сжимается по правилам OMP.

**Механика OMP 18.20.2**, каталог `packages/coding-agent/src`: `config/compaction-threshold.ts` (формы порога, точное имя главнее шаблона), `config/model-settings.ts` (`modelRoles`, `enabledModels`, `disabledProviders`), `session/settings.ts` (`providers.openrouterVariant`, `retry.fallbackChains`), `tools/settings.ts` (`tools.approvalMode`, `dev.autoqaConsent`).
