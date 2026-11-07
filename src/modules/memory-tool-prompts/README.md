# memory-tool-prompts

Расширение OMP. Подменяет описания тулов памяти `recall`, `retain`, `reflect`, `memory_edit` и `learn` при запуске сессии. Форк OMP не нужен.

**Почему костыль:** штатной настройки описаний встроенных тулов в OMP нет. Способ проверен по `omp://extensions.md` (хуки `before_provider_request`, `tool_result`, `session_start`) и `omp://mnemosyne-memory-backend.md` (состав тулов).

**Вход:** `~/.omp/agent/extensions/memory-tool-prompts.js`.

**Наблюдаемое поведение:**
- текст совпал с эталоном — описание заменяется;
- текст разошёлся — замена не делается;
- при расхождении сразу выходит предупреждение `warning`;
- в статус-баре остаётся `memory patch stale: <имена>`;
- состояние пишется в `~/.omp/agent/memory-tool-prompts.status.json`.

**Границы:** если OMP переименует тул, он станет `missing` без всплывающего варнинга. Системный блок памяти не меняется. Текущая сессия видит старый текст до перезапуска.

**Выключить:** удалить файл.

**Тесты:** `bun test dev/tests/harness/memory-tool-prompts`.
