# ompcli — OMP для Windows VDI

Расширение VS Code `arqawa.ompcli` ставит харнес omp-lite на Windows VDI и открывает
вкладки OMP без ручной установки. Проверку самой VDI делает владелец.

## Что делает

- `OMP CLI: New Tab` — вкладка OMP N. Цепочка: extension host → PowerShell → Git Bash → `omp.exe`.
- `OMP CLI: New Terminal Tab` — интерактивный Git Bash с комплектным `omp` и `bun` в `PATH`.
- `OMP CLI: Update` — забирает свежий `main` из `ARQAWA/omp-lite` и применяет харнес.
- Локальная память: `llama-server.exe` с моделью EmbeddingGemma 2 Q8_0 на loopback.

Активация только регистрирует команды. Модель не загружается, OMP не запускается.

## Вход OMP

- `omp://cli-reference.md` — запуск, `--config`, `--allow-home`.
- `omp://config-usage.md` — слои настроек и `PI_CONFIG_FILES`.
- `omp://environment-variables.md` — прокси, `NODE_EXTRA_CA_CERTS`, `MNEMOPI_*`.
- `omp://mnemosyne-memory-backend.md` — ключи `mnemosyne`, модель и API эмбеддингов.
- `omp://natives-shell-pty-process.md` — завершение дочерних процессов.

## Ресурсы

|файл|назначение|
|---|---|
|`index.js`|весь код: расширение VS Code и режим установщика `--install`|
|`package.json`|манифест расширения: три команды, Ctrl+Enter, `main: ./index.js`|
|`runtime.json`|пины OMP, Bun, модели, llama.cpp и CRT: `url`, `sha256`, `size`, `file`|
|`messages.json`|видимые сообщения, английский|
|`licenses/`|лицензии OMP, llama.cpp, LLVM OpenMP, модели, Bun и условия MSVC runtime|

`runtime.json` — единственное место пинов. Служебный сборщик находит его через
[install.manifest.json](../../../install.manifest.json), раздел `vscode`.

## Установка

Больших файлов в VSIX нет. При первом запуске расширение скачивает OMP 18.18.8, Bun
1.4.4 и модель в `globalStorage/runtime/<runtime-id>/`, где `runtime-id` — SHA-256
канонического `runtime.json`. Готовность отмечается файлом `.ready` после проверки всех
файлов. Повторный запуск сверяет размеры и хеши комплекта, поэтому удалённый файл
скачивается заново.

Сеть нужна к GitHub, Hugging Face и провайдерам. Если задан `http.proxy`, загрузка
идёт через `curl.exe` с этим прокси: `fetch` в extension host прокси не читает.
Явный `http.proxyStrictSSL: false` добавляет `--insecure`.

Харнес ставится по `install.manifest.json`: файлы `~/.omp/agent` и слияние `config.yml`.
Файлы из списка `remove` удаляются; опустевший каталог расширения тоже. Откат возвращает их.
Личные настройки, `auth`, `sessions` и `memories` не читаются и не копируются.
Фрагменты конфига в payload теряют блоки `memory` и `mnemopi`: на VDI их даёт overlay
окна, а постоянный конфиг остаётся личным.

Запись сериализуется именованным каналом `\\.\pipe\arqawa-ompcli-install-<sha256(agentDir)>`.
Внутри одного окна вкладки и `Update` берут канал по очереди: две первые вкладки
открываются вместе. Канал, занятый другим окном, даёт `OMP CLI installation is busy.`
Изменяемые файлы уходят в `agentDir/.ompcli-backups/` с журналом; ошибка возвращает
прежнее состояние. Живые вкладки регистрируются в `globalStorage/leases/<pid>.json`
вместе с ревизией payload. Вкладка, закрытая во время загрузки, записи не оставляет,
даже если загрузка потом упала.

`Update` берёт `main` из `ARQAWA/omp-lite`, кладёт payload в
`globalStorage/payload/<версия расширения>/<sha>/` и ставит его тем же установщиком.
Ревизию, которая уже лежит в хранилище или в самом расширении, `Update` ставит заново:
потерянный файл харнеса возвращается, а первый `Update` после установки расширения тоже
ставит харнес. Если всё на месте, изменений нет.
Указатель `current.json` пишется в одной транзакции с файлами харнеса: сбой любой
записи возвращает файлы, настройки и указатель. Архив качается в файл со своим именем
на каждую попытку: оборванная загрузка не мешает повтору. Каталог ревизии готовится под
тем же lease, что и установка: второе одновременное обновление получает
`OMP CLI installation is busy.` Сначала `Update` откатывает прерванную установку, потом
сверяет указатель. После загрузки откат и сверка повторяются под lease: готовую ревизию
второе обновление не трогает, а прерванную не принимает за готовую. Изменённый bootstrap требует
нового VSIX.

## Память

Один сервер на окно extension host, свободный порт на `127.0.0.1`, ключ процесса.
Запуск: `--embeddings --pooling mean --ctx-size 8192 --batch-size 8192 --ubatch-size 8192
--parallel 1 --threads 2 --no-webui`. Готовность — `GET /health` до 60 секунд, затем две
пробы `/v1/embeddings` с проверкой 768 измерений. Провал проб не открывает вкладку. Сервер,
который умер сразу после проб, запущенным не считается.

Окно получает свой overlay `globalStorage/runs/<pid>-<uuid>/memory.yml`. Перезапущенный
сервер имеет новый ключ, поэтому следующая вкладка получает новый overlay, даже на том же порту. Обе вкладки стартуют
через один bash-обёртку: она читает `~/.bashrc`, снимает строчные прокси, восстанавливает
`PATH`, `PI_CONFIG_FILES` и запускает OMP с `--config`. Прежние overlay остаются первыми в
списке. После `~/.bashrc` обёртка возвращает выбранные прокси, включая `PI_PROXY`.
Пароли прокси идут только через окружение. Постоянные настройки Mac не меняются.

## Выключение

Удалить расширение из VS Code. Файлы в `~/.omp/agent`, `globalStorage/runtime` и базы
памяти остаются. Отдельной настройки выключения нет.

## Границы

- Windows x64 и Git Bash `C:\Program Files\Git\bin\bash.exe` обязательны; расширение их не ставит.
- `node-pty` берётся из самого VS Code: `node_modules.asar/node-pty`, затем `node_modules/node-pty`.
- Именованный профиль OMP не поддерживается: `OMP CLI requires the default OMP profile.`
- Версия OMP закреплена: 18.18.8. Автообновления OMP нет.
- Проверка VDI, Windows-запуск и скриншоты принадлежат владельцу.

## Тесты

`dev/tests/harness/ompcli/` — установка, runtime, вкладки, память, обновление.
`dev/tests/repository/` — служебный загрузчик, staging и состав поставки.
Сборка staging: `bun dev/scripts/ompcli-build/index.js`. Сборщик требует чистого
рабочего дерева: `.revision` в payload должен совпадать с коммитом источников.
