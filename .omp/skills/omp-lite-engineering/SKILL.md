---
name: omp-lite-engineering
description: Use before writing, reviewing, or delivering omp-lite code. Covers module layout, resources, tests, and order of work.
---

# omp-lite engineering

Правила процесса — в `dev/PROCESS.md`. Здесь структура, порядок и раздел «Инварианты».

## Когда

Перед написанием, ревью или сдачей кода omp-lite.

## Структура

```text
src/modules/<name>/
  index.js
  <name>.json
  README.md
dev/tests/harness/<name>/
  <name>.test.js
```

- Тексты и данные — отдельными JSON или YAML.
- README: назначение, вход, хуки, установка, выключение, тест.
- Ресурс без кода: YAML/JSON плюс README.
- Тест зеркалит модуль.

## Порядок

1. Найди штатный способ в исходниках OMP (`AGENTS.md`).
2. Прочитай README и тест модуля.
3. Напиши минимальный код.
4. Проверь реальным входом и тестом.
5. Ветка, коммит, merge, push.

## Инварианты

- Минимум строк и символов.
- Без новых зависимостей без согласия.
- Удаляй мёртвое и дубли.
- Покажи вывод.
- Обнови README и DECISIONS.
