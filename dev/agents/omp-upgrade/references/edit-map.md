# Карта правок: механика харнеса и OMP

Когда читать: фаза B (что проверять у каждой механики), фаза D (что и где править, тесты, запись D).

Всё ниже взято из прогона `18.18.8` → `18.20.2` (D-122, D-124). Версии в тегах: `v<old>`, `v<new>`. Исходники OMP: `~/ai-project/omp-src`, пакет `packages/coding-agent/src`, если путь не начинается с `packages/`.

Прогон `18.20.2` → `18.21.0` (D-129): эталон сторожа, якоря `EDITS.task` и `EDITS.eval`, маркеры и код не менялись. Правки: `- modal` в `disabledProviders` (README 93 → 94), пин `runtime.json` (4 строки), `package.json` 0.0.15 → 0.0.16, версия в `INSTALL.md`, в README и комментариях семи файлов и в двух тестах; `bun test dev/tests` 98 pass. В OMP: убран агент `seance` (`prompts/tools/task.md`), `agent_pause` сессии приходит расширению как `agent_end` с `willContinue` (`extensibility/extensions/lifecycle-mirror.ts`; `turn-duration.js` такие события пропускает), текст отказа `hashline` другой (`crates/pi-edit/src/modes/hashline/mismatch.rs`; харнес на него не опирается).

## 1. сравнение исходников между тегами

Из `~/ai-project/omp-src`, тулом `bash`. Все четыре команды прошли.

```bash
git diff --stat v<old> v<new> -- packages/ai/src/utils/block-symbols.ts packages/coding-agent/src/config/registry.ts packages/coding-agent/src/tools/approval-cache.ts packages/coding-agent/src/tools/approval-targets.ts packages/coding-agent/src/slash-commands/helpers/active-oauth-account.ts packages/coding-agent/src/system-prompt.ts packages/coding-agent/src/task/executor.ts packages/coding-agent/src/extensibility packages/tui/src/index.ts packages/coding-agent/src/prompts/tools packages/natives/native/index.d.ts packages/coding-agent/src/config/settings-schema.ts | tail -60; git diff v<old> v<new> --stat | tail -1
git diff v<old> v<new> -- packages/ai/src/utils/block-symbols.ts packages/coding-agent/src/tools/approval-cache.ts packages/coding-agent/src/extensibility/extensions/runner.ts
git diff v<old> v<new> -- packages/coding-agent/src/prompts/tools/read.md packages/coding-agent/src/prompts/tools/bash.md packages/coding-agent/src/prompts/tools/glob.md packages/coding-agent/src/prompts/tools/write.md packages/coding-agent/src/prompts/tools/grep.md packages/coding-agent/src/prompts/tools/apply-patch.md packages/coding-agent/src/prompts/tools/edit.md
git diff v<old> v<new> -- packages/coding-agent/src/prompts/tools/task.md packages/coding-agent/src/prompts/tools/eval.md packages/coding-agent/src/prompts/tools/task-spawn-feedback.md
```

Шаблон, как OMP его отдаёт сейчас: `read` с путём `/Users/arkadijcukavin/ai-project/omp-src/packages/coding-agent/src/prompts/tools/task.md:raw` (и `eval.md:raw`). Старый шаблон: `git show v<old>:packages/coding-agent/src/prompts/tools/task.md | head -40`. Шаблон лишь подсказка: якоря сверяй с отрендеренным текстом из снимка (`d-task-new.txt`, `cap-new-full.json`).

Поиск по исходникам тулом `grep` (путь в `path` через `;`): `withoutAgentsMd|excludeAgentsMd|PI_ANTHROPIC_MESSAGE_THREADS` в `system-prompt.ts`, `task`, `ai/src/providers/anthropic.ts`; `new Worker\(`; `scoutAvailable` в `task`; `export function withOAuthAccess|export function lookup|approvalTreeSearchKey|approvalDirectoryKey|reportMatchesActiveAccount`; `extractSegments|matchesKey|truncateToWidth|visibleWidth` в `packages/tui/src/index.ts`.

