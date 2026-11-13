# memory-guide

Расширение OMP. Дописывает в системный промпт короткий блок `<memory_use>`: когда звать память и что в неё не класть.

**Условие:** настройка `memory.backend` равна `mnemopi`. Иное значение: блока нет.

**Вход OMP:** событие `before_agent_start` и чтение настройки через `lookup(id)` из `@oh-my-pi/pi-coding-agent/config/registry`.

**Вход:** `~/.omp/agent/extensions/memory-guide.js` и `memory-guide.json` рядом с ним.

**Поведение:** блок встаёт последним элементом системного промпта. Описания тулов памяти остаются родными. Сверки с эталоном нет.

**Выключить:** удалить оба файла или выключить память.

**Тест:** `bun test dev/tests/harness/memory-guide`.
