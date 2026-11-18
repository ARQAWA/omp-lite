# Установка, доставка, VSIX, всё вокруг

Когда читать: этап 5 (установка на Mac) и этап 6 (merge, VSIX, всё вокруг).

Установку и выпуск делает сабагент. Задание ему пиши по [task.md](task.md).

## 1. Mac (этап 5)

1. коммит в worktree: `git status --short` показывает только изменённые файлы; сообщение `omp-<new>: харнес на OMP <new> (D-<номер>)`.
2. `omp --version`, `omp update`, `omp --version`: ровно `omp/<new>`. Иначе стоп. `omp` на Mac это один бинарь, `omp update` заменяет его сам.
3. `INSTALL.md` из worktree, шаги 1-5, корень репозитория это worktree. В шаге 4 сохрани `config.bak` и верни прежний `modelRoles.default`; старый `config.yml` разбирай `Bun.YAML.parse`.
4. `bun $S/verify.js --runtime`: файлы рантайма равны worktree, удалённых путей нет, настройки равны фрагментам, версия стоит.
5. `bun $S/probe.js`. Пробу одной модели повторяет `bun $S/probe.js <slug>`, интерфейс `bun $S/probe.js tui`.

Откат: старый бинарь лежит в `/tmp/omp-up/omp-<old>`, копия конфига в `config.bak`, `main` не тронут.

## 2. merge и рантайм из `main` (этап 6)

1. основной каталог: `git status --short` пуст; `git merge --ff-only omp-<new>`; `git push origin main`; `git rev-parse main origin/main` равны. История линейная: без force и без `reset --hard`.
2. рантайм из `main`: `bun dev/agents/omp-upgrade/scripts/verify.js --runtime` из основного каталога.
3. уборка: `git worktree remove <worktree>` без `--force`, `git branch -d omp-<new>`, `git worktree prune`, `git -C ~/ai-project/omp-src worktree remove /tmp/omp-up/src-<new>`, `rm -rf /tmp/omp-up`. Живых агентов нет: `read` с путём `proc://`.

## 3. VSIX (сразу после merge, без вопроса)

Процедуру ведёт навык `release-ompcli-vsix`: сюда её не копируй. Отдай сабагенту с Contract: менять только `dev/DECISIONS.md` в конце; токен Marketplace не печатать, пустой токен это стоп; соседний репозиторий `~/ai-project/my-pi` не трогать.

Проверка главным после выпуска (версию подставь):

```bash
curl -fsS -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.1-preview.1' -d '{"filters":[{"criteria":[{"filterType":7,"value":"arqawa.ompcli"}]}],"flags":1975}' | jq -c '.results[0].extensions[0].versions[] | select(.version=="<версия расширения>") | {version,targetPlatform,flags}'
```

Ждём `"flags":"validated"`. Запрос делай `curl`: Python на этом Mac падает на сертификате. Запись выпуска: отдельная запись D по форме прошлой записи о выпуске, коммит прямо в `main`. Пока идёт выпуск, главный `main` не трогает.

Второй Mac (`git pull`, `omp update`, `INSTALL.md`) и проверка на VDI за владельцем.

## 4. всё вокруг (правило 38)

`bump.js` и ворота «версия одна во всех местах» закрывают версию в `src`, `INSTALL.md`, `AGENTS.md`, `README.md`, `dev/tests`, `dev/agents`. Остаётся то, что вне репозитория, и старая механика:

1. навыки и правила агента: `grep` по `<old>` и по именам удалённых в этом апдейте механик, пути `~/.omp/agent/managed-skills;~/.omp/agent/skills;~/.omp/agent/rules`.
2. документы `dev/`: `grep` по `<old>` в `dev/*.md`, кроме `dev/DECISIONS.md` и `dev/history/`. Прошлые записи `DECISIONS.md`, `dev/history/` и факты `dev/VDI.md` это история: не правь.
3. навык в `managed-skills` правит главный через `manage_skill`.
4. этот скилл: харнес получил новую опору на OMP или потерял старую: поправь `contract.json`. Новая повторяемая ловушка: строка в раздел ошибок `SKILL.md`, без версий и дат.

Правки этого шага: ветка, merge fast-forward, push (`dev/PROCESS.md`, правило 21).