## 2. механики по модулям

Для каждой: от чего зависит, что проверить, что вышло в 18.20.2.

### rqw-codex-adapter: описание `task`

- файл `src/modules/rqw-codex-adapter/index.js`, `EDITS.task`: `cut` (фрагменты вон), `add` (строка «Do not spawn sub-agents unless…» под первую строку), `swap` (две строки: родная и наша «Omit `agent` by default: …»).
- зависит от текста `prompts/tools/task.md` после рендера.
- проверка: в снимке `full` наша строка «Omit `agent` by default: a general worker equal to you.» ровно один раз, строка «Do not spawn sub-agents unless» ровно один раз, родных «Read-only research MUST» и «most specific» нет.
- 18.20.2: якоря `"Use most specific agent."` и `"Read-only research MUST use `scout` only when files unknown. "` (с пробелом) пропали. Правка: `cut[0]` → `"most specific, "`; `swap[0]` → `"Read-only research MUST use `scout` only when files unknown."`; `swap[1]` без изменений. Итог в запросе:

```
- `agent`: inside each `tasks[]` item, NEVER at the top level.
  - Omit only for the default (`task`); NEVER name it.
  - Omit `agent` by default: a general worker equal to you. `scout` only for read-only search over unknown files; ...
  - Prefer one agent to investigate + edit.
```

- граница (D-122): наша строка появляется только там, где OMP показывает строку про `scout` (`scoutAvailable`, `task/index.ts`), как и прежний вырез.

### rqw-codex-adapter: описание `eval`

- `EDITS.eval.cut`: четыре фрагмента: `" Subagents have separate kernels."`, строка «If blocked…», строка «For 2+ independent items, use a named `workpool()`…» и строка пространства имён `agent`/`workpool`.
- проверка: в `eval` нет `xd://eval/agents` и текста `workpool()`; есть «Use JavaScript (Bun) by default» и «my setup.js»; есть `xd://eval/commit` (commit включён).
- 18.20.2: `cut[1]` → `"If blocked, leave `eval` and call `wait`.\n"` (отдельной строкой); `cut[3]` → `"- `agent`, `workpool`: background subagents, DAG waves \u2192 xd://eval/agents\n"` (без обратных кавычек у `xd://eval/agents`).

### rqw-codex-adapter: `AGENTS.md` у сабагентов, `Tip:`

- `agentsmd.js` патчит `Array.prototype.filter` под фильтр `withoutAgentsMd` (`system-prompt.ts`, фильтр по имени `agents.md`), `task/executor.ts` ставит `excludeAgentsMd: true`; воркер создаётся через `new Worker`, `preload` ставится в `globalThis.Worker`.
- проверка: чтением исходников, потом живой пробой 6 (`references/probes.md`): сабагент называет `Probe token` без чтения файлов.
- 18.20.2: фильтр тот же, `thread/subagent-worker.ts` не менялся.
- совет `Tip: this call spawned ...` в `index.js` (`TIP`): шаблон `task-specialization-advisory.md` тот же (`buildSpecializationAdvisory`, `task/index.ts`).

### rqw-base-tools: сторож описаний

