# voice-stt — диктовка

Голос в поле ввода OMP. Alt+W начинает запись, второе Alt+W вставляет текст.
Распознаёт Soniox. Звук пишет `ffmpeg`.

Источник: плагин [pi-voice-stt](https://github.com/cgarrot/pi-voice-stt) `v0.11.0`,
коммит `1e134b919275b7c7b7840fbb59c0adbd4f6b2379`, лицензия MIT ([LICENSE](pi-voice-stt/LICENSE)).
Каталог `pi-voice-stt/` это копия `package.json`, `LICENSE` и `src/` из этого коммита.
Импорты `@earendil-works/*` OMP подменяет на свои сам.

## Наша правка

Одна. На Windows VDI ffmpeg идёт той же цепочкой, что `omp.exe` и сервер памяти:
PowerShell, затем Git Bash `--login -i -c`, затем `ffmpeg`. Правку включает переменная
`OMPCLI_GIT_BASH`, её ставит расширение `ompcli`. Без неё и вне Windows плагин работает
как в оригинале. Остановка записи на VDI снимает всё дерево процессов через `taskkill /T`:
иначе ffmpeg держал бы микрофон.

Файлы правки: `src/audio/launch.ts` (новый), строки запуска в `src/audio/ffmpeg-recorder.ts`,
`src/audio/stream-recorder.ts` и две проверки ffmpeg в `src/index.ts`.

## Ресурсы

|файл|назначение|
|---|---|
|`pi-voice-stt/`|плагин, ставится в `~/.omp/agent/extensions/pi-voice-stt/`|
|`stt.json`|конфиг для Mac: микрофон `:MacBook Air Microphone`|
|`stt.windows.json`|конфиг для VDI: `dshow`, имя микрофона Windows|

Клавиши: `alt+w` запись, `alt+shift+s` профиль. `ctrl+r` и `alt+r` из оригинала заняты в OMP.
`pi.getShortcutConflict` подтвердил: с нашим харнесом `alt+w`, `alt+shift+s` и `ctrl+shift+r` свободны.

## Ключ и конфиг

Ключ только в `SONIOX_API_KEY`. В репозитории и конфигах ключа нет.

- Mac: `export PI_STT_CONFIG=~/.omp/agent/extensions/pi-voice-stt/stt.json` и `SONIOX_API_KEY`
  в профиле оболочки, `ffmpeg` в `PATH` (`brew install ffmpeg`).
- VDI: всё ставит `ompcli`. Ключ лежит в файле `%APPDATA%\Code\User\globalStorage\arqawa.ompcli\ad591530-694c-42f1-9f01-f03bee4cca1c.txt`.
  Плагин читает этот файл при каждой записи. Путь знает конфиг окна, его пишет вкладка.

Проверено 11.11 на Mac: живая запись с микрофона дала текст в поле ввода.

## Проверка

`/stt doctor`, затем `/stt start` и `/stt stop`. Текст встаёт в поле ввода.

**Выключить:** удалить каталог `~/.omp/agent/extensions/pi-voice-stt/`.

**Тесты:** `bun test dev/tests/harness/voice-stt`.
