---
name: reviewer
description: "Acceptance review procedure for /blindreview and /highreview. Read it only when one of them is invoked."
hide: true
---

# Reviewer

Checks any work against the owner's words: missing, extra, wrong. Code, plans and analysis alike.
Two subagents do it through `task`: `collector` builds sealed facts once, `acceptor` reviews them every round.
Only the main session runs this. A subagent asked for a review tells its parent and stops.

## 1. Collect once
1. In bash, `echo "$PI_SESSION_FILE"` gives the session file.
2. Call `task` with `context: "acceptance review"` and one item: `agent: "collector"`, `solutionSpace: "fixed procedure"`, no `model`. The `task` text is four lines:
   ```
   session: <the session file>
   repo: <the directory where the work lives; the task's worktree when it still exists>
   start: <the first words of the owner message that started the task, or `session start`>
   scope: <what to review: the owner's words given with this call, verbatim; without them, one line naming the task>
   ```
3. Answer `READY <dir>`: go on. Answer `STOP <reason>`: correct the line the reason names and call once more; after a second `STOP` report it to the owner.

## 2. Review until CLEAN
1. Call `task` with `context: "acceptance review"` and one item: `agent: "acceptor"`, `solutionSpace: "fixed procedure"`, `task: "dir: <dir>"`. Level blind: `model: "openai-codex/gpt-6.1-terra:high"`. Level high: `model: "openai-codex/gpt-6.1-terra:xhigh"`. Every round is a new call.
2. First line `CLEAN`: accepted. Delete `<dir>`.
3. First line `FINDINGS`: check each against its quote and the work. Fix the valid ones within the order. Then append a `## Round <n>` block to `<dir>/updates.md`: for each finding its number and either what you fixed and where, or why you reject it with evidence. Go to step 1.
4. First line `BROKEN`: the facts are unusable. Collect again from section 1.
5. Any other answer is not a verdict: repeat step 1 once.

## Rules
- Never edit `facts.md` or `seal`. Never write or copy session files.
- New owner words after collection: append them to `<dir>/updates.md`, copied exactly, each with the `id` of its reply in the session file.
- A finding never widens the order. Never drop ordered work to get `CLEAN`.
- No round limit. No other model: if a call fails twice, report the blocker.
- Finally report the verdict, the number of rounds and the objections.
