---
name: reviewer
description: "Acceptance review procedure for /blindreview and /highreview. Read it only when one of them is invoked."
---

# Reviewer

Checks any work against the owner's words: missing, extra, wrong. Code, plans and analysis alike.

Model: `openai-codex/gpt-6.1-terra` only. Level blind runs the reviewer with `high`, level high with `xhigh`. No fallback model: if a run fails twice, report the blocker.

## 1. Collect once
1. In bash, `realpath skill://reviewer` gives `R`. Create a new directory `local://review-<n>`; `realpath` of it gives `D`.
2. In bash from the work directory, timeout 3600:
   `omp -p --model openai-codex/gpt-6.1-terra --thinking xhigh --config "R/collector.yml" @"R/collector.md" "script: R/index.js; dir: D; session: $PI_SESSION_FILE; repo: $PWD"`
3. The answer must be `READY D`. Otherwise report it and stop.

## 2. Review until CLEAN
1. In eval, JavaScript: `(await import(Bun.pathToFileURL("R/index.js").href)).check("D")`. A non-empty list means the facts changed: report it and stop.
2. In bash, timeout 3600:
   `omp -p --model openai-codex/gpt-6.1-terra --thinking <high|xhigh> --config "R/reviewer.yml" @"R/reviewer.md" "dir: D"`
3. First line `CLEAN`: accepted.
4. First line `FINDINGS`: check each against its quote and the work. Fix the valid ones within the order. For each rejected one, append its number, reason and evidence to `D/objections.md`. Go to step 1. No round limit.
5. Any other answer is not a verdict: rerun step 2 once.

## Rules
- Never edit `slice.md`, `facts.md` or `sha256`, never freeze again.
- New owner words after collection: collect again into a new directory.
- A finding never widens the order. Never drop ordered work to get `CLEAN`.
- Finally report the verdict, the number of rounds and the objections.
