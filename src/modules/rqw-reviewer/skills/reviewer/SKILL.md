---
name: reviewer
description: "Acceptance review procedure for /blindreview and /highreview. Read it only when one of them is invoked."
hide: true
---

# Reviewer

Checks any work against the owner's words: missing, extra, wrong. Code, plans and analysis alike.
Two subagents do it through `task`: `collector` builds sealed facts once, `acceptor` reviews them every round.
Any session that has the `task` tool runs this: the main session, or a subagent told to run a review. A subagent without `task` tells its parent and stops.
In a subagent the owner is reached through the parent: what this skill writes or reports to the owner goes to the parent, and the final report is your last message.

## 1. Before collection
1. Look at your work yourself. Remove what was not ordered. Do what was ordered and is not done. Keep what the repository rules require.
2. A part that was not ordered, but without which the task dies: keep it. Write to the owner about it only when the reviewer calls it `extra` (section 4, step 6).

## 2. Collect once
1. In bash, `echo "$PI_SESSION_FILE"` gives the session file. In a subagent it gives your own file, `<main session without .jsonl>/<your id>.jsonl`: the session for the collector is the main one, the `.jsonl` file named like that folder.
2. Call `task` with `context: "acceptance review"` and one item: `agent: "collector"`, `solutionSpace: "fixed procedure"`, no `model`. The `task` text is four lines:
   ```
   session: <the session file>
   repo: <the directory where the work lives; the task's worktree when it still exists>
   start: <the first words of the owner message that started the task, or `session start`>
   scope: <what to review: the owner's words given with this call, verbatim; without them, one line naming the task>
   ```
   A subagent that does not know the owner's first words writes `start: subagent <its id>` and begins `scope` with `the work of subagent <its id>:`.
3. Answer `READY <dir>`: go on. Answer `STOP <reason>`: correct the line the reason names and call once more; after a second `STOP` report it to the owner.
4. Collect again only in two cases: the case of step 5, and the reviewer's answer `BROKEN`.
5. After the seal the owner ordered something new or changed the scope: do the work and collect again. The count of clean rounds starts from zero.
   Other new owner words after collection: append them to `<dir>/updates.md`, copied exactly, each with the `id` of its reply in the session file. The owner's answer about a critical part goes there too.

## 3. Review rounds
1. Call `task` with `context: "acceptance review"` and one item: `agent: "acceptor"`, `solutionSpace: "fixed procedure"`, `task: "dir: <dir>"`, `model: "openai-codex/gpt-6.1-terra:xhigh"`. The model is the same at level blind and at level high. Every round is a new call: one fresh reviewer and a full check.
2. After every answer, check that it is complete: every row number of `facts.md` (`R1`, `R4.1`, `L1`, `W1`) and of `updates.md` (`J1`) starts a line of the answer. Check it by any means you have.
3. A row number has no line: the answer is not a verdict. Repeat the round once. Incomplete again: stop and report to the owner.
4. First line `BROKEN`: collect again from section 2, once. `BROKEN` again: stop and report to the owner.
5. First line `FINDINGS`: work through section 4. The round is clean by section 5, step 1: go to section 5. It is not clean: go to step 1.
6. First line `CLEAN`: write its notes to the journal (section 4, steps 7 and 8), then go to section 5.

## 4. Findings
1. Before you fix anything, open the place in the work yourself. The finding is right and it is about the order: fix it.
2. The finding is wrong or not about the order: write one objection to `updates.md`. Copy the finding text word for word and add your argument. An argument is a place in the work (file and line), owner words with their `id`, or a sign that the finding is not a finding: a "what if" scenario, a request to add what the owner did not name, the truth about the outside world, a method or a style the owner did not name, a step after the review, the repository rules. The finding is about an action that is done and cannot be undone: object with that fact. An objection settles the finding: its status is `settled`.
3. A reviewer raised a `settled` finding again, at the same place with the same problem: do not open it and do not fix it.
4. A fix is the smallest one. First remove, then change. Add only what the owner named. Do nothing for the reviewer.
   A `missing` finding that is right: fix the whole row, every thing its quote names, not only the one the finding names.
   Then check the other rows of the same source (the same list, table or section) for the same kind of gap and fix them the same way, before the next round.
5. Append a `## Round <n>` block to `<dir>/updates.md`: for each finding its number and either what you fixed and where, or your objection. A fix touched a file outside `Work`: append the row `J1 <path>` to `updates.md`. The next such file is `J2`.
6. The reviewer called `extra` a part you think is critical: the owner decides. Write to him what dies without this part. His answer goes to `updates.md` with its `id`. Ask the owner nothing else during the review.
7. A `note`: open its place in the work yourself. It is in fact serious (an ordered item is not in the work, the work is against the owner's words or his limit, a part no requirement orders): fix it by steps 1 and 4. The work changed: the count of clean rounds starts from zero. It is not serious: do not fix it and do not object. You may only raise a level. Never lower a `serious` finding: object by step 2.
8. After every round, append to `## Journal` at the end of `<dir>/updates.md` one line for each finding of the round: `<round>.<n> <level> <kind> <row> <place>: fixed | settled | note`. Steps 1-6 are for `serious` findings.

## 5. Accepted
1. A round is clean when its first line is `CLEAN`. It is also clean when every serious finding of it is a `settled` finding raised again (section 4, step 3).
2. Two clean rounds in a row, the work did not change between them, the reviewers were different and fresh, and both answers were complete: accepted. Delete `<dir>`.
3. Only one clean round so far: go to section 3, step 1.
4. `BROKEN` and a round that is not clean reset the count of clean rounds to zero. A crashed or incomplete answer does not change the count: repeat it.

## 6. Stop
1. The reviewer crashed or answered in another form: this is not a verdict. Repeat the round once. The same again: stop and report to the owner.
2. There is no round limit. The cycle runs until two clean rounds in a row.
3. One call of this skill is one review. After acceptance, do not start a new review yourself.
4. Do not bring the reviewer's doubts to the owner as questions.
5. Report once, at the end: the verdict, the coverage numbers, the count by requirements, the number of rounds, the settled findings and the notes, one line each.
   Coverage numbers: requirement rows checked and files checked. Give each twice, for the two clean rounds.

## Rules
- Never edit `facts.md` or `seal`. Never write or copy session files.
- A finding never widens the order. Never drop ordered work to get `CLEAN`.
- No other model.
