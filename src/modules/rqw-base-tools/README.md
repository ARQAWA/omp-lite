# rqw-base-tools

тулинг агента для работы с файлами. родные тулы OMP остаются родными.

**назначение:**
1. тул `files`: карта проекта и широкий поиск одним вызовом.
2. свои описания `grep`, `glob`, `read`, `bash`, `edit`, `write`.
3. сторож: предупреждение владельцу, если OMP поменял тулы, настройки или движок.
4. правка по файлам: несошедшийся файл патча пропускается, остальные пишутся.
5. метка `[whole file: N lines]` в ответе `read`.

**вход:** `index.js`, `rqw-base-tools.texts.json`, `rqw-base-tools.reference.json`, `rqw-base-tools.yml`.

**хуки:** `session_start`, `before_provider_request`, `tool_call`, `tool_result`, `tool_execution_end`. тул: `files`.

**установка:** три файла в `~/.omp/agent/extensions/rqw-base-tools/`. `rqw-base-tools.yml` вливается в `config.yml`. записи в `install.manifest.json`.

**выключение:** `extension-module:rqw-base-tools` в `disabledExtensions`. восемь настроек убрать из конфига руками.

**тест:** `bun test dev/tests/harness/rqw-base-tools`.

**костыль:** импорт движка OMP `@oh-my-pi/pi-natives` из расширения. штатного способа нет. сторож сверяет его экспорты.

**после обновления OMP:** переснять эталон с живого запроса. проверить числа в текстах.

**правка текста:** изменить JSON и открыть новую сессию.
