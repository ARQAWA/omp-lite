# rqw-base-tools

тулинг агента для работы с файлами. родные тулы OMP остаются родными.

**назначение:**
1. тул `files`: карта проекта и широкий поиск одним вызовом.
2. свои описания `grep`, `glob`, `read`, `bash`, `edit`, `write`. у `edit` два текста: режим `hashline` и режим `replace`.
3. сторож: предупреждение владельцу, если OMP поменял тулы, настройки или движок.
4. правка по файлам в режиме `hashline`: несошедшийся файл пропускается, остальные пишутся. снимки файлов из `read` и `edit` идут в сухой прогон: старая метка файла принимается, как в сессии. в режиме `replace` один вызов это одна замена, код не нужен.
5. метка `[whole file: N lines]` в ответе `read`.

**вход:** `index.js`, `rqw-base-tools.texts.json`, `rqw-base-tools.reference.json`, `rqw-base-tools.yml`.

**хуки:** `session_start`, `before_provider_request`, `tool_call`, `tool_result`, `tool_execution_end`. тул: `files`.

**установка:** три файла в `~/.omp/agent/extensions/rqw-base-tools/`. `rqw-base-tools.yml` вливается в `config.yml`. записи в `install.manifest.json`.

**настройки:** `rqw-base-tools.yml`, 16 значений. восемь из них сверяет сторож. четыре ключа выноса ответа в файл: `tools.artifactHeadBytes`, `tools.artifactTailBytes`, `tools.artifactTailLines`, `tools.artifactMaxBytes`. `find.enabled: "off"` и `astGrep.enabled: false`. перехват bash: `bashInterceptor.enabled: true` и 12 правил.

**перехват bash:** чтение, поиск, списки и правка на месте уходят родным тулам. свои `patterns` заменяют встроенный список OMP, не дополняют. это предпочтение, не изоляция: пайпы и код интерпретаторов проходят.

**выключение:** `extension-module:rqw-base-tools` в `disabledExtensions`. настройки файла убрать из конфига руками.

**тест:** `bun test dev/tests/harness/rqw-base-tools`.

**костыль:** импорт движка OMP `@oh-my-pi/pi-natives` из расширения. штатного способа нет. сторож сверяет его экспорты.

**после обновления OMP:** переснять эталон с живого запроса. проверить числа в текстах.

**правка текста:** изменить JSON и открыть новую сессию.
