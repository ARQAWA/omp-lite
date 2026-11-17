# Коммит, Mac, доставка, VSIX и «всё вокруг»

Когда читать: фаза E (коммит, `omp update`, установка), фаза G (merge, push, рантайм, уборка, VSIX), фаза H (всё вокруг, правило 38).

Всё ниже прошло в 18.20.2 (D-122, D-123, D-124). Версии: `<old>`, `<new>`. Сабагентов запускай с контрактом: git только в worktree, основной каталог не трогать, живые вызовы моделей только `--model opencode-go/deepseek-v4.1-flash --thinking low`, остановка и отчёт на первом неожиданном результате, без самодеятельности.

## 1. коммит и Mac (фаза E)

Это делает один сабагент `MacInstall` (`openai-codex/gpt-6.1-terra:xhigh`, `solutionSpace: "fixed procedure: commit, omp update, INSTALL.md"`). Контекст и задание дословно, кроме шага 2 (убрано самоисправление в скобке). Версию и имя ветки замени:

````
# Goal
Harness omp-lite moves from OMP 18.18.8 to OMP 18.20.2. The branch `omp-18-20-2` in worktree `/Users/arkadijcukavin/ai-project/omp-lite-worktrees/omp-18-20-2` holds the finished, tested change. Your job: commit it, update OMP on this Mac, install the harness from the worktree.

# Contract
- Work only in the worktree for git. Never touch the main checkout `/Users/arkadijcukavin/ai-project/omp-lite` (no edits, no git commands that change it). No push, no merge.
- Any live model call: ONLY `--model opencode-go/deepseek-v4.1-flash --thinking low`. No other model.
- Our eval guard blocks eval code containing the literal `agent(` or `workpool(`.
- Stop and report at the first unexpected result. Do not improvise fixes.
````

````
# Target
Git commit in the worktree; OMP binary on this Mac; `~/.omp/agent` per `INSTALL.md` of the worktree.

# Change
1. In the worktree: `git status --short` must list only modified files (no untracked). Commit all with message `omp-18-20-2: харнес на OMP 18.20.2 (D-122)`. Report the commit hash and `git show --stat HEAD`.
2. `omp --version` (expect `omp/18.18.8` before update). Run `omp update` (non-interactive; if it asks, answer to proceed). Then `omp --version`. It MUST print `omp/18.20.2`. Any other version: STOP and report, do not install.
3. Follow `INSTALL.md` of the worktree exactly, from the worktree root as "корень репозитория": sections 1-5. In section 4 keep `config.bak` and restore the previous `modelRoles.default`; parse the old `~/.omp/agent/config.yml` with `Bun.YAML.parse` (PyYAML failed on it in 18.22.1). In section 5 step 4 run instead `omp -p --no-session --model opencode-go/deepseek-v4.1-flash --thinking low "ответь одним словом: ок"` (owner rule: cheap models only).

# Acceptance
Report with evidence: commit hash; version before/after `omp update` and its output tail; count of `files` entries copied and that every `cmp` is silent (except `stt.windows.json`, which INSTALL says not to compare); that no `remove` path exists; that `~/.omp/agent/config.yml` equals the merged fragments except `modelRoles.default` (state its value); `disabledProviders` contains `antigravity-cli`, `chutes`, `liquid`, `nace`; the `omp -p` answer and any stderr.
````

Шаги `INSTALL.md` (читай сам файл, он в ветке): 1. `omp --version` не `omp/<new>` значит стоп; 2. копирование всех записей `files` манифеста; 3. удаление путей `remove`; 4. запись настроек (копия `config.bak`, прежний `modelRoles.default`, слияние четырёх фрагментов `config`: словари по ключам, списки целиком, прежний `modelRoles.default` вернуть; если нет `config.yml`, а есть `config.yaml`, пиши в него); 5. проверка (`cmp` по каждому файлу, `stt.windows.json` не сверять; путей `remove` нет; конфиг равен слитым фрагментам с точностью до `modelRoles.default`; новая сессия `omp -p`).

Результат 18.20.2: коммит `f32821d` (21 файл, +73 −61); `omp update` 18.18.8 → 18.20.2; INSTALL: 29 файлов, `cmp` молчит, `remove` нет, конфиг равен фрагментам с `modelRoles.default` `opencode-go/deepseek-v4.1-flash:max`, четыре провайдера закрыты; `omp -p` на deepseek low ответил «ок».

