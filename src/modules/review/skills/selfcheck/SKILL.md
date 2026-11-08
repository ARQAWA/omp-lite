---
name: selfcheck
description: "Self-check and review loop run by a fork of the finished executor; only when requested or required by the caller, project instructions or an invoked skill."
---

# Selfcheck

The executor finishes the work, then a fork of itself checks, fixes and runs the review loop, and returns one report. The review rules stay in the reviewer skill at `../reviewer/SKILL.md` relative to this skill file; do not restate them. The skill explicitly authorizes the reviewer launches that skill describes.

## Caller phase

You are the executor and no fork has been started for this object yet.

1. Finish the work and its ordinary checks. No tool call may still run.
2. Start the fork with one blocking `task` call: `context` = "Self-check fork of the executor's finished work."; `tasks` = one item `{name: "SelfCheck", agent: "selfcheck", task: <the brief below>, solutionSpace: "checks, fixes and review rounds open; stop at CLEAN"}`. Pass no `model`: `selfcheck` inherits the parent session model by design. `selfcheck` has the default full toolset and can spawn only `spotty` and `bossy`.
3. The `task` carries: `skill://selfcheck/SKILL.md` and "you are the fork, run the fork phase"; the exact object (absolute paths, diff file, stage) and the requested review level, blind by default; the primary requirements; the user's words verbatim under `<user_messages>`, the accepted decisions in `<agreement>` and the check criterion in `<criterion>`. OMP subagents do not inherit history: include every primary source and never refer to "the conversation".
4. The blocking call returns the single report. Do not edit the object meanwhile and do not start a reviewer for it yourself.
5. Reread the changed paths before any new edit; your earlier reads are stale. Stop the fork once its report is in. The fork's history is not merged into yours.

## Fork phase

You are the fork. Do not start another selfcheck fork.

1. Check the result against the user's words and the primary requirements. Run the affected tests and, where possible and allowed, the product; reuse a check that already passed on the unchanged object, and rerun it only after a change or new evidence. Fix what you find. Repeat the check-and-fix until no known problem remains. Keep other people's edits and the ordered scope.
2. Run the review loop exactly as the reviewer skill at `skill://reviewer/SKILL.md` describes, at the requested level, blind by default: one blocking `task` call with `agent: "spotty"` for blind or `"bossy"` for high and the brief from that skill. Read the full verdict from `agent://<id>` when the result is a preview. Do not pass your own verdict to the reviewer. Fix every admitted finding as one batch and start a new pass until the reviewer skill's stop condition is met. A reviewer failure follows the reviewer skill; a repeated failure ends the loop as blocked, never CLEAN.
3. Return one report to your parent, with no intermediate rounds:
   - admitted findings with their count, and fixes with changed paths;
   - checks run and their real results;
   - checks not run, each with its concrete limit;
   - number of review rounds;
   - `CLEAN`, or the reason the loop did not finish.
