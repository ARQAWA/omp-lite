# status-line

Настойка родного статуслайна OMP. Кода нет.

Раскладка: слева модель, режим, путь, ветка git и агенты. Справа метки подписок, кэш и контекст.
Вторая строка статусов снизу выключена: `showHookStatus: false`, иначе метки дублируются.

Лимиты подписок даёт модуль [subscriptions](../subscriptions/README.md), фоновые процессы — [background-jobs](../background-jobs/README.md). Оба печатают в родной сегмент `status`.

`composer.tokenRate: false` убирает второй счётчик tok/s: он живёт в композере, а не в статуслайне.

**Вход:** блоки `statusLine` и `composer` в `~/.omp/agent/config.yml`.

**Установка:** слить [status-line.yml](status-line.yml) в `config.yml` и перезапустить OMP.

**Выключить:** удалить блок `statusLine` и строку `composer.tokenRate: false`. Остальные ключи `composer` не трогать.

**Тесты:** кода нет. Проверка — `omp gallery --surface=segment` и живой запуск.
