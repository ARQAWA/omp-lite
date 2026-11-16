# Живые пробы на дешёвых моделях

Когда читать: фаза F, после того как на Mac стоит `omp/<new>` и харнес из ветки.

Пробы проверяют то, что снимок запроса не показывает: что модели реально делают с нашими текстами и тулами. Только дешёвые модели (правило владельца 5 в `SKILL.md`). Флаги `--model <M> --thinking <L>` на каждый запуск.

## Модели и уровни

|слаг|модель `--model`|`--thinking`|пробы|
|---|---|---|---|
|`luna`|`openai-codex/gpt-6-luna`|`medium`|1-9 (проба 9 только Luna)|
|`haiku`|`anthropic/claude-haiku-5-5`|`medium`|1-8|
|`dsgo`|`opencode-go/deepseek-v4.1-flash`|`low`|1-8|
|`dsor`|`openrouter/deepseek/deepseek-v4.1-flash-1017`|`low`|1-8|
|`tui`|`opencode-go/deepseek-v4.1-flash`|`low`|интерфейс (TUI)|

В пробе 6 модель сабагента задаётся как `<модель>:<уровень>`, например `openai-codex/gpt-6-luna:medium`.

## Распределение сабагентов

Один сабагент на модель, своя папка `/tmp/omp-up/probe-<slug>`. Исполнители проб в 18.20.2: четыре модельных набора вёл `anthropic/claude-sonnet-5-5:medium`, интерфейс вёл `openai-codex/gpt-6.1-terra:high`. Все пять шли параллельно, вместе с первым кругом код-ревью. Спецификация проб лежала в `/tmp/omp-up/PROBES.md` (текст ниже), каждому сабагенту отдаются общий контекст и своё задание. Отработавшего гасить.

Общий контекст (`context` вызова `task`):

````
# Goal
Live proof that the omp-lite harness works on OMP 18.20.2 (already installed on this Mac: `omp --version` = `omp/18.20.2`).

# Contract
- Your full spec: `/tmp/omp-up/PROBES.md`. Follow it exactly, only your own probe set and folder.
- Use ONLY your assigned model and thinking level for every `omp` run. Never another model.
- Do not change anything outside your probe folder. Never touch `~/.omp/agent`, the repo, or the worktree.
- Our eval guard blocks eval code containing the literal text `agent(` or `workpool(`: build such strings by concatenation, or use bash.
- Report: the table the spec asks for, with evidence.
````

Задания (`name`, `model`, `solutionSpace: "fixed probe procedure"`):

````
ProbeLuna: Probe set: sections "подготовка" and "пробы" 1-9 of `/tmp/omp-up/PROBES.md`. slug `luna`, folder `/tmp/omp-up/probe-luna`. Model `openai-codex/gpt-6-luna`, thinking `medium` (flags `--model openai-codex/gpt-6-luna --thinking medium`; in probe 6 the subagent model is `openai-codex/gpt-6-luna:medium`). Probe 9 applies to you.

ProbeHaiku: Probe set: sections "подготовка" and "пробы" 1-8 of `/tmp/omp-up/PROBES.md`. slug `haiku`, folder `/tmp/omp-up/probe-haiku`. Model `anthropic/claude-haiku-5-5`, thinking `medium` (flags `--model anthropic/claude-haiku-5-5 --thinking medium`; in probe 6 the subagent model is `anthropic/claude-haiku-5-5:medium`). Skip probe 9.

ProbeDsGo: Probe set: sections "подготовка" and "пробы" 1-8 of `/tmp/omp-up/PROBES.md`. slug `dsgo`, folder `/tmp/omp-up/probe-dsgo`. Model `opencode-go/deepseek-v4.1-flash`, thinking `low` (flags `--model opencode-go/deepseek-v4.1-flash --thinking low`; in probe 6 the subagent model is `opencode-go/deepseek-v4.1-flash:low`). Skip probe 9.

