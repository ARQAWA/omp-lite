# codex-transport

Сырая копия тюнинга сетевого транспорта Codex. Один хук, без правок.

**Источник:** `~/.omp/agent/extensions/codex-parallel.js`.

**Наблюдаемое поведение:** для `openai-codex-responses` включает параллельные вызовы инструментов, `reasoning.context: all_turns`, `text.verbosity: low`. Для моделей с `luna` в имени включает `service_tier: priority`.

**Вход OMP:** файл в `~/.omp/agent/extensions/`.

**Ресурсы и зависимости:** нет.

**Подключение и отключение:** файл в каталоге расширений или удаление файла.

**Тесты:** нет. Копия без правок.
