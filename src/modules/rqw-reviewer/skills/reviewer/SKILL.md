---
name: reviewer
description: "Acceptance review procedure for /blindreview and /highreview. Read it only when one of them is invoked."
hide: true
---

# Reviewer

Checks any work against the owner's words: missing, extra, wrong. Code, plans and analysis alike.
You hand your work over yourself. A fresh `acceptor` subagent reviews it through `task`, every round.
A session without the `task` tool tells its parent and stops. In a subagent the owner is reached through the parent.

## 1. Before the handoff
1. Look at your work yourself. Remove what was not ordered. Do what was ordered and is not done. Keep what the repository rules require.
2. A part that was not ordered, but without which the task dies: keep it. Write to the owner about it only when the reviewer calls it `extra`.

## 2. Handoff
The handoff is the `task` text for the reviewer. The reviewer sees nothing else of this conversation.
Copy the owner's words, never retell them. A requirement you leave out is lost: the reviewer cannot find it.
After a compaction your context holds a summary, not the owner's words. Read the earlier owner messages from the session file first. Never copy owner words from a summary.
Fill this form: every section, in this order, nothing else.
```
session: <the session file: `echo "$PI_SESSION_FILE"` in bash; a system without such a file: `none`>
repo: <the directory where the work lives>
base: <the commit the task started from; no git: `none`>
scope: <what to review: the owner's words given with this call, verbatim>

## Owner words
<Every owner message of the task, oldest first, whole and word for word, each after a line `[<n>]`.>
<All of them: the order, corrections, answers to your questions, approvals, words given with a skill or a goal command.>
<Before an answer or an approval, one line: `to: "<your question or proposal, copied>"`.>
<A document the owner named as the order (a plan, a spec, an attached file): a line `document: <path>`. It is not on disk as the owner gave it: copy its text under that line instead.>
<An owner message of the same period about another task: `[<n>] other task: <its first words>`.>
<Not owner words: your own text, the body of a skill, a summary, a tool result.>

## Cancelled and deferred
<`[<n>] cancels [<m>]: "<the cancelled words>"`, `[<n>] defers: "<the words>"`, or `none`.>

## Work
<One line for each file the task changed, created or deleted.>
<One line for each result that is not a file: `chat: <what was answered>`, `ran: <command>: "<its output>"`.>
<`Outside: <path>` for a file changed in this repo for another task.>

## Claims
<One line for each thing the owner ordered: what you say is done, and where. The reviewer does not trust this section.>
```

## 3. Review rounds
1. Call `task` with `context: "acceptance review"` and one item: `agent: "acceptor"`, `solutionSpace: "fixed procedure"`, `model: "openai-codex/gpt-6.2-sol:low"`, `task`: the handoff. Every round is a new call: one fresh reviewer and a full check.
2. First line `BROKEN`: correct the handoff where the line says and call again, once. `BROKEN` again: stop and report to the owner.
3. Check that the answer is complete before you use it: a row line for every thing the owner ordered or forbade, and a part line for every file of `Work`. A crashed answer, an answer in another form or an incomplete answer is not a verdict: repeat the round once, then stop and report to the owner.
4. First line `FINDINGS`: work through section 4, then go to step 1.
5. First line `CLEAN`: go to section 5.
6. The owner said something new about the task: add it to `Owner words` before the next round.

## 4. Findings
1. Before you fix anything, open the place in the work yourself. The finding is right and it is about the order: fix it. A fix is the smallest one: first remove, then change, add only what the owner named.
2. The finding is wrong or not about the order: object. An argument is a place in the work, owner words, or a sign that the finding is not a finding: a "what if" scenario, a request to add what the owner did not name, a method or a style the owner did not name, a step after the review, the repository rules.
3. Append to the handoff a block `## Round <n>`: for each finding its text, then `fixed: <where>` or `settled: <your objection>`. Update `Work` when a fix touched a new file.
4. A reviewer raised a `settled` finding again, at the same place with the same problem: do not open it and do not fix it.
5. The reviewer called `extra` a part you think is critical: the owner decides. Ask the owner nothing else during the review.

## 5. Accepted
1. A round is clean when its first line is `CLEAN`, or when every serious finding of it is a `settled` finding raised again.
2. Two clean rounds in a row, with no change of the work between them: accepted.
3. A round that is not clean resets the count.
4. Report once, at the end: the verdict, the number of rounds, the settled findings and the notes, one line each.

## Rules
- A finding never widens the order. Never drop ordered work to get `CLEAN`.
- No other model.
