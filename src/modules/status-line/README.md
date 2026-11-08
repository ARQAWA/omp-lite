# status-line

Настойка родного статуслайна OMP. Кода нет.

Раскладка: слева модель, режим, путь, ветка git и агенты. Справа метки подписок, скорость, кэш и контекст.
Вторая строка статусов снизу выключена: `showHookStatus: false`, иначе метки дублируются.

Лимиты подписок даёт модуль [subscriptions](../subscriptions/README.md), фоновые процессы — [background-jobs](../background-jobs/README.md). Оба печатают в родной сегмент `status`.

**Вход:** блок `statusLine` в `~/.omp/agent/config.yml`.

**Установка:** слить [status-line.yml](status-line.yml) в `config.yml` и перезапустить OMP.

**Выключить:** удалить блок из `config.yml`.

**Тесты:** кода нет. Проверка — `omp gallery --surface=segment` и живой запуск.