## 2. merge, push, рантайм из `main`, уборка (фаза G)

Делает сабагент `MergeShip` (`openai-codex/gpt-6.1-terra:xhigh`, `solutionSpace: "fixed procedure"`) после приёмки ревью. Контекст и задание:

````
# Goal
The omp-lite harness update to OMP 18.20.2 passed code review and acceptance review. Deliver it: merge, push, runtime from main, cleanup.

# Contract
- Main checkout: `/Users/arkadijcukavin/ai-project/omp-lite` (branch `main`, at 34bdaa5, clean). Worktree: `/Users/arkadijcukavin/ai-project/omp-lite-worktrees/omp-18-20-2`, branch `omp-18-20-2` at f32821d (local only, not pushed).
- History is linear: fast-forward only. Never force, never rewrite history, never `git reset --hard`.
- Any live model call: ONLY `--model opencode-go/deepseek-v4.1-flash --thinking low`.
- Our eval guard blocks eval code containing the literal `agent(` or `workpool(`.
- Stop at the first unexpected result and report it; do not improvise.
````

````
# Change
1. Main checkout: `git status --short` must be empty (ignored files do not count). `git merge --ff-only omp-18-20-2`. Show `git log --oneline -3`.
2. `git push origin main`. Show the push output and `git rev-parse main origin/main` (must be equal, f32821d...).
3. Runtime from main: for every `files` entry of `install.manifest.json` in the main checkout, `cmp <main>/<from> ~/.omp/agent/<to>` (skip `stt.windows.json` as INSTALL.md says). Any difference: copy that file from main per INSTALL.md and say which. Merge the four `config` fragments of the main manifest and compare with `~/.omp/agent/config.yml` ignoring `modelRoles.default`; must be equal. Then `omp --version` (must be `omp/18.20.2`) and `omp -p --no-session --model opencode-go/deepseek-v4.1-flash --thinking low "ответь одним словом: ок"`.
4. Cleanup: `git -C <main> worktree remove /Users/arkadijcukavin/ai-project/omp-lite-worktrees/omp-18-20-2` (must succeed without `--force`; it is clean), then `git -C <main> branch -d omp-18-20-2` (must succeed: merged). `git -C <main> worktree prune`. Do NOT delete `/tmp/omp-up`.

# Acceptance
Report with exact outputs: merge result, push result, equal hashes, cmp results (count of files, all silent), config equality, version, the `omp -p` answer and stderr, worktree list and branch list after cleanup, final `git status --short` of main.
````

Результат 18.20.2: `Fast-forward`, `34bdaa5..f32821d  main -> main`, хеши `main` и `origin/main` равны, `cmp` по 28 файлам молчит (29 записей `files` минус `stt.windows.json`), конфиг равен фрагментам, `omp/18.20.2`.

Проверка главным после сабагента: `git fetch -q origin && git rev-parse main origin/main && git worktree list && git branch -a && git status --short && omp --version` (хеши равны, worktree один, ветки `omp-18-20-2` нет).

Уборку делает сабагент на `openai-codex/gpt-6.1-terra:xhigh`: `rm -rf /tmp/omp-up` (после доставки; `/tmp/omp-up-changelog.md` удалён после blind review плана) и проверка процессов: `ps -axo pid,command`, отбор строк `omp-up|probe-` (в примере: `no probe processes`). Главный проверяет `read` с путём `proc://` (живых агентов нет). Папку ревью blind удаляй по приёмке (`reviews.md`).

## 3. VSIX (фаза G, сразу после доставки)

`Update` во вкладке VDI на новом `runtime.json` отказывает (`OMP CLI bootstrap changed. Update OMP CLI in Marketplace.`): VDI получает новый OMP только новым VSIX. Выпускай сразу после доставки, без вопроса владельцу (слова владельца от 2026-11-18).