ProbeDsOr: Probe set: sections "подготовка" and "пробы" 1-8 of `/tmp/omp-up/PROBES.md`. slug `dsor`, folder `/tmp/omp-up/probe-dsor`. Model `openrouter/deepseek/deepseek-v4.1-flash-1017`, thinking `low` (flags `--model openrouter/deepseek/deepseek-v4.1-flash-1017 --thinking low`; in probe 6 the subagent model is `openrouter/deepseek/deepseek-v4.1-flash-1017:low`). Skip probe 9.

ProbeTui: Probe set: section "проба интерфейса (TUI)" of `/tmp/omp-up/PROBES.md` (do the "подготовка" steps 1-3 for folder `/tmp/omp-up/probe-tui`, no log.js). Model `opencode-go/deepseek-v4.1-flash`, thinking `low` only. Drive the interactive TUI through a pseudo-terminal (python3 `pty` or `script`); tmux is not installed. Make sure the omp process is gone at the end.
````

## Текст `/tmp/omp-up/PROBES.md` (дословно, прогон 18.20.2)

Версию `18.20.2` и ветку `omp-18-20-2` в предусловии замени своими. Блок TUI в конце дописывается к тому же файлу.

````
# пробы харнеса на OMP 18.20.2 (живые, дешёвые модели)

Предусловие: на Mac `omp --version` = `omp/18.20.2`, харнес установлен по INSTALL.md из ветки `omp-18-20-2`.

## правила

- только модель своей пробы, только свой уровень: флаги `--model <M> --thinking <L>`.
- запуск: `omp -p --model <M> --thinking <L> -e $P/log.js "<prompt>"` в папке `$P` (без `--no-session`: сессия нужна как доказательство).
- доказательства: ответ модели, строки `$P/log.jsonl`, файл сессии (`~/.omp/agent/sessions/`, папка по пути `$P`, новейший `.jsonl`): вызовы тулов и их результаты.
- код eval со словами `agent(` и `workpool(` наш сторож блокирует: в своём eval собирай их склейкой.
- ничего вне `$P` не менять. `~/.omp/agent` не трогать.
- проба не прошла из-за модели (не вызвала тул, ошиблась в аргументах): повтори один раз тем же промптом. второй раз: запиши FAIL-модель и иди дальше.

## подготовка `$P = /tmp/omp-up/probe-<slug>`

1. `mkdir -p $P && cd $P && git init -q`.
2. `AGENTS.md`: одна строка `Probe token: <slug>-7319`.
3. `a.txt`: три строки `alpha`, `beta`, `gamma`. `b.txt`: три строки `one`, `two`, `three`.
4. `log.js`:

```js
import { appendFileSync } from "node:fs";
const flat = tools => (Array.isArray(tools) ? tools : []).flatMap(t => t?.functionDeclarations ?? [t?.function ?? t?.toolSpec ?? t]);
export default function log(pi) {
  pi.on("before_provider_request", (event, ctx) => {
    const p = event.payload ?? {}, tools = flat(p.tools ?? p.config?.tools ?? p.request?.tools);
    const desc = n => tools.find(t => String(t?.name).replace(/^_/, "") === n)?.description ?? "";
    const text = JSON.stringify(p.messages ?? p.input ?? p.contents ?? p.request?.contents ?? "");
    appendFileSync(new URL("./log.jsonl", import.meta.url), JSON.stringify({
      model: ctx.model?.provider + "/" + ctx.model?.id, api: ctx.model?.api, agent: ctx.agent?.kind,
      tools: tools.map(t => String(t?.name)),
      taskOmit: desc("task").includes("Omit `agent` by default"), taskScoutMust: desc("task").includes("Read-only research MUST"),
      evalAgents: desc("eval").includes("xd://eval/agents"), evalCommit: desc("eval").includes("xd://eval/commit"),
      bashOurs: desc("bash").startsWith("Terminal only"), readOurs: desc("read").startsWith("Reads a file"),
      reminder: text.includes("## Workflow") && text.includes("Do all that was ordered"),
      parallel: p.parallel_tool_calls, reasoningContext: p.reasoning?.context, verbosity: p.text?.verbosity, tier: p.service_tier,
    }) + "\n");
    return p;
  });
}
```

