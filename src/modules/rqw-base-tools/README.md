# rqw-base-tools

тексты для родных тулов OMP и спасение патча. своих тулов нет: `grep`, `glob`, `read` родные.

**назначение:**
1. Свои строки в начале описаний `bash`, `edit`, `write`, `glob`. Хвост описания остаётся от OMP.
2. Правка по файлам в режиме `hashline`: независимая секция с неверным или непоказанным якорем пропускается, остальные идут на запись. Ошибка формата может отклонить весь патч. При ошибке записи надо проверить результат: часть файлов могла измениться.
3. Сторож сверяет описания и поля `bash`, `edit`, `write`, `glob`, восемь настроек и экспорты движка правки с эталоном.

**вход:** `index.js`, `rqw-base-tools.texts.json`, `rqw-base-tools.reference.json`, `rqw-base-tools.yml`.

**хуки:** `session_start`, `before_provider_request`, `tool_call`, `tool_result`, `tool_execution_end`.

**установка:** три файла в `~/.omp/agent/extensions/rqw-base-tools/`. `rqw-base-tools.yml` вливается в `config.yml`. записи в `install.manifest.json`.

**настройки:** `rqw-base-tools.yml`, 16 значений. Восемь из них сверяет сторож. `tools.intentTracing: true` сохраняет поле `i` в вызовах тулов и вне интерактивного режима. `grep.contextBefore/After: 3` действует на родной `grep`. `read.summarize.enabled: false`: файл читается целиком, без сводки. Четыре ключа выноса ответа в файл: `tools.artifactHeadBytes`, `tools.artifactTailBytes`, `tools.artifactTailLines`, `tools.artifactMaxBytes`. `find.enabled: "off"`, `astGrep.enabled: false` и `disassembler.backend: none`.

**bash:** перехвата и блокировок нет (`bashInterceptor.enabled` по умолчанию `false`, OMP 19.0.0 `exec/settings.ts`). описание `bash` даёт мягкое правило по образцу Cursor: есть тул, предпочти его команде оболочки.

**выключение:** `extension-module:rqw-base-tools` в `disabledExtensions`. настройки файла убрать из конфига руками.

**тест:** `bun test dev/tests/harness/rqw-base-tools`.

**костыль и границы:** импорт `@oh-my-pi/pi-natives` (`EditSession`, `EditStore`, `hashlineFileHash`) из расширения: штатного способа пробного прогона патча в OMP 19.0.0 нет; сторож проверяет экспорты. Проба идёт в отдельном хранилище показанных строк: расширение собирает их из ответов родных `read`, `grep` и `edit` по заголовкам `[path#TAG]` и дереву `# dir/` … `### file#TAG` (`tools/grep.ts`, `tools/read.ts`). Файл свыше 4 МиБ в хранилище не попадает. Окончательную правку и разрешения проверяет родной `edit`.

**после обновления OMP:** переснять эталон с живого запроса. проверить вид заголовков в ответах `read` и `grep`.

**правка текста:** изменить JSON и открыть новую сессию.
