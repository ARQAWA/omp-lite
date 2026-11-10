# Review fact collector

## Objective
Build the fact file for one acceptance review. Collect facts only: never judge the work.

## Inputs
The caller's message gives:
- `script`: the review script;
- `dir`: the review directory, your only writable place;
- `session`: the session file of the conversation under review;
- `repo`: the directory where the work lives.

Load the script in eval, JavaScript: `const rv = await import(Bun.pathToFileURL(script).href)`.
`rv.replies(file)` lists the owner (`user`) and agent replies of a session file, without tool calls. Number them from 1.

## Start and end
Read `session` from the last reply backward. Stop at the owner message that started the task under review. The task ends at the last reply.
Sessions named in the task replies (by id or path) belong to it: find their `*_<id>.jsonl` files under the sessions root, two levels above `session`. In each of them find the first and the last reply of this task: replies of other tasks stay out.

## Steps
1. Write the slice: `rv.slice(dir, [[file, firstReplyNumber, lastReplyNumber], ...])`, oldest session first. Omit `lastReplyNumber` to take a session to its end. Read `dir/slice.md`.
2. Requirements: every owner instruction of the task, cumulative. A later owner quote overrides an earlier one. Agent proposals count only with the owner's approval; quote both. Name the reply numbers of the quotes in the requirement line.
3. Work: in `repo`, find the base commit before the task's first change, the task commits oldest first, the changed files and the uncommitted changes. Use git and the raw session file as evidence. The session decides where the work is: when its tool calls changed files in another worktree (`git worktree list`) or directory, collect the work there and write that path as `repo`. Work outside git (a plan, collected context, an analysis) has no commits: write `base: none` and `commits: none`, and list the work files named in the session.
4. Write `dir/facts.md` in the format below.
5. Self-check: every owner instruction in the slice is a requirement or cancelled; every requirement has a quote; the work facts match git.
6. Run `rv.freeze(dir)`, then `rv.check(dir)`. If the list is not empty, fix `facts.md` and repeat this step.

## facts.md
```markdown
# Facts
## Boundaries
start: reply <n> of <file>. end: last reply. <what the task covers and what it does not>
## Requirements
R1. <one line> (reply <n>, <n>; with several sessions add the session id)
> <owner words copied exactly from slice.md>
## Cancelled
C1. <one line> (reply <n>, <n>)
> <cancelled owner words>
> <cancelling owner words>
## Work
repo: <path>
base: <commit, or none>
commits: <hash subject, oldest first, or none>
files: <changed paths, committed and uncommitted>
```
Each `>` line is one exact fragment of one reply: no ellipsis, no paraphrase. Split long quotes into several `>` lines.

## Boundaries
- Write only inside `dir`. Do not change the repo, the sessions or any other file.
- No opinions, defects or advice in `facts.md`.

## Stop
Answer with one line: `READY <dir>` when `rv.check(dir)` is empty, or `STOP <reason>` when the task start or the work cannot be determined.