Процедуру ведёт навык `release-ompcli-vsix` (`~/.omp/agent/managed-skills/release-ompcli-vsix/SKILL.md`): версия расширения, сборка `bun dev/scripts/rqw-windows-pack/build/index.js`, упаковка `vsce`, проверки VSIX, публикация, проверка в Marketplace, запись выпуска. В этот скилл её не копируй. Отдавай её сабагенту (`VsixRelease`, `openai-codex/gpt-6.1-terra:xhigh`, `solutionSpace: "fixed release procedure"`) с таким контекстом (версию и хеш замени):

````
# Goal
Publish VS Code extension `arqawa.ompcli` (RQW Windows Pack) version 0.0.15 to the Marketplace. The owner gave the word: «да давай». The code is already on `main` (f32821d, pushed): OMP 18.20.2 pinned in `runtime.json`, `package.json` version 0.0.15.

# Contract
- Repo: `/Users/arkadijcukavin/ai-project/omp-lite` (main checkout). Do not change any file except `dev/DECISIONS.md` at the end. Never force-push, never rewrite history.
- Never print the Marketplace token, not even partly. Empty token or `no token`: STOP and report (Azure login gone).
- Do not change the neighbour repo `~/ai-project/my-pi`.
- No model calls are needed. Our eval guard blocks eval code containing the literal `agent(` or `workpool(`.
- Stop at the first unexpected result and report it. Do not improvise fixes.
````

В 18.20.2 навык устарел в путях, и задание поправляло их. Теперь навык актуален (D-124); после выпуска обнови его снова по правилу 38.

Результат 18.20.2: ревизия payload `f32821d16235bb989abb0f2f069945f3f831f74c`, VSIX 209571621 байт, sha256 `528a82b88f830b86e361cc6cc7434149cd1948e5ed3bed3bfeef9f1db9ba538f`, `bun test dev/tests` 96 pass, 0 fail. Выпуск шёл 15 минут. Главный проверил сам после сабагента:

```bash
git fetch -q origin && git rev-parse main origin/main && git status --porcelain && git log --oneline -2 && curl -fsS -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.1-preview.1' -d '{"filters":[{"criteria":[{"filterType":7,"value":"arqawa.ompcli"}]}],"flags":1975}' | jq -c '.results[0].extensions[0].versions[] | select(.version=="0.0.15") | {version,targetPlatform,flags,lastUpdated}'
```

Ответ: `{"version":"0.0.15","targetPlatform":"win32-x64","flags":"validated","lastUpdated":"2026-11-15T19:44:36.527Z"}`.

Запись выпуска: отдельная запись `## D-123 — выпуск RQW Windows Pack 0.0.15` по форме `## D-118`, коммит прямо в `main`: `docs: D-123 release of RQW Windows Pack 0.0.15`, push. Главный `main` в это время не трогает: выпуск пишет в него свою запись D.

Второй Mac и проверка на VDI за владельцем: на втором Mac `git pull`, `omp update`, `INSTALL.md`.

18.21.0: слово на VSIX было в самом заказе («с учётом, э-э, Windows и маркетплейса», 2d6cc8a7), отдельный вопрос не задавался. Запрос Marketplace делай `curl`, как в навыке: Python на этом Mac падает с `CERTIFICATE_VERIFY_FAILED`. Итог выпуска 0.0.16: в записи D-130.

18.22.0: слово владельца на выпуск было в заказе («с учётом, э-э, Windows и маркетплейса», 2d6cc8a7), отдельный вопрос не задавался. `ompcli-0.0.17-win32-x64.vsix`: 211127594 байта, sha256 `fd18219bacfe5ce73e26ef4f2efdf763d4656e109b7d68401523f54a6b08bb73`; Marketplace `validated`, `2026-11-17T05:41:10.333Z` (D-133).

18.22.1: установка на Mac — 29 файлов, `cmp` по 28 молчит; fast-forward `b2da724..12fa07d`. VSIX выпущен по новому правилу: `ompcli-0.0.18-win32-x64.vsix`, 211236412 байт, sha256 `c880ec7af92755f84816d1e55214bb8806b8a9ef7bdeb82bb7909fb9a44d1396`; Marketplace `validated`, `2026-11-17T23:08:50.32Z`; 13 минут (D-138).

## 4. всё вокруг (фаза H, правило 38)

