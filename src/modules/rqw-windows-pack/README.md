# rqw-windows-pack

RQW Windows Pack переносит харнес на Windows VDI без прав администратора. Для OMP 18.18.8.

1. **OMP во вкладке VS Code.** Расширение `arqawa.ompcli` несёт `omp.exe` и ставит харнес само.
2. **Локальная память.** Сервер llama.cpp с моделью EmbeddingGemma 2 270M Q8_0, без Ollama.
3. **Диктовка.** `alt+w` начинает запись, второй `alt+w` ставит текст в конец поля ввода. Работает на VDI и на Mac.

**До правки запуска прочти [dev/VDI.md](../../../dev/VDI.md): правило запуска и факты о VDI.**

## Файлы

- `vscode/index.js`: весь код расширения VS Code. `vscode/package.json`: три команды и две клавиши.
- `vscode/runtime.json`: закреплённые программы и модель, с размером и SHA-256. Единственное место пинов.
- `vscode/messages.json`: все видимые тексты, английский. `vscode/licenses/`: лицензии программ и модели.
- `voice/`: копия плагина [pi-voice-stt](https://github.com/cgarrot/pi-voice-stt) `v0.11.0`, коммит `1e134b919275b7c7b7840fbb59c0adbd4f6b2379`, MIT.
- `voice/stt.json`: конфиг Mac. `voice/stt.windows.json`: конфиг VDI. Отличие машин одно: блок `capture`, микрофон.

В рантайме мест два. `vscode/` это расширение VS Code. `voice/` это расширение OMP в `~/.omp/agent/extensions/pi-voice-stt/`. На VDI второе место заполняет первое: ставится только расширение VS Code.

## Команды и клавиши

Категория `OMP CLI`: `New Tab` (вкладка `OMP N`), `New Terminal Tab` (Git Bash с `omp` в `PATH`, вкладка `OMP terminal N`), `Update`. Вход в провайдеров: обычный `/login`.

Перед командой расширение проверяет Windows x64, Git Bash `C:\Program Files\Git\bin\bash.exe`, `node-pty` внутри VS Code и профиль OMP по умолчанию. Оно ничего из этого не ставит, только называет причину. Активация только регистрирует команды.

Во вкладке расширения Shift+Enter уходит как `ESC[13;2u` (перенос строки), Ctrl+Enter как `ESC[13;5u` (сообщение в очередь). В чужих терминалах клавиши не перехватываются.

## Цепочка запуска

Программу из поставки расширение запускает только так:

```text
node-pty из VS Code
  -> powershell.exe -NoLogo -NoProfile -Command "& 'C:\Program Files\Git\bin\bash.exe' --login -i -c '<команда>'"
     -> Git Bash
        -> программа
```

Каждый аргумент команды стоит в одинарных кавычках, в путях прямые слеши, двойных кавычек нет, секреты идут только через окружение. Так идут `omp.exe` и `llama-server.exe`. `ffmpeg.exe` запускает сам OMP тем же хвостом: PowerShell, Git Bash, программа. Прямой запуск программы из extension host VDI запрещает (`spawn EPERM`). Сам extension host запускает одну программу: `curl.exe` из `System32`.

## Программы и сеть

В VSIX лежат `runtime/omp.exe`, `runtime/llama/` и `runtime/ffmpeg.exe`. Скачивается только модель памяти, это данные: `globalStorage/model/`, проверка размера и SHA-256 при каждой вкладке.

Прокси берётся из `http.proxy`; настройка пуста: из окружения VS Code (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`). С прокси всё идёт через `curl.exe` с тремя повторами загрузки, без прокси через `fetch`. `http.proxyStrictSSL: false` добавляет `--insecure` и ставит вкладке `NODE_TLS_REJECT_UNAUTHORIZED=0`; без этой настройки проверка TLS не выключается. Пароль прокси идёт только через окружение.

## Установка харнеса

Харнес ставится при открытии вкладки и командой `Update`, внутри extension host, без программ. Состав задаёт [install.manifest.json](../../../install.manifest.json): `files` копируются в `~/.omp/agent`, пути `remove` удаляются. Абсолютные пути, `..` и ссылки отклоняются. Изменяемый файл сначала уходит в `agentDir/.ompcli-backups/` с журналом; ошибка возвращает прежнее состояние, прерванную установку откатывает следующая.

`config.yml` расширение не читает и не пишет. Фрагменты `config` манифеста идут в OMP слоями через `PI_CONFIG_FILES`: прежние слои владельца, фрагменты по порядку манифеста, слой памяти окна. Поздний слой перекрывает ранний, все слои перекрывают `config.yml`.

Перед первой командой окна расширение чистит `globalStorage`. Остаются `model/`, `payload/<версия расширения>/`, `runs/` и `shell-<pid>.sh` живых окон, `stt.json`, файл ключа диктовки. Остальное удаляется.

## Update

`Update` берёт `main` из `ARQAWA/omp-lite`, распаковывает названные манифестом файлы в `globalStorage/payload/<версия>/<sha>/` и ставит их тем же установщиком. Указатель `current.json` пишется в одной транзакции с файлами. После успеха прочие ревизии удаляются. Ревизию, которая уже лежит на диске, `Update` ставит заново: потерянный файл возвращается.

- Открыты вкладки OMP: `Close OMP CLI tabs before updating.`
- В `main` другой `runtime.json`, то есть сменились программы: `OMP CLI bootstrap changed. Update OMP CLI in Marketplace.` Ничего не ставится.
- В `main` другой код расширения: харнес ставится, VS Code пишет `A newer OMP CLI is in Marketplace.`
- Блок `__metadata`, который VS Code дописывает в `package.json`, изменением не считается.

**`Update` и обновление расширения делаются при одном открытом окне VS Code без вкладок OMP.** Защиты между окнами нет.

## Память

Один сервер на окно: `127.0.0.1`, свободный порт, случайный ключ в `LLAMA_API_KEY`. Готовность: `/health` до 60 секунд, потом две пробы `/v1/embeddings` по 768 чисел. Умерший сервер получает до трёх попыток. Слой окна: `globalStorage/runs/<pid>-<uuid>/memory.yml`. Последняя закрытая вкладка гасит сервер.

Любой сбой памяти (нет модели, нет сервера, сервер не поднялся) вкладку не закрывает: слой ставит `memory.backend: off`, VS Code пишет `OMP CLI: memory is off. <причина>` с последними строками терминала сервера. Следующая вкладка пробует снова. Проверка без консоли: в колокольчике VS Code нет строки `memory is off`; агент называет `recall` и `retain`.

## Диктовка

Распознаёт Soniox `stt-async-v5`, звук пишет `ffmpeg`. `Enter` во время записи сразу отправляет текст, `Esc` отменяет, `alt+shift+s` открывает профили. Текст приходит через 2-5 секунд после остановки.

Правок в копии плагина две:

1. Запуск `ffmpeg` на VDI цепочкой: `src/audio/launch.ts` и строки запуска в `ffmpeg-recorder.ts`, `stream-recorder.ts`, `index.ts`. Включает переменная `OMPCLI_GIT_BASH`, её ставит вкладка. Слеши меняются только в путях Windows. Остановка снимает дерево процессов через `taskkill`.
2. Имя для OMP: корневой `index.ts` и `pi.extensions: ["./index.ts"]`. OMP видит плагин как `pi-voice-stt`, не как `src`.

Ключа нет в репозитории и в поставке. Mac: `SONIOX_API_KEY`, `export PI_STT_CONFIG=~/.omp/agent/extensions/pi-voice-stt/stt.json` и `ffmpeg` в `PATH`; Option работает как Meta. VDI: вкладка пишет `globalStorage/stt.json` из `stt.windows.json` и пути к файлу ключа `%APPDATA%\Code\User\globalStorage\arqawa.ompcli\ad591530-694c-42f1-9f01-f03bee4cca1c.txt`. В файле одна строка: ключ. Плагин читает его при каждой записи; файла нет: ошибка называет путь. Проверка: `/stt doctor`, потом `/stt start` и `/stt stop`.

## Выключение

Удалить расширение из VS Code: программы и слои настроек уходят с ним; файлы в `~/.omp/agent`, модель и базы памяти остаются. Диктовка: строка `extension-module:pi-voice-stt` в настройке `disabledExtensions`.

## Механика OMP 18.18.8

Каталог исходников: `packages/coding-agent/src`.

- `config/settings.ts`: слои настроек из `PI_CONFIG_FILES` и `--config`, поздний побеждает.
- `discovery/helpers.ts`, `discoverExtensionModulePaths`: папка с `package.json` и полем `pi.extensions` грузит названный файл. `getExtensionNameFromPath`: для `index.ts` имя это папка-родитель.
- `extensibility/extensions/loader.ts`, `discoverExtensionPaths`: выключение по строке `extension-module:<имя>`.
- `extensibility/legacy-pi-coding-agent-shim.ts`: подмена импортов `@earendil-works/*`.
- `packages/tui/src/keys.ts`: разбор `ESC[13;2u` и `ESC[13;5u`.

## Известные проблемы

Их решено пока не трогать.

- Хеши программ при старте не сверяются: проверяются размер `omp.exe` и наличие сервера памяти.
- Слой настроек на VDI перекрывает `modelRoles.default` владельца.
- `PI_CONFIG_DIR` не учитывается. Именованный профиль OMP не поддерживается.
- Второе окно VS Code во время `Update` или первой вкладки после обновления может сломать установку.
- Любая правка `runtime.json` блокирует `Update`, правка адреса модели тоже.
- Заметка о новой версии может выйти зря, когда код в `main` правили без выпуска.
- В коде плагина диктовки: зависший запрос удаления в Soniox, ключ со знаком `=` в файле, склейка слов без пробела.
- `/stt doctor` микрофон не проверяет. Клиент VDI без проброса звука даёт пустую запись.

## Тест и сборка

`bun test dev/tests/harness/rqw-windows-pack`. Тесты идут на Mac и Windows не запускают; проверка VDI за владельцем.

Сборка папки расширения: `bun dev/scripts/rqw-windows-pack/build/index.js`, результат в `dist/ompcli`. Сборщик требует чистого рабочего дерева и программу `cabextract`. Упаковка: `vsce package --target win32-x64`.
