# task-delegation

Расширение OMP. Дописывает строку Codex про саб-агентов в описание тула `task` при сборке запроса.

**Почему костыль:** штатной настройки текста описания встроенного тула нет. Настройка `tasks.delegationBias: gated` пишет свой запрет в блок `# Delegation` системного промпта. Наш `SYSTEM.md` этот блок заменяет целиком, и настройка до модели не доходит. Способ взят у [memory-tool-prompts](../memory-tool-prompts/index.js): хук `before_provider_request` из `omp://extensions.md` правит описания в готовом запросе.

**Вход:** `~/.omp/agent/extensions/task-delegation.js`.

**Строка:** `Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.` Взята дословно из Codex CLI, описание тула `spawn_agent`.

**Наблюдаемое поведение:** строка встаёт под первой строкой описания `task`. Повторный вызов её не дублирует. Правятся только записи в массивах `tools`: списки агентов и прочие записи с именем `task` не трогаются.

**Границы:** если OMP переименует тул `task`, правки не будет и ошибки тоже. Строка живёт в описании тула, а не в системном промпте. Постоянной отметки о состоянии нет.

**Установка:** файл перечислен в [манифесте](../../../install.manifest.json); процедура — [INSTALL.md](../../../INSTALL.md).

**Выключить:** удалить файл.

**Тесты:** `bun test dev/tests/harness/task-delegation`.
