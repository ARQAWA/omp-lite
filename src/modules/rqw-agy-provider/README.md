# rqw-agy-provider

AGY Antigravity: нативный провайдер моделей Google Antigravity для OMP. OMP сам собирает пакет запроса и шлёт его в Google, без посредников.

**Назначение:**
1. провайдер `agy` на Mac: Neon, Hydrogen, Argon и новые Gemini из штатной команды `agy models`; усилие выбирается в OMP;
2. авторизация из keychain agy (`gemini`/`antigravity`), при пустом keychain из файла токена agy, с обменом refresh-токена на access;
3. пакет запроса как у оригинального agy-клиента: конверт `project`/`requestId`, `systemInstruction` с role user, `tools` с legacy `parameters`, labels, `sessionId`, тул-цикл с `id` от сервера;
4. неявный кэш Google: неизменный префикс и стабильные ids конверсации, `cachedContentTokenCount` уходит в `cacheRead`;
5. квота Gemini: свой запрос `retrieveUserQuotaSummary`, окна недели и 5 часов уходят в `omp usage` через `usage` провайдера.

**Источник поведения:** митм-реверс agy-клиента 1.5.14. Инструмент для новых снимков — репозиторий `~/ai-project/agy-tools` (по соседству с omp-lite): mitm-прокси и CA, запуск описан в его README. Константы — в `rqw-agy-provider.json`.

**Вход OMP:** расширение `extensions/rqw-agy-provider/index.js`, `pi.registerProvider("agy", ...)` с собственным api `agy-api` и `streamSimple`. Квоту отдаёт `usage: { id: "agy", fetchUsage }` в том же `registerProvider`. Механика расширений, `streamSimple` и `usage?: UsageProvider` — OMP 19.1.1 `packages/coding-agent/src/extensibility/`, `packages/ai/src/api-registry.ts`.
Новинки добавляет `fetchDynamicModels`; их список кэширует OMP. Лимиты берутся из встроенного каталога OMP, если там есть этот ID. Без данных об окне действует штатный размер OMP.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Отдельный вход не нужен: agy уже залогинен, провайдер читает его токен.

**Выключение:** отключить `extension-module:rqw-agy-provider`.

**Тест:** `bun test dev/tests/harness/rqw-agy-provider`.

**Границы:**
- только Google-модели; Claude и GPT-OSS через Antigravity не входят;
- ключ schemas тулов чистится до ключей agy (`cleanSchema`): `minimum`, `minLength`, `minItems` идут полями, прочие ключи сворачиваются в description;
- 401 — один повторный обмен токена, прочие ошибки уходят в стрим как error;
- оборванный без finishReason пустой стрим повторяется один раз; блокировка фильтра отдаётся как ошибка с blockReason;
- в `omp usage` уходят только окна Gemini, неделя и 5 часов; квота Argon, Claude и GPT не входят.
- без `SYSTEM.md` сервер Google отвечает `429` на штатный промпт OMP: фильтр на строку `You are omp's trusted coding assistant`. Промпт из `SYSTEM.md` проходит.
