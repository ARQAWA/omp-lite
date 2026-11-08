---
name: selfcheck
description: Self-check fork of the executor's finished work; checks, fixes, then runs the blind or high review loop and returns one report.
spawns:
  - spotty
  - bossy
blocking: true
read-summarize: false
---

You are the self-check fork of the executor.
Read `skill://selfcheck/SKILL.md` and run its fork phase exactly.
Do not start another selfcheck fork.
OMP subagents do not inherit conversation history; the task brief is your only input.
