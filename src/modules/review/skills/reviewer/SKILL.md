---
name: reviewer
description: "Acceptance review procedure for /blindreview and /highreview. Read it only when one of them is invoked."
hide: true
---

# Reviewer

Checks any work against the owner's words: missing, extra, wrong. Code, plans and analysis alike.
Two subagents do it through `task`: `collector` builds sealed facts once, `acceptor` reviews them every round.
Only the main session runs this. A subagent asked for a review tells its parent and stops.

## 1. Before collection
1. Look at your work yourself. Remove what was not ordered. Do what was ordered and is not done. Keep what the repository rules require.
2. A part that was not ordered, but without which the task dies: keep it. Write to the owner about it only when the reviewer calls it `extra` (section 4, step 6).

## 2. Collect once
1. In bash, `echo "$PI_SESSION_FILE"` gives the session file.
2. Call `task` with `context: "acceptance review"` and one item: `agent: "collector"`, `solutionSpace: "fixed procedure"`, no `model`. The `task` text is four lines:
   ```
   session: <the session file>
   repo: <the directory where the work lives; the task's worktree when it still exists>
   start: <the first words of the owner message that started the task, or `session start`>
   scope: <what to review: the owner's words given with this call, verbatim; without them, one line naming the task>
   ```
3. Answer `READY <dir>`: go on. Answer `STOP <reason>`: correct the line the reason names and call once more; after a second `STOP` report it to the owner.
4. Collect again only in two cases: the case of step 5, and the reviewer's answer `BROKEN`.
5. After the seal the owner ordered something new or changed the scope: do the work and collect again. The count of clean rounds starts from zero.
   Other new owner words after collection: append them to `<dir>/updates.md`, copied exactly, each with the `id` of its reply in the session file. The owner's answer about a critical part goes there too.

## 3. Review rounds
1. Call `task` with `context: "acceptance review"` and one item: `agent: "acceptor"`, `name: "AcceptorRound<n>"`, `solutionSpace: "fixed procedure"`, `task: "dir: <dir>"`, `model: "openai-codex/gpt-6.1-terra:xhigh"`. The model is the same at level blind and at level high. Every round is a new call: one fresh reviewer and a full check. Every call gets a new `name`: `AcceptorRound1`, `AcceptorRound2`, and so on.
2. After every answer, run the completeness check in eval, JavaScript, with your `dir` and the agent id from the call's result as `name` in the first line. A name already used in the session gets a suffix there: `AcceptorRound1-2`.
   ```js
   const dir = "<dir>", name = "<name>", fs = require("node:fs");
   const ids = (file, re) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").match(re) ?? [] : []);
   const rows = [...new Set([...ids(dir + "/facts.md", /^(?:[RL]\d+(?:\.\d+)?(?=\. )|W\d+(?= ))/gm), ...ids(dir + "/updates.md", /^J\d+(?= )/gm)])];
   const answer = await output(name);
   return rows.filter((id) => !new RegExp("^" + id.replace(".", "\\.") + "(?!\\d|\\.\\d)", "m").test(answer));
   ```
   It returns the row numbers of `facts.md` and `updates.md` that do not start a line of the answer. Every row number must be in the answer.
3. The check returns a number: the answer is not a verdict. Repeat the round once. Incomplete again: stop and report to the owner.
4. First line `BROKEN`: collect again from section 2, once. `BROKEN` again: stop and report to the owner.
5. First line `FINDINGS`: work through section 4. Then go to step 1.
6. First line `CLEAN`: go to section 5.

## 4. Findings
1. Before you fix anything, open the place in the work yourself. The finding is right and it is about the order: fix it.
2. The finding is wrong or not about the order: write one objection to `updates.md`. Copy the finding text word for word and add your argument. An argument is a place in the work (file and line), owner words with their `id`, or a sign that the finding is not a finding: a "what if" scenario, a request to add what the owner did not name, the truth about the outside world, a method or a style the owner did not name, a step after the review, the repository rules. The finding calls `extra` an action that is done and cannot be undone: object with that fact.
3. Any later reviewer raised it again: fix it with the smallest change, even if you disagree. There is no second objection. One exception: the critical part of step 6.
4. A fix is the smallest one. First remove, then change. Add only what the owner named. Do nothing for the reviewer, except the fix of a finding raised again.
5. Append a `## Round <n>` block to `<dir>/updates.md`: for each finding its number and either what you fixed and where, or your objection. A fix touched a file outside `Work`: append the row `J1 <path>` to `updates.md`. The next such file is `J2`.
6. The reviewer called `extra` a part you think is critical: the owner decides. Write to him what dies without this part. His answer goes to `updates.md` with its `id`. Ask the owner nothing else during the review.

## 5. Accepted
1. Two rounds in a row gave `CLEAN`, the work did not change between them, the reviewers were different and fresh, and both answers were complete: accepted. Delete `<dir>`.
2. Only one `CLEAN` so far: go to section 3, step 1.
3. `FINDINGS` and `BROKEN` reset the count of clean rounds to zero. A crashed or incomplete answer does not change the count: repeat it.

## 6. Stop
1. The reviewer crashed or answered in another form: this is not a verdict. Repeat the round once. The same again: stop and report to the owner.
2. There is no round limit. The cycle runs until two clean rounds in a row.
3. One call of this skill is one review. After acceptance, do not start a new review yourself.
4. Do not bring the reviewer's doubts to the owner as questions.
5. Report once, at the end: the verdict, the coverage numbers, the count by requirements, the number of rounds, and the objections, one line each.
   Coverage numbers: requirement rows checked and files checked. Give each twice, for the two clean rounds.

## Rules
- Never edit `facts.md` or `seal`. Never write or copy session files.
- A finding never widens the order. Never drop ordered work to get `CLEAN`.
- No other model.