- файлы `src/modules/rqw-base-tools/`: `index.js` (сторож), `rqw-base-tools.reference.json` (эталон: `engine`, `settings`, `tools.<имя>.description` и `fields`), `rqw-base-tools.texts.json` (наши тексты; хвост родного текста стоит после маркера `{ "native": "<маркер>" }`).
- проверка: шесть родных описаний из снимка `native` против эталона; маркеры против новых родных текстов.
- 18.20.2: изменились `read`, `bash`, `glob`, `write`; `grep` и `edit` нет. Эталон взят из снимка `cap-new-native.json` (скрипт ниже, пункт 3). Маркер хвоста `bash` в `texts.json`: `Persistent shell:` → `Persistent bash` (родной `bash.md` теперь начинается «Persistent bash 5.3.»). Одна строка.
- строка bash `In-process builtins, ahead of PATH: ...` зависит от платформы. В `index.js` одна регулярка `BUILTINS = /^In-process builtins, ahead of PATH: .*$/m`, `native = text => String(text).replace(BUILTINS, "")`. Она заменила `WINDOWS_LINE` и вариант с `eval` (4 строки → 3); в `bash.md` 18.20.2 строк Windows и варианта с `eval` нет.
- импорт движка `@oh-my-pi/pi-natives` (`glob`, `grep`, `FileType`, `EditSession`, `EditStore`) и внутренние модули `config/registry`, `tools/approval-cache`, `tools/approval-targets`: проверка `imp.js` (`references/wire-snapshot.md`, пункт 4).
- метки обрезки в наших текстах `read`, `bash`, `grep`, `glob`: пункт 6 в `wire-snapshot.md`. В 18.20.2 `output-meta.ts` не менялся.
- `settings` эталона (`read.defaultLimit`, `tools.outputMaxColumns`, `edit.mode`, `grep.contextBefore` и другие, `inlineToolDescriptors: "off"`): проверка `omp config get` в пункте 3 `wire-snapshot.md`.

### rqw-system-core: памятка, per-call, threads

- `index.js`: `REMINDER` (два блока), хук `context` (`emitContext` в `extensibility/extensions/runner.ts`), `process.env.PI_ANTHROPIC_MESSAGE_THREADS = "0"` (`ai/src/providers/anthropic-threads.ts`).
- 18.20.2: обход пометки per-call мёртв. `runner.ts` (`#isRepeatedProjection`) сам не метит сообщение, которое хук меняет одинаково каждый раз. Снимок: запрос с обходом и без равен (на старой версии различался). Удалено: импорт `kPerCallContextMessage` и комментарий; `patch` стал `({ ...message, content: withReminder(message.content) })`. Минус 2 строки. В README убран пункт про пометку, костыль остался один (threads).
- проверка: `messages` в снимке `full` равны старому, у сабагента памятки нет (так задумано).

### rqw-runtime-config: провайдеры и модели

- `config.yml`: `disabledProviders` (закрыты все, кроме `anthropic`, `openai-codex`, `opencode-go`, `openrouter`), `enabledModels`, `modelRoles.perCall`, `compaction.modelThresholds`.
- 18.20.2: четыре новых провайдера закрыты: `antigravity-cli`, `chutes`, `liquid`, `nace` (плюс 4 строки; комментарий версии). В README число закрытых 90 → 94.
- `commit.enabled` не трогать: `commit` через `eval` включён по слову владельца.

### rqw-harness-interface

- статуслайн (`statusLine.leftSegments`, `statusLine.rightSegments`, `statusLine.preset`), `omp usage --json` (`subscriptions.js`: `execFile("omp", ["usage","--json"])`), `omp config get enabledModels --json` (`model-picker.js`), импорт `reportMatchesActiveAccount` из `slash-commands/helpers/active-oauth-account`.
- 18.20.2: форма та же. В `model-picker.js` менялся только комментарий версии. Живая проверка: проба интерфейса (`references/probes.md`).

### rqw-windows-pack

