# model-picker

Расширение OMP. Компактный пикер модели и усилия в стиле MyP. Занимает место редактора, без оверлея.

**Вход OMP:** события `session_start`, `session_switch`, `session_branch`, `session_shutdown`, `ctx.ui.custom`, `ctx.ui.onTerminalInput`; роли темы `thinking*`, `accent`, `text`, `muted`, `dim`, `error`.

**Активация:** Shift+любая стрелка открывает меню. Модель не меняется до подтверждения.

**Подписка:** создаётся на `session_start`, `session_switch` и `session_branch`. `/new` снимает слушатели, поэтому без `session_switch` Shift+стрелки перестают открывать пикер.

**Клавиши:**
- ↑ и ↓ меняют модель;
- ← и → меняют усилие;
- буквы фильтруют список;
- Backspace убирает последний символ фильтра;
- Enter и Shift+Enter применяют выбор;
- Esc и Ctrl+C закрывают без изменений.

Края не заворачиваются. Активное усилие жирное, остальные приглушены. Выбранная модель всегда стоит в средней из пяти строк, как в MyP: у краёв списка соседние строки пустые. Подсказка приглушена, клавиши в ней жирные.

**Узкое окно:** имя выбранной модели сокращается с `…` и уступает место усилиям, но не короче `minName` колонок. Меньшая ширина показывает `Effort needs N columns`. Имена остальных моделей тоже сокращаются с `…`. Так же ведёт себя пикер MyP.

**Источник:** только `ctx.models.list()`. OMP уже учитывает `enabledModels` и `disabledProviders`, порядок OMP сохраняется. Усилия: `auto`, `off` и `model.thinking.efforts`. Модель без reasoning показывает только `auto` и `off`.

**Начальное усилие:** последняя запись `thinking_level_change` ветки, её `configured` (например `auto`), затем `thinkingLevel`, затем `pi.getThinkingLevel()`. Поэтому после выбора `auto` меню снова показывает `auto`, а не разрешённый уровень.

**Цвета усилий:** `auto` — серебряный 256-цвет 250, `off` — светло-серый 252, остальные — роли темы `thinkingMinimal` … `thinkingMax`. Если тема не задаёт необязательный `thinkingMax`, берётся `thinkingXhigh`.

**Установка:** скопировать два файла в `~/.omp/agent/extensions/`:

```bash
cp src/modules/model-picker/index.js ~/.omp/agent/extensions/model-picker.js
cp src/modules/model-picker/model-picker.json ~/.omp/agent/extensions/model-picker.json
```

**Выключить:** удалить `~/.omp/agent/extensions/model-picker.js`.

**Ограничения:**
- только интерактивный TUI; сабагенты, RPC и print не подписываются;
- Shift+Up больше не разворачивает очередь сообщений, потому что слушатель забирает все четыре Shift-стрелки раньше редактора. Alt+Up продолжает разворачивать;
- коммит не атомарный: OMP сначала меняет модель, потом усилие. Если смена модели отклонена, усилие не меняется;
- Shift+Enter распознаётся в формах `CSI 13;2u`, `CSI 13;2~` и `CSI 27;2;13~`. Другой формат терминала просто не подтвердит выбор.

**Тесты:** `bun test dev/tests/harness/model-picker`.
