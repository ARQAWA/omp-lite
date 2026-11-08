# turn-duration

Одна тусклая строка после долгого хода: сколько агент работал.

```text
⏱ 2m 4s
```

Счёт идёт от старта агентского цикла до его конца, вместе с тулами. Не только генерация модели.

Порог 30 секунд: короткие ходы молчат. Прерванный ход строки не оставляет.

Строка живёт в истории сессии и в контекст модели не уходит.

Источник: пакет `pi-response-duration` (MIT). Переписан под OMP: там нет `agent_before_settle` и `registerEntryRenderer`, поэтому строка идёт через `sendMessage` и `registerMessageRenderer`.

**Вход:** `~/.omp/agent/extensions/turn-duration.js`.

**Выключить:** удалить файл.

**Тесты:** `bun test dev/tests/harness/turn-duration`.