- `src/modules/rqw-windows-pack/vscode/runtime.json`: `version`, `assets.omp` (`url`, `sha256`, `size`, `file`). Адрес, sha256 и размер `omp-windows-x64.exe` берутся из `releases/tags/v<new>` (`digest`, `size`): команда в `wire-snapshot.md`, пункт 1. Пример 18.20.2: `https://github.com/can1357/oh-my-pi/releases/download/v18.20.2/omp-windows-x64.exe`, `6dbb8ac30106f163fcb61d818e6756799a816cb58d63fc3e11a0d7af56abfb90`, `252504064`.
- `vscode/package.json`: `version` +1 patch (0.0.14 → 0.0.15).
- `Update` во вкладке VDI отказывает на новом `runtime.json` и шлёт в Marketplace (`vscode/index.js`, `unpack`): старый `omp.exe` не получит новый харнес. Новый VSIX: `references/delivery.md`.
- `voice/index.js` импортирует `extractSegments`, `matchesKey`, `truncateToWidth`, `visibleWidth` из `@oh-my-pi/pi-tui` и `CustomEditor` из `@oh-my-pi/pi-tui/prompt/custom-editor`: проверка `imp.js`.

### Codex-транспорт, API расширений

- api `openai-codex-responses` и поля `parallel_tool_calls`, `service_tier`, `all_turns`, `verbosity`: `git grep` в пункте 3 `wire-snapshot.md`. В 18.20.2 на месте. Живая проверка: проба 9 (только Luna).
- API расширений: сравнение `extensibility/extensions/types.ts` и `shared-events.ts`. В 18.20.2 добавлено только событие `session_clear`, наши хуки не задеты.

### `INSTALL.md`

- шаг 1: «Ответ не `omp/<new>`: стоп, ничего не ставь.»

## 3. места с версией (правка текстом)

Версия `18.18.8` → `18.20.2` в README и комментариях (D-122, D-124):

- `rqw-codex-adapter`: README (3 места), `index.js`, `agentsmd.js`.
- `rqw-runtime-config`: README (версия, 94 провайдера).
- `rqw-system-core`: README (версия, пункт о пометке убран).
- `rqw-windows-pack`: README (2 места), `voice/index.js`.
- `rqw-harness-interface/model-picker.js`: комментарий.
- `INSTALL.md`.
- тест `dev/tests/harness/rqw-system-core/rqw-system-core.test.js`, комментарий «OMP 18.18.8 capability/rule.ts ruleAppliesToAgent» → версия `<new>`. До правки проверено, что `ruleAppliesToAgent` между тегами не менялась: `git diff v<old> v<new> --stat -- packages/coding-agent/src/capability/rule.ts` и сам diff (в 18.20.2 добавлено только поле `repeatMode`).

Другие версии в записях истории (`dev/DECISIONS.md` прошлые записи, `dev/history/`) не правятся (`references/delivery.md`, фаза H).

## 4. проверка правок на копии (фаза B, до ветки)

Правки текстом проверены на копии агента, на проводе, до ветки. Скрипт строит `agent-new-fix` из `agent-new-nowa` (копия `agent-new-full` без обхода per-call, см. `wire-snapshot.md`, пункт 4; обход удалён в D-122, в следующий раз копируй `agent-new-full`), правит якоря и эталон, делает снимок и проверяет условия. Замены якорей здесь именно 18.20.2: для новой версии пиши свои. Слова `workpool` собирай склейкой (`WP`).

```js
const B='/tmp/omp-up', A=B+'/agent-new-fix', WP='work'+'pool';
await sh(`rm -rf ${A} && cp -R ${B}/agent-new-nowa ${A}`);
const f=A+'/extensions/rqw-codex-adapter/index.js';
let s=await Bun.file(f).text(); const s0=s;
s=s.replace('"Read-only research MUST use `scout` only when files unknown. ",','"most specific, ",')
   .replace('\t\t\t"Use most specific agent.",','\t\t\t"Read-only research MUST use `scout` only when files unknown.",')
   .replace(`"For 2+ independent items, use a named \`${WP}()\`; results auto-deliver. If blocked, leave \`eval\` and call \`wait\`.\\n",`,'"If blocked, leave `eval` and call `wait`.\\n",')
   .replace('DAG waves \\u2192 `xd://eval/agents`\\n"','DAG waves \\u2192 xd://eval/agents\\n"');
