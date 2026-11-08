# status-line

Настойка родного статуслайна OMP. Кода нет.

Раскладка: слева путь, ветка git и модель. Справа метки расширений, агенты, токены, скорость, кэш и контекст.

Лимиты подписок даёт модуль [subscriptions](../subscriptions/README.md), фоновые процессы — [background-jobs](../background-jobs/README.md). Оба печатают в родной сегмент `status`.

**Вход:** блок `statusLine` в `~/.omp/agent/config.yml`.

**Установка:** слить [status-line.yml](status-line.yml) в `config.yml` и перезапустить OMP.

**Выключить:** удалить блок из `config.yml`.

**Тесты:** кода нет. Проверка — `omp gallery --surface=segment` и живой запуск.
