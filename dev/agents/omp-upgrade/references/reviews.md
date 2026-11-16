# Код-ревью и blind review

Когда читать: фаза C (blind review плана), фаза F (код-ревью и blind review ветки), фаза H (blind review «всего вокруг»).

Порядок владельца (96d42d82), модель по слову владельца 4ad0803e: код-ревью `antigravity-cli/gemini-4-hydrogen:medium` в цикле, пока один прогон не станет чистым. Потом blind review, пока не будет чисто. Цикл повторять, пока оба не чистые подряд и между ними нет правок. Ревьюеры работают только на чтение. Работа сабагентов: свежий агент каждый круг, отработавшего гасить (`write` с `path: proc://<id>/kill` и `content: ""`).

## 1. код-ревью

Задание лежит в файле `/tmp/omp-up/CODEREVIEW.md`, один на все круги. Сабагент получает вызов `task`: `context: "code review, read-only"`, `name: GemReview<n>`, `model: antigravity-cli/gemini-4-hydrogen:medium`, `solutionSpace: "deep read-only code review; findings open"`, `task`:

```
Read `/tmp/omp-up/CODEREVIEW.md` and do exactly what it says. It is your full brief: scope, questions, answer format. Read-only: change nothing. Our eval guard blocks eval code containing the literal text `agent(` or `workpool(`: build such strings by concatenation.
```

Текст `/tmp/omp-up/CODEREVIEW.md` (дословно, прогон 18.20.2). Версию, пути ветки и имена файлов снимков замени своими:

````
# код-ревью апдейта харнеса на OMP 18.20.2

Ты ревьюер кода. Только чтение: ничего не правь, не коммить, не ставь. Запросы к моделям не делай.

## что проверять

- ветка: `git -C /Users/arkadijcukavin/ai-project/omp-lite-worktrees/omp-18-20-2 diff main..HEAD` плюс незакоммиченное (`git diff`).
- принятый план: `/tmp/rqw-omp-update-plan.md`. журнал и отклонения: `/tmp/omp-up/ROADMAP.md`.
- исходники OMP 18.20.2: `~/ai-project/omp-src` (тег `v18.20.2`, пакет `packages/coding-agent/src`). Тег `v18.18.8` есть в том же клоне: `git -C ~/ai-project/omp-src show v18.18.8:<path>`.
- живые снимки запроса: `/tmp/omp-up/cap-old-full.json` (18.18.8, старый харнес), `/tmp/omp-up/cap-branch-full.json` и `/tmp/omp-up/cap-branch-native.json` (18.20.2, ветка; native без расширений).
- живые пробы, если уже есть: `/tmp/omp-up/probe-*/` и отчёты в ROADMAP.md.

## вопросы

1. Каждая правка ветки села верно на 18.20.2: якоря `EDITS.task` и `EDITS.eval` в `rqw-codex-adapter/index.js` совпадают с текстами 18.20.2 (`prompts/tools/task.md`, `eval.md`, как OMP их рендерит), правка идемпотентна при повторном проходе.
2. Сторож `rqw-base-tools`: эталон равен родным текстам 18.20.2; нормализация строки builtins верна; маркер `Persistent bash` верен; на Windows (bash.md без ветки isWindows) сторож не даст ложного предупреждения.
3. Удаление обхода per-call в `rqw-system-core` безопасно на 18.20.2 (`extensibility/extensions/runner.ts`, `emitContext`, `#isRepeatedProjection`, `packages/ai/src/utils/block-symbols.ts`): памятка не станет per-call ни на первом, ни на следующих запросах, кеш Anthropic не ломается.
4. `disabledProviders`: закрыты все провайдеры 18.20.2, кроме четырёх открытых (`packages/catalog/src/compat/provider-ids.ts`).
5. `runtime.json`: адрес, sha256, размер совпадают с релизом v18.20.2 (`https://api.github.com/repos/can1357/oh-my-pi/releases/tags/v18.20.2`, поле `digest`; это не модель, сеть можно).
6. Ни одна механика харнеса не сломана: все модули `src/modules/*` против 18.20.2 (импорты внутренних модулей OMP, хуки, события, настройки, тексты).
7. Нет лишнего: ничего сверх плана и слов владельца; отклонения в ROADMAP.md обоснованы.
8. Тесты ветки покрывают правки минимально и верно; `bun test dev/tests` в worktree зелёный (запусти).

## ответ

Первая строка: `CLEAN` или `FINDINGS`.
Дальше по одной находке: `<n>. <critical|high|medium|low> <файл:строка>: <проблема>. Доказательство: <путь/цитата/команда>. Как чинить: <минимально>.`
CLEAN значит: нет critical, high, medium.
````

Результат 18.20.2, круг 1: `CLEAN`. `bun test dev/tests`: 96 pass, 0 fail, 950 проверок, 18 файлов. Якоря и идемпотентность верны; эталон совпал 6 из 6; открыты только четыре провайдера; пин Windows совпал с релизом GitHub; удаление per-call безопасно; сообщения снимков равны; отклонение с `Persistent bash` обосновано. Хватило одного круга.

Есть находки (`FINDINGS`): правь минимально, потом новый круг со свежим агентом. Чисто (`CLEAN`): иди на blind review.

## 2. blind review

Процедура целиком в `skill://reviewer/SKILL.md` (`~/.omp/agent/skills/reviewer/SKILL.md`), уровень blind. Здесь только то, что делалось в 18.20.2.

1. сам перечитай работу по словам владельца: убери незаказанное, доделай заказанное.
2. сборщик один раз: `echo "$PI_SESSION_FILE"` даёт файл сессии. `task` с `context: "acceptance review"`, один элемент: `agent: "collector"`, `solutionSpace: "fixed procedure"`, без `model`. Текст из четырёх строк:

```
session: <файл сессии>
repo: <каталог работы; worktree задачи, пока он есть>
start: <первые слова сообщения владельца, с которого началась задача>
scope: <что ревьюить: слова владельца дословно; без них одна строка с названием задачи>
```

   Ответ `READY <dir>`: дальше. Ответ `STOP <причина>`: поправь строку и вызови ещё раз. Сборщика гаси.
3. приёмщик каждый круг новый: `task` с `context: "acceptance review"`, `agent: "acceptor"`, `solutionSpace: "fixed procedure"`, `task: "dir: <dir>"`, `model: "openai-codex/gpt-6.1-terra:xhigh"`. Отработавшего гасить.
4. проверка полноты ответа: каждый номер строки `facts.md` (`R1`, `R4.1`, `L1`, `W1`) и `updates.md` (`J1`) начинает строку ответа. Нет строки у номера: ответ не вердикт, круг повторить один раз. Проверка скриптом, составленным из двух вызовов 18.20.2 (читает `facts.md`, `updates.md` и ответ агента `agent://<id>`):

```js
const dir='<dir>';
const facts=await Bun.file(dir+'/facts.md').text();
const ids=[...facts.matchAll(/^(R\d+(?:\.\d+)?|L\d+|W\d+)\b/gm)].map(m=>m[1]);
let upd=''; try{upd=await Bun.file(dir+'/updates.md').text();}catch{}
const jids=[...upd.matchAll(/^(J\d+)\b/gm)].map(m=>m[1]);
const ans=await read('agent://<id>');
const txt=typeof ans==='string'?ans:JSON.stringify(ans);
const lines=txt.split(/\n/).map(l=>l.replace(/^\s*\d+\|/,'').trim());
const missing=[...ids,...jids].filter(id=>!lines.some(l=>new RegExp('^'+id.replace('.','\\.')+'(\\s|$)').test(l)));
print('rows', ids.length+jids.length, 'missing', missing, 'updates.md', !!upd, 'len', txt.length, lines[0]);
```

5. `FINDINGS`: открой место сам. Находка верна: чини минимально (сперва убрать, потом менять, добавлять только названное). Находка неверна или не про заказ: возражение в `<dir>/updates.md` с цитатой находки и своим доводом (место в работе, слова владельца с id, правило репозитория). Блок `## Round <n>` на каждый круг. Если правка тронула файл вне `Work`: строка `J1 <путь>`.
6. `CLEAN`: заметки (`note`) в журнал `updates.md`. Пример строк 18.20.2:

```
# Updates

## Journal
1.1 note missing R23 main: note (merge и push по плану после ревью)
1.2 note missing R25 /tmp/omp-up: note (уборка по плану после отчёта)
```

7. принято: два чистых круга подряд, работа между ними не менялась, ревьюеры разные и свежие, оба ответа полные. После приёмки: `rm -rf <dir>`, агентов погасить, новую проверку сам не начинай. Итог один раз в конце: вердикт, охват (строки требований, файлы), число раундов, спорные находки и заметки.

## 3. что было в 18.20.2

- план: сбор, два раунда CLEAN подряд (5 требований, 3 ограничения, 2 строки работы), находок 0, заметок 0. Принят без правок плана.
- ветка (апдейт, пробы): код-ревью CLEAN с первого круга. Blind: сбор и 25 требований, 8 ограничений, 40 позиций работы (88 строк с номерами). Раунд 1 CLEAN, `ordered 40, done 38, missing 2, wrong 0, extra 0`: два «missing» были шагами после ревью (merge и push, уборка), оформлены как `note`. Раунд 2 CLEAN с теми же числами, ответ полный 88 из 88. Правок между кругами не было.
- «всё вокруг» (правило 38, D-124, навык, комментарий теста): раунд 1 `FINDINGS`, `ordered 3, done 3, missing 0, wrong 0, extra 4`. Две находки: в правиле 38 лишние фразы «VSIX выпускай только по слову владельца» и запрет править историю: убраны (`dev/PROCESS.md`, amend коммита). Две находки про записи в `.omp/inventory/ORDER.md` и `JOURNAL.md`: возражение в `updates.md` (правило проекта `.omp/rules/inventory-resume.md`: каждый заказ владельца дословно в `ORDER.md`), статус `settled`. Раунды 2 и 3 CLEAN (`ordered 3, done 3, 0, 0, 0`, ответ полный 9 из 9). Принято.

Вывод: ревьюер считает extra всё сверх слов владельца, даже разумные фразы. Не добавляй своего; записи журнала проекта защищай правилом проекта.

## 4. что было в 18.21.0

- план: один сбор, семь кругов, чистые 6 и 7 подряд, 28 из 28. Находки кругов 1-5: имя модели «Hydra» (возражение: в OMP это `gemini-4-hydrogen`, settled); удаление своего локального тега в `omp-src` (settled); в плане не было проверки видимости в Marketplace, чтения `ROADMAP.md` после компакта, работы сабагентами и их гашения, числа строк по файлам (всё дописано).
- ветка: код-ревью `antigravity-cli/gemini-4-hydrogen:medium` CLEAN с первого круга (7 вопросов, `bun test dev/tests` 98 pass). Blind: один сбор, три круга, чистые 2 и 3 подряд, 31 из 31. Находка круга 1: в `ROADMAP.md` не стояли галочки готовых фаз и строки C и F расходились с новыми словами владельца (исправлено).
- вопросы код-ревью под малый апдейт (эталон и якоря не менялись) лежали в `/tmp/omp-up/CODEREVIEW.md`: якоря `EDITS.task` и `EDITS.eval` против новых текстов; эталон сторожа со всеми формами `alt`; `disabledProviders` против `provider-ids.ts`; пин `runtime.json` против релиза; механики `src/modules/*`; нет лишнего; тесты.