## пробы (каждая отдельным запуском)

1. reminder: `Answer only yes or no: does my message contain a section titled Workflow?` ждём `yes`; в log `reminder: true` у главного.
2. files: `Call the files tool once with path "." and pattern "Probe token". Then reply with the first line of its output only.` ждём строку `1 files, 1 matches, ...`.
3. read: `Read a.txt with the read tool. Reply with the last line of the tool result only.` ждём: результат тула `read` в файле сессии кончается строкой `[whole file: 3 lines]`. ответ модели бывает `gamma` (метку она считает служебной): это не сбой.
4. patch (файл `$P/p4.txt` с этим текстом, запуск с `"$(< p4.txt)"` вместо промпта в кавычках): `Read a.txt with the read tool. Then call the edit tool exactly once, with both sections in one patch: section one is the header of a.txt copied from the read result, then the lines 'PUT 2.=2:' and '+BETA'; section two is the header '[b.txt#0000]' exactly as written here (do not read b.txt, do not correct the tag), then the lines 'PUT 2.=2:' and '+TWO'. Then reply with the first line of the edit tool result only.` ждём: результат начинается с `Partial patch:`, в `a.txt` есть `BETA`, `b.txt` не изменён. только модели с `edit` в режиме `hashline` (luna, haiku); у deepseek `edit` в режиме `replace`: пробу 4 пропусти.
5. eval guard: `Run the eval tool once, language js, code: await agent("x"). Reply with the tool result text only.` ждём текст `Direct agent() and workpool() calls are blocked in eval`.
6. subagent AGENTS.md: `I explicitly ask you to spawn exactly one subagent with the task tool, model "<M>:<L>". Its task: "Reply with the Probe token line from your AGENTS.md context. Do not read any files." Reply with what it returned.` ждём `Probe token: <slug>-7319`; в сессии сабагент не читал файлы.
7. web_search: `Use the web_search tool once to find the latest release tag of the GitHub repo can1357/oh-my-pi. Reply with the tag only.` ждём тег вида `v18.x`; в сессии вызван `web_search`, без ошибки.
8. описания (по log.jsonl любого запроса главного): `taskOmit: true`, `taskScoutMust: false`, `evalAgents: false`, `evalCommit: true`, `bashOurs: true`, `readOurs: true`, в `tools` есть `files`.
9. только Luna (`openai-codex`): в log `parallel: true`, `reasoningContext: "all_turns"`, `verbosity: "low"`, `tier: "priority"`.

## отчёт

Таблица: проба, PASS/FAIL, доказательство (короткая цитата ответа, строка log, вызов из сессии). Пути к файлам сессий. Вывод `cat $P/a.txt $P/b.txt` после пробы 4.

## проба интерфейса (TUI), одна модель: opencode-go/deepseek-v4.1-flash, low

Папка `$P=/tmp/omp-up/probe-tui` (подготовка как выше, без log.js). tmux нет: псевдотерминал через python3 `pty` (или `script`), размер 160x45, `TERM=xterm-256color`. Весь вывод писать в `$P/tty.raw`; для поиска снимать ANSI.

Запуск: `omp --model opencode-go/deepseek-v4.1-flash --thinking low` в `$P`.

1. статуслайн: после старта (ждать до 30 с) в выводе есть `cmp 0` и метки подписок `CC`, `CX`, `Go` с процентами (данные из `omp usage --json`; метки без данных опускаются: тогда записать, каких нет, и вывод `omp usage --json` по провайдерам).
2. сторож: в выводе НЕТ `rqw-base-tools:` (предупреждений сторожа быть не должно).
3. пикер: послать Shift+Up (`\x1b[1;2A`): появился заголовок из `~/.omp/agent/extensions/rqw-harness-interface/model-picker.json` (поле `title`). потом Esc: закрылся.
4. ход: ввести `Read a.txt with the read tool, then reply ok.` и Enter. дождаться конца хода. есть строка счётчика тулов (метка `read` из `tool-summary.json`, число 1) и тусклая метка времени хода `⏱ `.
5. выход: `/exit` по одной букве с паузой 0,4 с, через 2 с Enter; или два Ctrl+C.

