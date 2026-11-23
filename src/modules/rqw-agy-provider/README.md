# rqw-agy-provider

AGY Antigravity: нативный провайдер моделей Google Antigravity для OMP. OMP сам собирает пакет запроса и шлёт его в Google, без посредников.

**Назначение:**
1. провайдер `agy` на Mac: Neon, Hydrogen, Argon и новые Gemini из штатной команды `agy models`; усилие выбирается в OMP;
2. авторизация из keychain agy (`gemini`/`antigravity`) с обменом refresh-токена на access;
3. пакет запроса как у оригинального agy-клиента: конверт `project`/`requestId`, `systemInstruction` с role user, `tools` с legacy `parameters`, labels, `sessionId`;
4. неявный кэш Google: неизменный префикс и стабильные ids конверсации, `cachedContentTokenCount` уходит в `cacheRead`.

**Источник поведения:** митм-реверс agy-клиента 1.5.14. Инструмент для новых снимков — репозиторий `~/ai-project/agy-tools` (по соседству с omp-lite): mitm-прокси и CA, запуск описан в его README. Константы — в `rqw-agy-provider.json`.

**Вход OMP:** расширение `extensions/rqw-agy-provider/index.js`, `pi.registerProvider("agy", ...)` с собственным api `agy-api` и `streamSimple`. Механика расширений и `streamSimple` — OMP 19.1.1 `packages/coding-agent/src/extensibility/`, `packages/ai/src/api-registry.ts`.
Новинки добавляет `fetchDynamicModels`; их список кэширует OMP. Лимиты берутся из встроенного каталога OMP, если там есть этот ID. Без данных об окне действует штатный размер OMP.

**Установка:** по [INSTALL.md](../../../INSTALL.md). Отдельный вход не нужен: agy уже залогинен, провайдер читает его keychain.

**Выключение:** отключить `extension-module:rqw-agy-provider`.

**Тест:** `bun test dev/tests/harness/rqw-agy-provider`.

**Границы:**
- только Google-модели; Claude и GPT-OSS через Antigravity не входят;
- ключ schemas тулов чистится до ключей Google (`cleanSchema`), запрещённые ключи сворачиваются в description;
- 401 — один повторный обмен токена, прочие ошибки уходят в стрим как error;
- оборванный без finishReason пустой стрим повторяется один раз; блокировка фильтра отдаётся как ошибка с blockReason;
- квоты и лимиты — как у аккаунта agy.
