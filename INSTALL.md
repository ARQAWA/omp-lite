# Установка харнеса в OMP

Ставит харнес в уже установленный OMP. Цель: `~/.omp/agent`.
Состав задаёт [install.manifest.json](install.manifest.json). Чего в нём нет, не копируй.
Блок `vscode` манифеста сюда не относится: его берёт сборка расширения для Windows VDI.

## 1. Проверь машину

```bash
omp --version
```

Ответ не `omp/19.1.0`: стоп, ничего не ставь.

## 2. Скопируй файлы

Для каждой записи `files` манифеста, из корня репозитория:

```bash
mkdir -p "$(dirname "$HOME/.omp/agent/<to>")"
cp "<from>" "$HOME/.omp/agent/<to>"
```

## 3. Удали старое

Для каждого пути `remove` манифеста:

```bash
rm -f "$HOME/.omp/agent/<путь>"
```

Потом остатки прежних версий:

```bash
rm -rf "$HOME/.omp/agent/extensions/cursor-tools" "$HOME/.omp/agent/extensions/codex-web-run" "$HOME/.omp/agent/extensions/pi-voice-stt/src"
rm -f "$HOME/.omp/agent/extensions/background-jobs.js"
```

## 4. Запиши настройки

Конфиг: `~/.omp/agent/config.yml`. Его нет, а есть `config.yaml`: пиши в `config.yaml`.

1. Сохрани копию конфига рядом: `config.bak`.
2. Начни с пустого конфига. Слей в него фрагменты `config` манифеста.
3. Словари сливаются по ключам, список берётся целиком. Порядок не важен: ключи фрагментов не пересекаются.
4. Роль `modelRoles.default` не задаётся, старую не переноси. Без сохранённого выбора и `--model` OMP берёт первую доступную модель из `enabledModels`, сейчас это Sonnet 5.5. Другую можно выбрать через `/model` или `--model`.

Прежние ключи вне фрагментов пропадают. Секретов во фрагментах нет: вход в провайдеров владелец делает сам.

### Z.ai

1. Для GLM-5.3 и Flash войди в OMP через `/login zai` или задай `ZAI_API_KEY` с ключом Coding Plan.
2. Для FlashX получи отдельный [Standard API Key](https://docs.z.ai/devpack/notice/api-key-management) и задай `ZAI_STANDARD_API_KEY` в окружении OMP. Нужен баланс обычного API, подписки не хватит.
3. Только после настройки стандартного ключа влей `providers.zai-api` из установленного `zai-models.yml` в `~/.omp/agent/models.yml`. Если есть только `models.yaml`, используй его. Сохрани копию существующего файла и не меняй другие секции.

После Windows `Update` шаги Z.ai те же.

## 5. Проверь установку

1. Каждый файл из `files` совпадает с репозиторием: `cmp "<from>" "$HOME/.omp/agent/<to>"` молчит. Файл `stt.windows.json` не сверяй.
2. Путей из `remove` в `~/.omp/agent` нет.
3. Конфиг равен слитым фрагментам.
4. Новая сессия OMP стартует без ошибок расширений:

```bash
omp -p --no-session "ответь одним словом: ок"
```

Харнес виден только в новой сессии.

После настройки ключей проверь GLM-5.3 и Flash через `omp models zai`, FlashX — через `omp models zai-api`. В пикере харнеса из семейства Z.ai разрешены только эти три модели.

## Откат

Верни `config.bak` на место конфига. Файлы прежней версии ставятся этим же документом из её коммита.
Если добавлял `providers.zai-api`, убери эту секцию или восстанови её прежнее содержимое из копии `models.yml`.
