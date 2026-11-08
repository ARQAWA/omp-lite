# file-workflow

Расширение OMP. Шесть тулов в форме Cursor: `read`, `grep`, `glob`, `bash`, `edit`, `write`. Каждый держит имя штатного тула OMP и передаёт вызов штатному тулу через `ctx.invokeTool`.

**Вход OMP:** `omp://extensions.md` — `pi.registerTool`, `ctx.invokeTool`; `omp://extension-loading.md` — подпапка с `index.js`; `omp://tools/edit.md` — режимы `edit`; `omp://settings.md` и `omp://tools/bash.md` — `bashInterceptor`.

## Сборка

Логики в `execute` нет. `execute` — короткая цепочка чистых функций. Функция не знает про OMP: вход и выход — обычные данные.

|тул|цепочка|
|---|---|
|`read`|`parseReadArgs` → файл → `readTextRange` → `renderRead`|
|`grep`|`parseGrepArgs` → `buildSearchRequest` → `searchWorkspace` → `applyPagination` → `formatSearchResult`|
|`glob`|`parseGlobArgs` → `buildGlobRequest` → `searchWorkspace` → `mapToGlob` → `formatGlob`|
|`bash`|`cleanBashParams` → `mapBashArgs` → `blockThreshold` → `ctx.invokeTool`|
|`edit`|`cleanParams` → `chooseEditMode` → `parsePatch`/`runPatch` или `replaceItems`/`runReplaceItems`|
|`write`|`parseWriteItems` → `runWriteItems` → `writeResult`|

Свитчеры: `buildSearchRequest` выбирает режим content, files или count; `mapBashArgs` выбирает background, порог или сервис; `chooseEditMode` выбирает патч или замену; `parseWriteItems` выбирает один файл или пачку; `parseReadArgs` выбирает файл целиком или диапазон.

## Микрофункции

|файл|функции|
|---|---|
|`shared/data.js`|`dropEmpty`, `sortedSchema`|
|`shared/tool-text.js`|`toolText`, `truncateOutput`|
|`shared/paging.js`|`resolvePath`, `resolveRealPathStrict`, `isInsideWorkspaceRoot`, `lockKey`, `inFlight`|
|`shared/args.js`|`receivedName`, `checkType`, `invalidArguments`, `optionalString`, `optionalEnum`, `lenientNumber`, `optionalLenientNumber`, `booleanLike`|
|`shared/search/engine.js`|`searchWorkspace`, `classifyRipgrepMessage`|
|`shared/search/format.js`|`formatBlock`, `formatSearchError`, `GREP_CHAR_BUDGET`, `GLOB_CHAR_BUDGET`|
|`tools/read/args.js`|`parseReadArgs`|
|`tools/read/lines.js`|`readTextRange`, `computeReadSlice`, `formatReadCodeBlock`, `isBinary`|
|`tools/read/render.js`|`growToBlocks`, `renderRead`|
|`tools/grep/args.js`|`parseGrepArgs`, `toInt32`|
|`tools/grep/request.js`|`buildSearchRequest`|
|`tools/grep/format.js`|`formatSearchResult`, `applyPagination`, `SearchResultCache`|
|`tools/glob/glob.js`|`parseGlobArgs`, `normalizeGlob`, `buildGlobRequest`, `mapToGlob`, `formatGlob`|
|`tools/bash/args.js`|`cleanBashParams`, `chooseConcurrency`, `mapBashArgs`, `blockThreshold`|
|`tools/edit/args.js`|`cleanParams`, `chooseEditMode`, `replaceItems`|
|`tools/edit/patch.js`|`parsePatch`, `splitFileLines`, `lineSimilarity`, `nearestMatchText`, `groupPatchSections`, `runPatch`, `formatPatchRuns`, `patchResult`|
|`tools/edit/replace.js`|`runReplaceItems`, `formatReplaceRuns`, `replaceResult`|
|`tools/write/items.js`|`parseWriteItems`, `runWriteItems`, `formatWriteRuns`, `writeResult`|
|`index.js`|`ensureTools`|

`growToBlocks` получает границы блоков готовыми: дерево разбора спрашивает `read/index.js`, функция только расширяет диапазон. Так она остаётся чистой.

## Решения

- **Нативные имена.** Тулы называются как штатные, поэтому OMP отдаёт им `ctx.invokeTool` и их же рендеры. `read` уходит в штатный тул для `xd://`, `local://`, картинок и PDF.
- **`edit` по модели.** На старте сессии расширение ставит настройки `edit.mode: replace` и `edit.modelVariants: {gpt: apply_patch}`. GPT получает свободный патч, остальные — `path`, `old_string`, `new_string`.
- **Занятый файл.** `edit` и `write` держат общий набор ключей `inFlight`. Пока один тул пишет файл, второй отказывает по этому файлу и не трогает остальные.
- **`edit.mode`.** Штатный режим `hashline` не принимает поля замены, поэтому настройка переопределяется. Это единственная правка настроек хоста.

## Выключить

Удалить `~/.omp/agent/extensions/file-workflow/`. Штатные тулы вернутся: расширение их только перекрывает.

## Установка

```bash
cp -R src/modules/file-workflow ~/.omp/agent/extensions/file-workflow
```

**Настройка OMP:** `bashInterceptor` в [config.yml](../runtime-config/config.yml) включает штатную маршрутизацию `cat`, `rg`, `sed` на `read`, `grep`, `edit`.

## Границы

- Поля `todo` в схемах нет: модуль не регистрирует тул `todo`.
- `read` не обслуживает `xd://eval/<topic>`: тула `eval` в модуле нет.
- Рендеры тулов штатные: своих `renderCall` и `renderResult` нет.
- Сеть не используется. Поиск идёт штатным движком OMP внутри процесса.

## Тесты

```bash
bun test dev/tests/harness/file-workflow
```

Тесты подменяют `@oh-my-pi/pi-natives` и `config/registry` через `dev/tests/harness/file-workflow/stubs.js`. Файлы — временная папка. Настоящий OMP и сеть не нужны.