Правило 38 в `dev/PROCESS.md`: «обновление OMP идёт вместе с обновлением сборки: пин `omp.exe` в `runtime.json`, версия расширения, VSIX. обновление OMP или сборки обновляет и всё вокруг: README, комментарии с версией, тесты, `INSTALL.md`, `DECISIONS.md`, навыки в репозитории и в `~/.omp/agent/managed-skills`. старую версию, старые пути и старую механику найди поиском по ним.» Запись: D-124.

Поиск в 18.20.2 вели тулами `files` и `grep` (по репозиторию и по `~/.omp/agent`). Шаблоны подставь свои: старая версия, старые пути, старые механики.

- репозиторий (`hidden: true`): `18\.18\.8|ompcli-build|ompcli-runtime|src/modules/ompcli|modules/ompcli|release-ompcli|omp update|omp --version`
- старая механика: `0\.0\.14|Persistent shell|WINDOWS_LINE|kPerCallContextMessage|markPerCallContextMessage|per-call|Windows host, emulated|xd://eval/agents|most specific|antigravity|\b90 провайдер|ompcli/`
- навыки и правила в агенте (`path` `/Users/arkadijcukavin/.omp/agent`, `glob` `{skills,managed-skills,rules,agents,commands,prompts}/**`, `case: false`, `hidden: true`): `18\.18\.8|ompcli|omp update|omp --version|rqw-windows-pack|vsix`
- корень агента и `.omp` репозитория (тулом `grep`, `gitignore: false`, пути `~/.omp/agent/*.md;~/.omp/agent/*.yml;~/.omp/agent/rules;<репозиторий>/.omp`): `18\.18\.8|ompcli|omp-src|omp update`
- версии в комментариях тестов и кода: `OMP 1\d\.|capability/rule\.ts` в `dev/tests` и `src`
- версии в документах (`dev/VDI.md`, `dev/README.md`, `dev/agents/README.md`, `dev/tests/README.md`, `README.md`, `dev/BACKLOG.md`, `dev/ENGINEERING.md`): `18\.\d+\.\d+|0\.0\.\d+|ompcli|omp\.exe|bun dev/scripts`

Найдено в 18.20.2 ровно три места: навык `release-ompcli-vsix` (старые пути `ompcli`, сборщик, две программы вместо трёх, запись выпуска), комментарий теста `rqw-system-core` («OMP 18.18.8 capability/rule.ts»), в `dev/PROCESS.md` не было правила про обновление. Всё остальное в совпадениях была история: прошлые записи `dev/DECISIONS.md` (90 совпадений), `dev/history/`, `dev/VDI.md`, `.omp/inventory`. Историю не правь.

Итоговая проверка, настоящий `rg` из корня репозитория (или worktree), путь `.`:

```bash
/opt/homebrew/bin/rg -n '18\.18\.8|ompcli-build|ompcli-runtime|src/modules/ompcli|modules/ompcli' . ~/.omp/agent/managed-skills ~/.omp/agent/skills --glob '!dev/DECISIONS.md' --glob '!dev/history/**'; echo "exit=$?"
```

Ждём `exit=1` и пусто. В запись D кладётся именно эта команда «из корня репозитория». Встроенный `rg` в `eval` `sh` и абсолютный путь дают ложные совпадения (глоб не работает).

Порядок 18.20.2: выпуск VSIX дописал D-123 в `main`, после этого создана ветка `omp-up-materials` (`git -C /Users/arkadijcukavin/ai-project/omp-lite worktree add -b omp-up-materials ../omp-lite-worktrees/omp-up-materials main`), в ней правило 38, комментарий теста, D-124. Навык `release-ompcli-vsix` обновил главный через `manage_skill` (у сабагента этого тула нет) по черновику сабагента `local://release-ompcli-vsix.SKILL.new.md`, сверив факты с выпуском. Затем blind review (`reviews.md`), и доставка тем же способом: `bun test dev/tests` в worktree (96 pass, 0 fail), `git merge --ff-only omp-up-materials`, `git push origin main`, `git worktree remove` без `--force`, `git branch -d omp-up-materials`, `git worktree prune`. Для правил, инструкций и `dev/agents` порядок по `dev/PROCESS.md` (правило 21): ветка, потом прямо в `main`; записи выпуска (`DECISIONS`) идут прямо в `main`.