Отчёт: каждая проверка PASS/FAIL с цитатой из вывода без ANSI.
````

Что проверяет каждая проба: 1 памятка (`rqw-system-core`); 2 тул `files` (`rqw-base-tools`); 3 `read` (наш текст, метка `[whole file: N lines]`); 4 частичный патч (`Partial patch:`, второй файл не тронут); 5 сторож `eval` (`rqw-codex-adapter`); 6 `AGENTS.md` у сабагента и модель сабагента через `model`; 7 `web_search` (Codex-поиск); 8 описания тулов в запросе (правки `task`, `eval`, `bash`, `read`); 9 флаги Codex (транспорт); TUI: статуслайн, молчание сторожа, пикер модели, счётчик тулов, время хода, выход.

## Итоги 18.20.2 (пример)

|набор|итог|что было не PASS|
|---|---|---|
|`luna`|9 из 9|в пробе 6 модель сама исправила пропущенный `context`. Проба 9: `parallel`, `all_turns`, `low`, `priority` и у сабагента; `edit` шёл как `apply_patch`|
|`haiku`|8 из 8|без повторов. Памятка у сабагента `false`: так задумано, `rqw-system-core` только для главного|
|`dsor` (openrouter, low)|7 из 8|проба 3 FAIL-модель: тул вернул верно, модель дважды ответила `gamma` вместо последней строки. Проба 4 прошла только со второго раза|
|`dsgo` (opencode-go, low)|7 из 8|проба 4 FAIL-модель: модель исправила патч под файл, частичного патча не было. Частичный патч доказан на `haiku`, `luna`, `dsor`. В пробе 6 модель сперва взяла `scout` с `model`, OMP отказал (`agentModelOverrides`), модель поправилась|
|`tui`|6 из 6|статуслайн `CC 44% · CX 66% · Go 20%/52% · cmp 0`; сторож молчит; пикер открыт и закрыт; `read 1`; `⏱ 8s` тусклый; выход чистый, процесса нет|

Правило итога: сбой по вине модели (ответила не то, не вызвала тул) не ломает апдейт, если тул отвечал верно и поведение доказано на другой модели.

## Итоги 18.21.0

|набор|итог|заметки|
|---|---|---|
|`luna`|9 из 9|проба 4 (новая редакция): результат `edit` начинается с `Partial patch:`, `a.txt` с `BETA`, `b.txt` цел. Проба 9: `parallel`, `all_turns`, `low`, `priority`|
|`haiku`|8 из 8|проба 3: результат `read` кончается `[whole file: 3 lines]`, модель трижды ответила `gamma`. Проба 4 (новая редакция): `Partial patch:`, `a.txt` с `BETA`, `b.txt` цел|
|`dsgo`|7 из 7|проба 4 пропущена: `edit` в режиме `replace`, один файл на вызов. Проба 3: результат тула верен, ответ `gamma`|
|`dsor`|7 из 7|как `dsgo`|
|`tui`|6 из 6|статуслайн `CC 80% · CX 55% · Go 96%/48% · cmp 0`; сторож молчит; пикер; `read 1`; `⏱ 12s`; `/exit` после хода: выход за 0,3 с, «Closing session…». Первый прогон дал ложный FAIL выхода: драйвер вставлял `/exit` целиком|

В первой редакции пробы 4 модель ставила номер строки и отсев не срабатывал; в первой редакции пробы 3 ждали ответ модели, а не результат тула. Обе пробы переписаны и пройдены заново.

Исполнители проб: модельные наборы `anthropic/claude-sonnet-5-5:medium`, интерфейс `openai-codex/gpt-6.1-terra:high`.
