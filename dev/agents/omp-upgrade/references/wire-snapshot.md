# Исходники, снимок запроса и сверки версий

Когда читать: фаза A (changelog и бинарь), фаза B (разбор: снимок и все сверки), фаза D (снимок на файлах ветки).

Все скрипты и команды проверены на `18.18.8` → `18.20.2` и дали результат. Версии в тегах: `v<old>`, `v<new>`. Скрипты идут в `eval` (JavaScript). Пути машины владельца оставлены как в том прогоне. Временная папка `/tmp/omp-up`.

## 1. changelog и бинарь новой версии (фаза A)

Тег `v<new>` уже выбран в `~/ai-project/omp-src` (чек-лист, фаза A). Скрипт вытаскивает из всех `CHANGELOG.md` разделы новее `<old>` в `/tmp/omp-up-changelog.md`. В `<old>` точки экранируй (`18\.18\.8`). В примере: 666 строк, 93422 знака. Файл читай целиком тулом `read`.

```js
const r='/Users/arkadijcukavin/ai-project/omp-src/';
const files=(await sh`cd ${r} && git ls-files '*CHANGELOG.md'`).trim().split('\n');
let out='';
for(const f of files){const t=await Bun.file(r+f).text();const i=t.search(/^## \[?18\.18\.8\]?/m);if(i<0){out+=`### ${f}: no 18.18.8 header\n`;continue}
const head=t.slice(0,i);const j=head.search(/^## /m);const body=j<0?'':head.slice(j);if(body.trim())out+=`\n######## ${f}\n${body}`;}
await write('/tmp/omp-up-changelog.md',out);print(out.split('\n').length, out.length)
```

Бинарь новой версии (darwin-arm64) и хеши релиза:

```bash
mkdir -p /tmp/omp-up && curl -sSL -o /tmp/omp-up/omp https://github.com/can1357/oh-my-pi/releases/download/v<new>/omp-darwin-arm64 && chmod +x /tmp/omp-up/omp && shasum -a 256 /tmp/omp-up/omp && /tmp/omp-up/omp --version
curl -s https://api.github.com/repos/can1357/oh-my-pi/releases/tags/v<new> | jq -r '.assets[] | "\(.name) \(.size) \(.digest)"'
```

В примере sha256 бинаря `e2de0974ce581bfcf2044ea795c712fa240fdf8304f7bdb4b3d81b154d2b57fc` совпал с `digest` `omp-darwin-arm64`, `--version` дал `omp/18.20.2`. Из той же выдачи берутся адрес, sha256 и размер `omp-windows-x64.exe` для `runtime.json` (18.20.2: `6dbb8ac30106f163fcb61d818e6756799a816cb58d63fc3e11a0d7af56abfb90`, `252504064`).

18.21.0: `api.github.com` без входа упёрся в лимит 60 запросов в час. Та же выдача через `gh`: `gh api repos/can1357/oh-my-pi/releases/tags/v<new> --jq '.published_at, (.assets[] | "\(.name) \(.size) \(.digest)")'`. Бинарь `omp-darwin-arm64` sha256 `0f8b23c275682c5adaae373bdfe377c8800ebc7ba07b31959a2328ff7a5deaa1`; `omp-windows-x64.exe`: `2880d63e3d23156516b0200fd96a48fac9423cbd9959449efec79279a67ec314`, `254140416`. Качай с `curl -fsSL`: без `-f` на месте бинаря ляжет текст `Not Found`.

## 2. снимок запроса до отправки (фаза B)

Идея: бинарь запускается на копии `~/.omp/agent`, с ключом-пустышкой. Расширение `cap.js` ловит запрос в хуке `before_provider_request`, пишет его в `CAP_OUT` и выходит. Четыре прогона: старый (`omp`) и новый (`/tmp/omp-up/omp`) бинарь, каждый `native` (без наших расширений, `--no-extensions`) и `full` (с ними). `native` даёт родные тексты, `full` даёт итог харнеса.

Оговорка: `cap.js` возвращает запрос сразу, а `process.exit` откладывает на 50 мс. В `packages/ai/src/providers/anthropic.ts` (строка 2330 в 18.20.2) подготовка запроса идёт дальше после `await onPayload`. Отсутствие сетевой попытки доказать нельзя. Защита: ключ `ANTHROPIC_API_KEY=sk-ant-fake` и копия агента в `PI_CODING_AGENT_DIR`. Живой `~/.omp/agent` не трогай, переменные в шелл сессии не `export`.

```js
const B='/tmp/omp-up', H=process.env.HOME+'/.omp/agent';
await write(B+'/cap.js', `import { writeFileSync } from "node:fs";
export default function cap(pi) {
  pi.on("before_provider_request", event => {
    const payload = event.payload;
    setTimeout(() => { writeFileSync(process.env.CAP_OUT, JSON.stringify(payload, null, 1)); process.exit(0); }, 50);
    return payload;
  });
}
`);
await sh(`mkdir -p ${B}/proj && cd ${B}/proj && git init -q 2>/dev/null; true`);
const results={};
for (const [ver,bin] of [['old','omp'],['new',B+'/omp']]) for (const mode of ['native','full']) {
  const A=`${B}/agent-${ver}-${mode}`;
  await sh(`rm -rf ${A} && mkdir -p ${A} && cp ${H}/config.yml ${H}/SYSTEM.md ${H}/models.yml ${A}/ && cp -R ${H}/agents ${H}/rules ${H}/skills ${A}/ && ${mode==='full'?`cp -R ${H}/extensions ${A}/`:'true'}`);
  const out=`${B}/cap-${ver}-${mode}.json`;
  const cmd=`cd ${B}/proj && PI_CODING_AGENT_DIR=${A} CAP_OUT=${out} ANTHROPIC_API_KEY=sk-ant-fake ${bin} -p --no-session ${mode==='native'?'--no-extensions':''} -e ${B}/cap.js --model anthropic/claude-sonnet-5-5 "say ok" 2>&1 | tail -c 1500`;
  let r; try { r=await sh(cmd,{timeout:180}); } catch(e){ r='ERR '+(e.output??e.message); }
  results[ver+'-'+mode]={log:r.trim().slice(-600), cap: await Bun.file(out).exists()};
}
print(results)
```

Доказательство: во всех четырёх записях `cap: true` (лог каждого прогона: `Working...`).

### Сравнение описаний, `messages`, `system`

Первый скрипт: описания шести родных тулов против эталона `rqw-base-tools.reference.json` (старый и новый бинарь, `native`) и описания всех тулов старого против нового (`full`).

```js
const B=process.env.CAP_DIR??'/tmp/omp-up', L=process.env.REPO_DIR??'/Users/arkadijcukavin/ai-project/omp-lite';
const load=async n=>JSON.parse(await Bun.file(`${B}/cap-${n}.json`).text());
const caps={}; for (const n of ['old-native','old-full','new-native','new-full']) caps[n]=await load(n);
const tools=p=>Object.fromEntries((p.tools??[]).map(t=>[t.name.replace(/^_/,''), t]));
const ref=JSON.parse(await Bun.file(L+'/src/modules/rqw-base-tools/rqw-base-tools.reference.json').text());
const BU=/^In-process builtins, ahead of PATH: .*$|^- Selected file: .*\n/m, nz=s=>String(s).replace(BU,'').trim();
for (const v of ['old','new']) {
  const T=tools(caps[v+'-native']);
  print(v, 'tools:', Object.keys(T).join(','));
  for (const [n,w] of Object.entries(ref.tools)) { const t=T[n=== 'edit'&&!T.edit?'apply_patch':n]; if(!t){print(' ',n,'MISSING');continue}
    const fields=Object.keys(t.input_schema?.properties??{}).sort().join(), forms=[w,...(w.alt??[])];
    print(' ',n,'desc', forms.some(x=>x.description&&nz(x.description)===nz(t.description))?'SAME':'DIFF', 'fields', forms.some(x=>x.fields?.join()===fields)?'SAME':'DIFF '+fields); }
}
// full: compare final descriptions old vs new for all tools
const Fo=tools(caps['old-full']), Fn=tools(caps['new-full']);
for (const n of new Set([...Object.keys(Fo),...Object.keys(Fn)])) print('FULL',n, !Fo[n]?'ONLY-NEW':!Fn[n]?'ONLY-OLD':Fo[n].description===Fn[n].description?'same':'diff');
const sys=p=>JSON.stringify(p.system); print('system same?', sys(caps['old-full'])===sys(caps['new-full']));
const msgs=p=>JSON.stringify(p.messages); print('messages same?', msgs(caps['old-full'])===msgs(caps['new-full']));
```

Как читать результат 18.20.2: старый бинарь: у всех шести `desc SAME`. Поля `edit` показывают `DIFF i,input`: это допустимая пара (`apply_patch` через `i`, `input`). Новый бинарь: `read`, `bash`, `glob`, `write` дали `desc DIFF`, `grep` и `edit` `SAME`. `full`: `bash`, `eval`, `task`, `wait`, `todo` разные. `system same? false`, `messages same? true`.

С D-128 скрипт сравнивает как сторож: формы `alt`, вырез `BUILTINS`, `.trim()`. Результат 18.21.0: старый и новый бинарь, все шесть `SAME`; `full`: отличается только `task` (OMP убрал агента `seance`), `system` равен, `messages` равны кроме строки с датой (`Today: ...`): маскируй дату перед сравнением.

Результат 18.22.0 на старом эталоне: новый бинарь, `read` `DIFF` (добавлено «executable metadata, »), остальные пять `SAME`; `full`: отличается `eval` (строка `dsm`), `system` отличается (блок `dsm`). С `disassembler.backend: none` `system` и все тулы равны 18.21.0.

Второй скрипт пишет описания `bash`, `eval`, `task` и `system` в файлы и сравнивает построчно:

```js
const B='/tmp/omp-up';
const load=async n=>JSON.parse(await Bun.file(`${B}/cap-${n}.json`).text());
const o=await load('old-full'), n=await load('new-full');
const T=p=>Object.fromEntries(p.tools.map(t=>[t.name,t.description]));
const to=T(o), tn=T(n);
for (const k of ['bash','eval','task']) { await write(`${B}/d-${k}-old.txt`, to[k]); await write(`${B}/d-${k}-new.txt`, tn[k]); }
const so=o.system.map(b=>b.text).join('\n----\n'), sn=n.system.map(b=>b.text).join('\n----\n');
await write(B+'/d-sys-old.txt', so); await write(B+'/d-sys-new.txt', sn);
print(await sh(`cd ${B} && for k in bash eval task sys; do echo "##### $k"; diff d-$k-old.txt d-$k-new.txt; done; true`));
```

## 3. ключи конфига (фаза B)

Все ключи четырёх фрагментов `config` манифеста: старый и новый бинарь на копиях агента отдают равные действующие значения. В примере: 63 ключа, `all effective values equal`. Ключ идёт целиком, пока он известный id настройки (`id: "..."` в `packages/coding-agent/src`), иначе спускаемся по словарю.

18.21.0: 62 ключа равны; ключ `tools` целиком `config get` не отдаёт («Unknown setting») ни старым, ни новым бинарём: спроси листья `tools.*` (7 равны).

```js
const L='/Users/arkadijcukavin/ai-project/omp-lite', B='/tmp/omp-up';
const man=JSON.parse(await Bun.file(L+'/install.manifest.json').text());
const keys=[]; const R='/Users/arkadijcukavin/ai-project/omp-src';
const known=new Set([...(await sh(`cd ${R} && git grep -h -o -E 'id: "[A-Za-z0-9_.]+"' v<new> -- packages/coding-agent/src`)).matchAll(/id: "([^"]+)"/g)].map(m=>m[1]));
for (const c of man.config){const y=Bun.YAML.parse(await Bun.file(L+'/'+c.from).text()); const walk=(o,p)=>{for(const[k,v]of Object.entries(o)){const id=p?p+'.'+k:k; if(known.has(id)||!(v&&typeof v==='object'&&!Array.isArray(v)))keys.push(id); else walk(v,id)}}; walk(y,'')}
const get=async (bin,A,k)=>{try{return JSON.parse(await sh(`PI_CODING_AGENT_DIR=${A} ${bin} config get ${k} --json`,{timeout:60})).value}catch(e){return 'ERR '+(e.output??e.message).slice(0,80)}};
const diffs=[];
await Promise.all(keys.map(async k=>{const o=await get('omp',B+'/agent-old-full',k), n=await get(B+'/omp',B+'/agent-new-full',k); if(JSON.stringify(o)!==JSON.stringify(n)) diffs.push([k,o,n]);}));
print(keys.length,'keys;', diffs.length? diffs : 'all effective values equal');
```

Прочие проверки, которые прошли в 18.20.2 одним вызовом: `enabledModels`, статуслайн, `omp usage --json`, поля Codex, API расширений, форма `usage`.

```js
const R='/Users/arkadijcukavin/ai-project/omp-src', L='/Users/arkadijcukavin/ai-project/omp-lite', B='/tmp/omp-up';
const run=async c=>{try{return (await sh(c,{timeout:120})).trim()}catch(e){return 'ERR '+(e.output??e.message)}};
const A=B+'/agent-new-full';
print('### config get enabledModels (new)', (await run(`PI_CODING_AGENT_DIR=${A} ${B}/omp config get enabledModels --json`)).slice(0,300));
print('### config get statusLine (new)', (await run(`PI_CODING_AGENT_DIR=${A} ${B}/omp config get statusLine --json`)).slice(0,600));
print('### config get statusLine (old)', (await run(`PI_CODING_AGENT_DIR=${B}/agent-old-full omp config get statusLine --json`)).slice(0,600));
print('### usage --json (new, no creds)', (await run(`PI_CODING_AGENT_DIR=${A} ${B}/omp usage --json`)).slice(0,300));
print('### usage types diff', await run(`cd ${R} && git diff --stat v<old> v<new> -- packages/ai/src/usage/types.ts packages/ai/src/usage.ts packages/coding-agent/src/cli/usage-cli.ts`));
print('### codex fields', await run(`cd ${R} && git grep -c -E 'parallel_tool_calls|service_tier|"all_turns"|verbosity' v<new> -- packages/ai/src/providers/openai-codex-responses.ts packages/ai/src/providers/openai-codex/request-transformer.ts`));
print('### codex api id', await run(`cd ${R} && git grep -c '"openai-codex-responses"' v<new> -- packages/ai/src/types.ts packages/catalog/src`));
print('### vscode omp args', await run(`cd ${L} && grep -n -E 'ompArgs|"--[a-z-]+"' src/modules/rqw-windows-pack/vscode/index.js | head -20`));
print('### websearch imports', await run(`cd ${L} && grep -n -E '^import|fetch\\(|chatgpt.com' src/modules/rqw-codex-adapter/websearch.js | head`));
print('### extension api types diff', await run(`cd ${R} && git diff v<old> v<new> -- packages/coding-agent/src/extensibility/extensions/types.ts packages/coding-agent/src/extensibility/shared-events.ts | grep -E '^[-+][^-+]'`));
```

`statusLine` целиком `config get` не отдаёт («Unknown setting: statusLine»). Спрашивай листья:

```js
const R='/Users/arkadijcukavin/ai-project/omp-src', L='/Users/arkadijcukavin/ai-project/omp-lite', B='/tmp/omp-up';
const run=async c=>{try{return (await sh(c,{timeout:120})).trim()}catch(e){return 'ERR '+(e.output??e.message)}};
const y=Bun.YAML.parse(await Bun.file(L+'/src/modules/rqw-harness-interface/status-line.yml').text());
print(JSON.stringify(y));
for (const k of ['statusLine.leftSegments','statusLine.rightSegments','statusLine.preset'])
  for (const [v,bin,A] of [['old','omp',B+'/agent-old-full'],['new',B+'/omp',B+'/agent-new-full']]) print(v,k,(await run(`PI_CODING_AGENT_DIR=${A} ${bin} config get ${k} --json`)).replace(/\s+/g,' ').slice(0,300));
```

## 4. внутренние импорты харнеса (фаза B)

Скрипт грузит в бинаре импорты, которые харнес берёт из OMP, и пишет список моделей. Варианты `nowa` относились к обходу пометки per-call, удалённому в D-122: строки с `noWa`, `MARK` и проверка `block-symbols` следующему апдейту не нужны. Состав проверяемых импортов бери из поиска по `src` (чек-лист, фаза B).

```js
const B='/tmp/omp-up', H=process.env.HOME+'/.omp/agent';
// variant of system core without the per-call workaround
const core=await Bun.file(H+'/extensions/rqw-system-core.js').text();
const noWa=core.replace(/^import \{ kPerCallContextMessage[^\n]*\n/m,'').replace(/const patch = message => Object\.defineProperty\(\{ \.\.\.message, content: withReminder\(message\.content\) \}, MARK, \{ set\(\) \{\} \}\);/,'const patch = message => ({ ...message, content: withReminder(message.content) });');
print('variant changed:', noWa!==core, noWa.includes('MARK'));
await write(B+'/imp.js', `import { writeFileSync } from "node:fs";
const out = {};
const tryImp = async (name, f) => { try { out[name] = await f(); } catch (e) { out[name] = "ERR " + e.message; } };
await tryImp("natives", async () => { const n = await import("@oh-my-pi/pi-natives"); return Object.fromEntries(["glob","grep","FileType","EditSession","EditStore"].map(k => [k, typeof n[k]])); });
await tryImp("block-symbols", async () => typeof (await import("@oh-my-pi/pi-ai/utils/block-symbols")).kPerCallContextMessage);
await tryImp("withOAuthAccess", async () => typeof (await import("@oh-my-pi/pi-ai")).withOAuthAccess);
await tryImp("registry", async () => typeof (await import("@oh-my-pi/pi-coding-agent/config/registry")).lookup);
await tryImp("approval-cache", async () => typeof (await import("@oh-my-pi/pi-coding-agent/tools/approval-cache")).approvalDirectoryKey);
await tryImp("approval-targets", async () => typeof (await import("@oh-my-pi/pi-coding-agent/tools/approval-targets")).approvalTreeSearchKey);
await tryImp("active-oauth", async () => typeof (await import("@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account")).reportMatchesActiveAccount);
await tryImp("pi-tui", async () => { const t = await import("@oh-my-pi/pi-tui"); return ["extractSegments","matchesKey","truncateToWidth","visibleWidth"].map(k => k + ":" + typeof t[k]).join(","); });
await tryImp("custom-editor", async () => typeof (await import("@oh-my-pi/pi-tui/prompt/custom-editor")).CustomEditor);
export default function imp(pi) {
  pi.on("before_provider_request", (event, ctx) => {
    try { const all = ctx.modelRegistry?.getAll?.() ?? ctx.modelRegistry?.getAvailable?.() ?? []; out.models = all.map(m => m.provider + "/" + m.id); } catch (e) { out.models = "ERR " + e.message; }
    try { out.registryKeys = Object.keys(ctx.modelRegistry ?? {}); } catch {}
    writeFileSync(process.env.IMP_OUT, JSON.stringify(out));
  });
}
`);
const res={};
for (const [ver,bin] of [['old','omp'],['new',B+'/omp']]) {
  const A=`${B}/agent-${ver}-nowa`;
  await sh(`rm -rf ${A} && cp -R ${B}/agent-${ver}-full ${A}`);
  await write(A+'/extensions/rqw-system-core.js', noWa);
  const out=`${B}/cap-${ver}-nowa.json`;
  try { await sh(`cd ${B}/proj && PI_CODING_AGENT_DIR=${A} CAP_OUT=${out} IMP_OUT=${B}/imp-${ver}.json ANTHROPIC_API_KEY=sk-ant-fake ${bin} -p --no-session -e ${B}/imp.js -e ${B}/cap.js --model anthropic/claude-sonnet-5-5 "say ok" 2>&1 | tail -c 800`,{timeout:180}); } catch(e){ res[ver]='ERR '+e.message; }
}
const L=n=>Bun.file(`${B}/${n}`).text();
for (const v of ['old','new']) {
  const full=JSON.parse(await L(`cap-${v}-full.json`)), nowa=JSON.parse(await L(`cap-${v}-nowa.json`));
  print(v,'messages equal with/without workaround:', JSON.stringify(full.messages)===JSON.stringify(nowa.messages), 'system equal:', JSON.stringify(full.system)===JSON.stringify(nowa.system));
  const imp=JSON.parse(await L(`imp-${v}.json`)); const models=imp.models; delete imp.models; print(v, imp, Array.isArray(models)?models.length+' models':models);
  await write(`${B}/models-${v}.json`, JSON.stringify(models));
}
print(res)
```

Результат 18.20.2: все импорты `function`/`object`/`symbol`, ошибок нет. Старый бинарь: `messages equal with/without workaround: false`. Новый: `true` (обход мёртв). Моделей 5723 в старом, 6003 в новом.

## 5. провайдеры (фаза B)

Сначала сверь каталог моделей харнеса. Скрипт читает `models-old.json` и `models-new.json`, записанные скриптом импортов.

```js
const B='/tmp/omp-up', L='/Users/arkadijcukavin/ai-project/omp-lite';
const cfg=Bun.YAML.parse(await Bun.file(L+'/src/modules/rqw-runtime-config/config.yml').text());
const mo=JSON.parse(await Bun.file(B+'/models-old.json').text()), mn=JSON.parse(await Bun.file(B+'/models-new.json').text());
const prov=l=>new Set(l.map(m=>m.split('/')[0]));
const po=prov(mo), pn=prov(mn), dis=new Set(cfg.disabledProviders);
print('old providers', po.size, 'new', pn.size, 'disabled', dis.size);
print('new-only providers', [...pn].filter(p=>!po.has(p)));
print('old-only providers', [...po].filter(p=>!pn.has(p)));
print('open in new (not disabled)', [...pn].filter(p=>!dis.has(p)));
print('open in old (not disabled)', [...po].filter(p=>!dis.has(p)));
print('disabled not in new catalog', [...dis].filter(p=>!pn.has(p)));
const has=new Set(mn), hasO=new Set(mo);
const need=[...cfg.enabledModels, ...Object.keys(cfg.compaction.modelThresholds)];
print('enabled/threshold ids missing in new:', need.filter(id=>!has.has(id)), 'missing in old:', need.filter(id=>!hasO.has(id)));
print('perCall missing new:', cfg.modelRoles.perCall.split(', ').filter(id=>!has.has(id)));
print('roles', Object.entries(cfg.modelRoles).filter(([k])=>k!=='perCall'));
```

Результат 18.20.2: открытыми в новой версии оказались `antigravity-cli` и `chutes` сверх четырёх наших. `openai-codex/gpt-6.1-terra` отсутствовал в списке моделей и в старой, и в новой версии (разницы нет). Полный список идентификаторов даёт второй скрипт: он сверяет `provider-ids.ts` двух тегов и `disabledProviders`.

```js
const R='/Users/arkadijcukavin/ai-project/omp-src', L='/Users/arkadijcukavin/ai-project/omp-lite';
const ids=async t=>{const s=await sh(`cd ${R} && git show ${t}:packages/catalog/src/compat/provider-ids.ts`); return [...s.matchAll(/\|\s*"([^"]+)"/g)].map(m=>m[1]);};
const o=new Set(await ids('v<old>')), n=new Set(await ids('v<new>'));
const cfg=Bun.YAML.parse(await Bun.file(L+'/src/modules/rqw-runtime-config/config.yml').text()); const dis=new Set(cfg.disabledProviders);
const open=['anthropic','openai-codex','opencode-go','openrouter'];
print('old ids', o.size, 'new ids', n.size);
print('old ids not disabled & not open:', [...o].filter(p=>!dis.has(p)&&!open.includes(p)));
print('disabled not in old ids:', [...dis].filter(p=>!o.has(p)));
print('new-only ids:', [...n].filter(p=>!o.has(p)));
print('old-only ids:', [...o].filter(p=>!n.has(p)));
print(await sh(`cd ${R} && git show v<new>:packages/catalog/src/compat/provider-ids.ts | head -12`));
```

Результат 18.20.2: ids 92 → 96, новые `antigravity-cli`, `chutes`, `liquid`, `nace`. Закрыть их все в `disabledProviders` (было 90, стало 94).

Результат 18.21.0: ids 96 → 97, новый `modal` (закрыт, стало 94 закрытых; открыты `anthropic`, `openai-codex`, `opencode-go`, `openrouter`, `antigravity-cli`).

## 6. метки обрезки в наших текстах (фаза B)

Наши тексты `read`, `bash`, `grep`, `glob` ссылаются на метки обрезки OMP. Скрипт считает совпадения шаблонов в старом и новом теге.

```js
const R='/Users/arkadijcukavin/ai-project/omp-src';
const probes={
 'bash middle elided':'middle lines elided',
 'bash Read artifact':'for full output',
 'read Showing lines':'Showing lines',
 'read Use :N to continue':'to continue]',
 'read KB limit':'KB limit',
 'read elided summary':'re-read needed ranges',
 'read 3000 lines':'3000',
 'read web 300 lines':'MAX_URL_LINES|300 lines',
 'dir listing cap 12':'more\\b|… \\$\\{',
 'grep Showing files':'Showing files',
 'grep More than N matches':'More than \\$\\{',
 'grep truncated 512':'truncated to',
 'grep 2000 matches':'2000',
 'glob 200 limit':'results limit reached',
 'glob timeout 5s':'5000|5_000',
};
const where='packages/coding-agent/src/tools packages/coding-agent/src/session packages/coding-agent/src/edit packages/utils/src packages/natives/native';
for (const [n,p] of Object.entries(probes)) {
  const c=async t=>(await sh(`cd ${R} && git grep -c -E ${JSON.stringify(p)} ${t} -- ${where} | awk -F: '{s+=$NF} END {print s+0}'`)).trim();
  print(n.padEnd(26), 'old', await c('v<old>'), 'new', await c('v<new>'));
}
print(await sh(`cd ${R} && git grep -n -E 'middle lines elided|for full output' v<old> -- packages | grep -v test | grep -v CHANGELOG | head -5; echo ===; git grep -n -E 'elided|for full output' v<new> -- packages/coding-agent/src/tools/output-meta.ts packages/coding-agent/src/session/streaming-output.ts packages/coding-agent/src/tools/bash.ts | head -10`));
```

Затем проверь, менялись ли файлы меток: `git diff --stat v<old> v<new> -- packages/tui/src/tools/output-meta.ts packages/coding-agent/src/tools/output-meta.ts packages/coding-agent/src/session/streaming-output.ts packages/coding-agent/src/exec/bash-executor.ts`. В 18.20.2 `output-meta.ts` не менялся, числа в наших текстах те же.

## 7. снимок на файлах ветки (фаза D)

После правок и зелёных тестов проведи на проводе файлы ветки. В 18.20.2 это сделал сабагент `WireSnapshot` (`openai-codex/gpt-6.1-terra:high`), результат 7 из 7. Задание дословно (папка и бинарь из пунктов 1-2; сравнение с `cap-old-full.json` из пункта 2):

````
# Target
Prove on the wire that the branch files work on OMP 18.20.2. Read-only for the worktree. Write only under `/tmp/omp-up/` (new names only; do not overwrite existing `cap-old-*.json`, `cap-new-*.json`, `cap.js`, `omp`, `ROADMAP.md`).

Known pieces:
- `/tmp/omp-up/omp`: OMP 18.20.2 binary. `/tmp/omp-up/proj`: empty git dir to run in.
- `/tmp/omp-up/cap.js`: extension; on `before_provider_request` it writes the final payload JSON to `$CAP_OUT` and exits the process before anything is sent.
- `/tmp/omp-up/cap-old-full.json`: baseline payload of OMP 18.18.8 with the current (old) harness.

# Change
1. Build agent dir `A=/tmp/omp-up/agent-branch` from the worktree: for every `files` entry of `install.manifest.json` copy `<worktree>/<from>` to `$A/<to>`. Build `$A/config.yml` by merging the four `config` fragments of the manifest (dicts merge by key, lists taken whole; keys do not overlap), then set `modelRoles.default` to the value in `~/.omp/agent/config.yml`. Do NOT copy `agent.db`, `models.yml` or any credential.
2. Full run: `cd /tmp/omp-up/proj && PI_CODING_AGENT_DIR=$A CAP_OUT=/tmp/omp-up/cap-branch-full.json ANTHROPIC_API_KEY=sk-ant-fake /tmp/omp-up/omp -p --no-session -e /tmp/omp-up/cap.js --model anthropic/claude-sonnet-5-5 "say ok"`.
3. Native run: same with `--no-extensions` and `CAP_OUT=/tmp/omp-up/cap-branch-native.json`.
4. Checks (payload `tools[].name` / `.description` / `.input_schema.properties`; strip a leading `_` from names):
   a. `task`: contains "Omit `agent` by default: a general worker equal to you." exactly once; contains the line "Do not spawn sub-agents unless" exactly once; contains neither "Read-only research MUST" nor "most specific".
   b. `eval`: contains neither "xd://eval/agents" nor the text "workpool()"; contains "Use JavaScript (Bun) by default" and "my setup.js"; report whether it lists `commit` ("xd://eval/commit").
   c. guard: for each tool in `<worktree>/src/modules/rqw-base-tools/rqw-base-tools.reference.json` `.tools`, the native description from the native run, with the line matching `/^In-process builtins, ahead of PATH: .*$/m` removed, equals the reference description with that line removed; and the sorted property names equal `fields` (for `edit` the pair `i,input` also counts as equal).
   d. `messages` of the full run deep-equal `messages` of `cap-old-full.json`.
   e. the set of tool names of the full run equals that of `cap-old-full.json`.
   f. the final `bash` description equals our bash text from `rqw-base-tools.texts.json` (pick the variant WITH `files`, index 0 of each pair) followed by the native bash text from "Persistent bash" on.
   g. report whether the system prompt contains the commit guidance sentence starting "To commit your changes, use the eval `commit` namespace".

# Acceptance
A table of checks a-g with PASS/FAIL and the evidence (counts, short quotes). For any FAIL show the exact differing text. Do not edit the worktree.
````

Контракт сабагента (общий для заданий этой фазы): не править ничего, кроме названного; не коммитить; не трогать `~/.omp/agent`; не запускать `omp update`; к провайдерам моделей не ходить; новых зависимостей нет; сторож `eval` блокирует `agent(` и `workpool(`.

Результат 18.20.2: a-g PASS. `task`: строка «Omit `agent` by default» один раз, «Do not spawn sub-agents unless» один раз, родных фраз нет. `eval`: без `xd://eval/agents` и `workpool()`, `xd://eval/commit` один раз. Сторож: шесть тулов равны эталону. `messages` равны (по одному сообщению). Имён тулов по 13. `bash` равен нашему тексту плюс родной хвост с `Persistent bash`. Совет «To commit your changes...» в системном промпте есть (`commit` включён).

Условия a-g записаны как они стояли в 18.20.2. Родные фразы, которые правка режет (`Read-only research MUST`, `most specific`, `xd://eval/agents`, `workpool()`), в другой версии могут стоять иначе. Держи смысл условий: наша строка ровно один раз, родная строка не вернулась.
