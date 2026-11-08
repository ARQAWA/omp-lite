# background-jobs

Счётчик фоновых процессов сессии в статуслайне.

```text
⚙ 2
```

Метка есть, пока сессия держит фоновые задачи. На нуле метка исчезает.

Источник — `ctx.getAsyncJobSnapshot().running`. Опрос раз в две секунды, только главный TUI.

**Вход:** `~/.omp/agent/extensions/background-jobs.js`.

**Выключить:** удалить файл.

**Тесты:** `bun test dev/tests/harness/background-jobs`.
