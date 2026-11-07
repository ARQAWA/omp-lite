---
name: omp-lite-engineering
description: Use before writing, reviewing, or delivering omp-lite code. Covers minimal code, module layout, separate resources, tests, and delivery.
---

# omp-lite engineering

Жёсткие инварианты уже в `.omp/RULES.md`. Здесь — рабочая процедура.

## Перед кодом

1. Прочитай `AGENTS.md`, `dev/PROCESS.md`, `dev/DECISIONS.md`.
2. Найди штатный способ в документации OMP.
3. Проверь README модуля и его тест.
4. Оцени задачу в SP. Больше двух SP — план владельцу.

## Структура модуля

```text
src/modules/<name>/
  index.js
  <name>.descriptions.json   # если есть тексты
  README.md
dev/tests/harness/<name>/
  <name>.test.js
```

- Код, данные и тексты лежат раздельно.
- README: назначение, вход, хуки, установка, выключение, тест.
- Ресурс без кода тоже допустим: YAML или JSON плюс README.
- Не добавляй `index.js` только ради шаблона.

## Минимальный код

- Сначала кратчайшее рабочее решение.
- Минимум строк и символов.
- Без one-line обёрток и хитрых цепочек.
- Без дублей: вынеси общее или удали.
- Новую зависимость согласуй с владельцем.
- Удаляй мёртвый код сразу.

## Проверка

1. Запусти изменённое поведение настоящим входом.
2. Запусти тест модуля.
3. Перед `main` запусти все тесты.
4. Покажи вывод, а не обещание.
5. Сверь дифф с заказом.

## Доставка

- Ветка на задачу, один коммит.
- Обнови README и `DECISIONS.md`.
- Merge в `main`, push, удали ветку.
- Не коммить чужие правки.
