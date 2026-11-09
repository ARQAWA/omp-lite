---
name: reviewer
description: "Acceptance review for any agreed work, only when requested or required by applicable project instructions or an invoked skill."
---

# Reviewer

Review only what the user ordered: nothing missing and nothing extra. The same procedure covers plans, context collection, analysis, code and finished results. Do not launch review unless the user, applicable project instructions or an invoked skill requires it.

## Prepare the packet

Keep the object unchanged during a review. Gather the original messages and approved proposals verbatim. Compile the active requirements with source quotes. Include every applicable obligation for this stage. A caller's criterion may focus the check; it cannot add scope or waive a requirement.

Include actual source contents and the whole in-scope object. Paths alone are not evidence: this reviewer cannot read them. For code, include the full task diff, relevant surrounding code and required check results. Include untracked deliverables. For other work, include the full plan, report or other artifact. Do not replace originals with your assurances.

Supply project rules explicitly, with their sources and applicability. The tool always supplies the same installed WORKFLOW.md principles. Other projects do not need this repository's dev/ directory. Do not import memory, unrelated conversation, previous reviewer verdicts or private summaries into the packet. User-approved changes to the agreement are original requirements, not reviewer opinions.

Use this template:

```text
<user_messages>
Verbatim relevant messages, amendments and accepted proposals, with source IDs.
A short approval includes the exact proposal it approves.
</user_messages>
<requirements>
One ID per active requirement: exact source quote, source ID, current-stage obligation.
Include scope boundaries and delegated choices. Do not silently drop requirements.
</requirements>
<object>
stage: pre-action | pre-completion
pass: initial | changed-object
Complete object contents, with source IDs.
For changed-object: fixes, changed parts and affected paths.
</object>
<rules>
Applicable project instructions, verbatim, with source IDs and stage applicability.
</rules>
<evidence>
Source contents and required verification results, with source IDs.
Name unavailable required evidence explicitly.
</evidence>
```

## Run

Call the `review` tool once with `level: "blind"` by default, or `level: "high"` when requested, and the complete `packet`. Models remain Terra high and Terra xhigh. Each call has a fresh explicit context, without memory or tools. Do not substitute `task`, `reuse`, a fork, or Main's own review. If the tool or model is unavailable, report the blocker.

## Handle the result

Continue the collaboration until CLEAN: the reviewer reports every supported error in one batch, Main fixes all admitted findings within the agreed scope, then requests the next check. There is no fixed number of ordinary review rounds. Do not stop with valid findings merely because several rounds passed. Missing authority or required evidence blocks progress, not the obligation: resume after the gap is resolved. Never manufacture CLEAN by dropping requirements.

- CLEAN with concrete CHECKED and no missing proof: accept. No extra confidence pass.
- FINDINGS: verify each source quote and the complete cited object. Admit only actual missing, incorrect or extra work. A finding is not an instruction to expand the task. Reject unsupported findings with exact evidence. An alleged omission already present is not a defect.
- Review-only request: report verified findings without editing. Otherwise fix valid findings together, only within authorized scope. Do not remove requested behavior to obtain CLEAN.
- Recheck only after changes or newly supplied required evidence. Keep the original requirements. Pass the changed object and affected scope, not previous opinions. Main keeps the rejection record separately.
- BLOCKED, unavailable required evidence or ambiguous scope: report the exact blocker. Do not retry unchanged missing evidence. Do not fabricate a defect or acceptance.
- Provider failure or malformed output: retry once, within any agreed attempt limit. A second failure blocks acceptance. Never call an error CLEAN.

Respect the user's attempt and stop conditions. Do not invent a universal round quota from one task's limit. Stop if satisfying a finding needs new authority, contradicts an agreed decision, or would undo a valid fix. Surface the evidence to the owner. Do not silently waive a requirement.

When changing this contract, verify it with defective, corrected and missing-source examples on the configured reviewer model. A text assertion or mocked response does not prove instruction following. These checks are separate from ordinary task review loops.