const a0=s0.split('\n'), a1=s.split('\n'); const changed=a0.filter((l,i)=>l!==a1[i]).length;
await write(f,s);
const nat=JSON.parse(await Bun.file(B+'/cap-new-native.json').text());
const rf=A+'/extensions/rqw-base-tools/rqw-base-tools.reference.json';
const ref=JSON.parse(await Bun.file(rf).text());
for (const t of nat.tools){const n=t.name.replace(/^_/,''); if(ref.tools[n]) ref.tools[n].description=t.description;}
await write(rf, JSON.stringify(ref,null,'\t')+'\n');
const bf=A+'/extensions/rqw-base-tools/index.js'; let b=await Bun.file(bf).text(); const b0=b;
b=b.replace(/\/\/ On Windows OMP adds one line to bash[^\n]*\nconst WINDOWS_LINE = [^\n]*\n\/\/ Without the `eval` tool[^\n]*\nconst native = [^\n]*\n/,
 '// OMP lists its shell builtins in bash (prompts/tools/bash.md): the list follows the platform, not a change.\nconst BUILTINS = /^In-process builtins, ahead of PATH: .*$/m;\nconst native = text => String(text).replace(BUILTINS, "");\n');
await write(bf,b);
print('codex lines changed', changed, 'base-tools changed', b!==b0);
const out=B+'/cap-new-fix.json';
print(await sh(`cd ${B}/proj && PI_CODING_AGENT_DIR=${A} CAP_OUT=${out} ANTHROPIC_API_KEY=sk-ant-fake ${B}/omp -p --no-session -e ${B}/cap.js --model anthropic/claude-sonnet-5-5 "say ok" 2>&1 | tail -c 300`,{timeout:180}));
const fix=JSON.parse(await Bun.file(out).text()), old=JSON.parse(await Bun.file(B+'/cap-old-full.json').text());
const T=p=>Object.fromEntries(p.tools.map(t=>[t.name,t.description]));
const tf=T(fix), to=T(old);
const X='Omit `agent` by default: a general worker equal to you.';
print('task X count new-fix', tf.task.split(X).length-1, 'old', to.task.split(X).length-1);
print('task has scout MUST', tf.task.includes('Read-only research MUST'), 'has most specific', tf.task.includes('most specific'));
print('task head', tf.task.split('\n').slice(0,2));
print('task agent block', tf.task.split('\n').filter(l=>/^- `agent`|^  - (Omit|Prefer)/.test(l)).map(l=>l.slice(0,110)));
print('eval agent line', /xd:\/\/eval\/agents/.test(tf.eval), 'eval wp', tf.eval.includes(WP+'()'), 'eval Bun add', tf.eval.includes('Use JavaScript (Bun) by default'), 'js example', tf.eval.includes('my setup.js'));
const BUILTINS=/^In-process builtins, ahead of PATH: .*$/m, native=t=>String(t).replace(BUILTINS,'');
const NT=Object.fromEntries(nat.tools.map(t=>[t.name,t]));
for (const n of Object.keys(ref.tools)) print('guard',n, native(NT[n].description)===native(ref.tools[n].description)?'ok':'MOVED');
print('other builtins list still ok:', native(NT.bash.description.replace(/(ahead of PATH: ).*/,'$1awk, cat, ls'))===native(ref.tools.bash.description));
print('messages equal to old-full:', JSON.stringify(fix.messages)===JSON.stringify(old.messages));
```

Результат 18.20.2: `codex lines changed 4`, `task X count new-fix 1 old 1`, `eval agent line false`, `eval wp false`, шесть `guard ... ok`, `other builtins list still ok: true`, `messages equal to old-full: true`.

## 5. эталон сторожа в ветке (построчно)

В ветке эталон правится только по строкам `description` (`git diff --stat`: 4 строки). Файл с табами и однострочными `fields`, поэтому целиком его не пересохраняй. Хвостовую запятую снимай перед `JSON.parse`. Путь worktree подставь свой.

```js
const W='/Users/arkadijcukavin/ai-project/omp-lite-worktrees/omp-18-20-2', f=W+'/src/modules/rqw-base-tools/rqw-base-tools.reference.json';
const nat=JSON.parse(await Bun.file('/tmp/omp-up/cap-new-native.json').text());
const NT=Object.fromEntries(nat.tools.map(t=>[t.name.replace(/^_/,''),t.description]));
const lines=(await Bun.file(f).text()).split('\n'); let tool=null, changed=[];
for (let i=0;i<lines.length;i++){ const m=lines[i].match(/^\t\t"(\w+)": \{$/); if(m) tool=m[1];
  if (tool && /^\t\t\t"description": /.test(lines[i])) { const now=JSON.parse('{'+lines[i].trim().replace(/,$/,'')+'}').description;
    if (now!==NT[tool]) { lines[i]='\t\t\t"description": '+JSON.stringify(NT[tool])+','; changed.push(tool); } } }
await write(f, lines.join('\n'));
const ref=JSON.parse(await Bun.file(f).text());
print('changed', changed, 'all equal now:', Object.entries(ref.tools).every(([n,w])=>w.description===NT[n]));
print(await sh`cd ${W} && git diff --stat`);
```

Результат 18.20.2: `changed [ 'read', 'bash', 'glob', 'write' ] all equal now: true`.

## 6. тесты (план, раздел 6)

Минимум строк, новых тестов нет. В 18.20.2 менялись четыре файла и один комментарий:

1. `dev/tests/harness/rqw-codex-adapter/rqw-codex-adapter.test.js`: образцы описаний `task` и `eval` в форме 18.20.2 (4 строки). Образец `task`: «Spawn `tasks[]` concurrently.\n\n# Inputs\n- `agent`: most specific, inside each `tasks[]` item.\n  - Read-only research MUST use `scout` only when files unknown.\n  - Prefer one agent.\n- `scout`: ...». Образец `eval`: две строки «For 2+ independent items…» и «If blocked…» разделены `\n`, строка пространства имён без обратных кавычек у `xd://eval/agents`.
2. `dev/tests/harness/rqw-base-tools/rqw-base-tools.test.js`: константа `WINDOWS` и тест строки Windows ушли; тест «с `files`, именами GPT и другим списком встроенных команд» подменяет список через `.replace(/(ahead of PATH: ).*/, "$1awk")`. Ожидание про маркер: `.split("Persistent bash")[0]`.
3. `dev/tests/harness/rqw-system-core/rqw-system-core.test.js`: удалены подмена `block-symbols` (`MARK`) и проверка пометки (минус 7 строк); тест называется «the reminder ends every user message, other messages stay».
4. `dev/tests/repository/rqw-windows-pack.test.js`: пин `18.20.2` в двух местах (2 строки).
5. `bun test dev/tests` целиком зелёный: 96 pass, 0 fail, 950 проверок, 18 файлов.

Если маркер хвоста не обновить, падает тест сторожа, а провод не меняется: поэтому провод проверяет снимок, не тест.

## 7. запись D (по форме D-122)

Последняя запись в конце `dev/DECISIONS.md`, русский. Разделы по порядку: `**Решение:**` (нумерованный список по модулям, что изменено и почему), `**Основание:**` (слова владельца с датой, цитаты дословно), `**Проверка:**` (снимки, число равных настроек, импорты, результат `bun test dev/tests`), `**Причина:**` (файлы исходников OMP новой версии), `**Границы:**` (что не проверено: VDI; VSIX только по слову владельца; граница строки `task`), `**Носители правила:**` (изменённые файлы). Заголовок: `## D-<n> — харнес на OMP <new>: минимальный апдейт`.

Прошлый апдейт, D-047 («OMP обновлён до 18.18.8»), записан короче: `Решение`, `Основание`, `Что изменилось в OMP и что сделано`, `Граница`, `Носители правила`. Берись за форму D-122.
