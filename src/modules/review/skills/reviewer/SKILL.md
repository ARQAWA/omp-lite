---
name: reviewer
description: "Review procedure for blind and high reviews through ordinary agents; only when requested or required by the caller, project instructions or an invoked skill."
---

# Reviewer

Blind review by a separate read-only model that works with you as one team for the user's agreement: it checks the requested criterion, including checks beyond the agreement and exclusions, and gets the user's own messages verbatim. Use it when the user asks for a review or a checked result: `/skill:blindreview` and `/skill:highreview` ask for these levels, and a skill he calls may run it as its procedure. Launch a reviewer when the user, the caller's brief, an invoked skill or applicable project instructions require it. Without such a request or requirement, never launch one on your own initiative or as an automatic step of other work. Leave the reviewed files unchanged until the verdict returns. When the task authorizes changes and the object is your own finished work and plan mode is off, start the review through the selfcheck skill at `skill://selfcheck/SKILL.md` at the requested level: a fork of you checks and fixes the work first, then runs this loop. The selfcheck fork itself, a review-only task, plan mode and work you did not do enter this loop directly.

- Level: blind by default; high when the user asks for it. The level picks the agent: blind `spotty` (`deepseek/deepseek-flash:low`), high `bossy` (`deepseek/deepseek-flash:high`). Launch a fresh child for the initial review and for each changed-object pass with one `task` call in batch shape: `context` is a one-line shared background; `tasks` is one item `{name: "Spotty"|"Bossy", agent: "spotty"|"bossy", task: <the brief below>, solutionSpace: "review scope fixed by the brief; findings and severity open"}`. `spotty` and `bossy` are blocking, so the verdict returns in the same call. The reviewer reads `skill://reviewer/REVIEWER.md` itself. Use absolute paths in the brief when the work runs outside the reviewer's cwd. In the object template, name the reviewed work's applicable project instructions and process rules under requirements and rules, with sources for compliance at each in-scope step due by the stated stage, or the exact evidence that is unavailable. If the result is a preview, read the full verdict from `agent://<id>` before acting. There is no standalone review tool or fallback; if the agent, its role skill or the `task` tool is unavailable, report that the reviewer cannot run.
- Brief: the task item is this one template, sections in this order. OMP subagents do not inherit the conversation: copy the user's messages verbatim under `<user_messages>` with their sources, and put the decisions and requirements they establish in `<agreement>` and `<criterion>`. Never summarize the messages or write "as discussed". If a message is unavailable after compaction, mark that gap instead of inventing it. Supply primary requirement and governing-rule sources, not only Main's summary; each reviewer reads them independently, including any required user-facing explanation rules. `<agreement>` holds only decisions the user himself accepted, verbatim, each with its source; Main's or another agent's approval is not agreement. `<criterion>` says what this check confirms and which deliverable must fulfill each obligation; an exclusion cannot silently waive a governing requirement of this pass, and it stays unchanged for the whole loop.
  ```text
  <agreement>
  none
    or one item per decision:
  - «the user's words verbatim» - source: <path>:<record>
    answers: «the question or proposal verbatim» - source: <path>:<record>
  </agreement>
  <object>
  stage: pre-action | pre-completion
  pass: initial | changed-object
  paths: <absolute paths>
  requirements and rules: <absolute paths or anchors>
  diff: <absolute path> | none   (a file outside git: diff -u against a saved copy)
  </object>
  <criterion>
  <what this check confirms>
  </criterion>
  <rejected_earlier>
  none | <finding>: <reason with quote>
  </rejected_earlier>
  ```
- Do not impose file, search, tool-call or turn quotas on a reviewer. Read-only inspection may take as many calls as the in-scope check needs; large or truncated sources are read in complete parts.
- The executor fixes format slips itself without a new pass; this does not replace missing material evidence.
- The verdict comes as the reviewer's returned task output:
  - `CLEAN` with concise concrete `CHECKED:` evidence and no `UNCHECKED:`: this pass passed. Evidence names what was inspected and the exact files, sections or source anchors that establish it; it is not a long per-obligation checklist. Run no extra pass for confidence, but preserve every independent pass required by the invoking procedure.
  - `FINDINGS: N` (the first line; N is the count of findings): your teammate's findings. For a review-only task, report the verified findings without changes; the correction loop below applies only when the task authorizes changes. Find each quote by searching for it. Matching quotes are necessary, not sufficient: admit a finding only through the role's severity gate, with a concrete trigger and wrong outcome in the ordered result. Admit P3 only in a pass with an admitted P0-P2 finding, and fix them together; a P3-only pass counts as CLEAN, with its P3 dropped and not mentioned. For an omission, verify the quoted requirement and the complete inspected file/section instead of demanding nonexistent text: fix it exactly to its REQUIRED OUTCOME and no further; do not reject it, argue with it or put it to the user. Reject a finding when it fails the role's severity gate, a quote is not verbatim, the allegedly missing content is present in the cited object, or a NOT AGREED element is covered by a verbatim quote of the agreement or an applicable governing rule, is a check the criterion requires, or is only the agreed element's own implementation, a test or a reference fix the agreed change needs, and give that reason with the quote. Fix all admitted findings in one batch, then launch a fresh reviewer at the same level and criterion with the fixes, changed lines, affected paths and every rejection so far in `<rejected_earlier>`. A changed-object pass checks those fixes, lines and paths, not the whole object again. Stop when no admitted finding remains and the required evidence is complete.
  - `UNCHECKED:`, missing required `CHECKED:` evidence, a bare `CLEAN`, or malformed evidence: the check is incomplete regardless of its leading verdict. Re-run the same level once with a fresh reviewer, quote the malformed verdict in `<rejected_earlier>` and name the exact missing evidence; a second malformed pass is blocked. Never record an incomplete result as acceptance.
  - No verdict, a provider error or a reviewer that could not start: the check has not passed, and no self-check replaces it. Retry the unchanged failed review once under this bounded failure rule; if it fails again, tell the user and wait. A fresh reviewer is otherwise for a changed object or admitted findings requiring a new pass, never for confidence.

When changing this review contract, validate it against known defective, corrected and missing-source examples before claiming improved detection. These checks are not extra rounds in ordinary task reviews.
