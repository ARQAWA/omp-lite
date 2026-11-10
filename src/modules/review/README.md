# review

Приёмка любой работы: код, план, аналитика.
Проверяются только три вида расхождений:

- заказано, но не сделано;
- сделано, но не заказано;
- сделано не так, как заказано.

Качество кода, простота решения и правила процесса не проверяются.

## Вход

`/blindreview` или `/highreview` через `skill-alias`.
Нативно: `/skill:blindreview`, `/skill:highreview`.
Оба скилла ведут в `skill://reviewer/SKILL.md`.

## Как работает

1. Основной агент запускает сборщика: `omp -p`.
2. Сборщик читает сессию с конца и находит начало задачи.
3. Он пишет `slice.md` и `facts.md` в `local://review-<n>`.
4. Скрипт ставит SHA-256: фактура заморожена.
5. Агент запускает ревьюера: тоже `omp -p`.
6. Ревьюер отвечает `CLEAN` или `FINDINGS` одной пачкой.
7. Агент чинит или пишет возражение в `objections.md`.
8. Перед кругом скрипт сверяет хеш и цитаты.
9. Новый ревьюер с нуля, до `CLEAN`, без предела кругов.

Модель всегда `openai-codex/gpt-6.1-terra`.
Сборщик: `xhigh`. Ревьюер: blind `high`, high `xhigh`.
Запасных моделей нет.

## Изоляция

Сборщик и ревьюер это отдельные процессы `omp -p`.
У них обычный системный промпт и обычные тулы.
Память и автообучение выключены оверлеем `--config`.
Ревьюеру ещё запрещены `write` и `edit`: `tools.approval: deny`.
`bash` и остальные тулы у него остаются.
Перенаправление `>` в `bash` режет штатный перехватчик.
Он отправляет такую запись в `write`, а `write` запрещён.
Тул `task` не годится: модель не выбрать, память родителя.

Источники: `omp://cli-reference.md`, `omp://approval-mode.md`,
`omp://skills.md`, `omp://tools/bash.md`, `omp://settings.md`.

## Ресурсы

|файл|роль|
|---|---|
|`index.js`|скрипт: реплики из JSONL, срез, SHA-256, сверка цитат|
|`skills/reviewer/SKILL.md`|процедура основного агента|
|`skills/reviewer/collector.md`|промпт сборщика|
|`skills/reviewer/reviewer.md`|промпт ревьюера|
|`skills/reviewer/collector.yml`|оверлей сборщика: без памяти|
|`skills/reviewer/reviewer.yml`|оверлей ревьюера: без памяти, `write` и `edit`|
|`skills/blindreview/SKILL.md`|вход blind|
|`skills/highreview/SKILL.md`|вход high|

Скрипт ставится рядом со скиллом: `skills/reviewer/index.js`.
Агенты грузят его через `import` в eval.
Путь даёт `realpath skill://reviewer`.
`bun`, `node`, `python` в `PATH` не нужны.
Так одинаково на Mac и на Windows VDI в Git Bash.

## Установка и выключение

Состав задан `install.manifest.json`, процедура в `INSTALL.md`.
Выключение: удали файлы модуля из `~/.omp/agent/skills/`.
Зависимостей нет.

## Проверка

`bun test dev/tests/harness/review`.
Тест проверяет скрипт без моделей и OMP.

Живые пробы, с флагами как в скилле:

- сессия сборщика: `gpt-6.1-terra`, `xhigh`, без тулов памяти;
- ревьюер: blind даёт `high`, high даёт `xhigh`;
- `write` и `edit` отклонены, `bash` работает;
- первая строка ответа: `CLEAN` или `FINDINGS`.
