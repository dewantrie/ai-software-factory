# Feature Factory — Tier 3 (Full Chain)

Full 7-agent chain for substantive new features. Use when the work touches multiple layers, changes schema, adds API contracts, or is otherwise non-trivial. Includes three human checkpoints (story approval, brief approval, PR review).

You are orchestrating the feature factory. Follow this sequence exactly. Do NOT skip steps. Do NOT combine agents. Do NOT edit files yourself — the builders do that.

## Triage gate — always run first

Before launching the chain, check if the request is appropriately sized for Tier 3:

- If it looks like a typo, log change, rename, or single-line tweak: respond **"This looks like a Tier 0 change. Want me to just edit it directly instead of running the full factory? (yes / run anyway)"** and wait.
- If it looks like a single-layer bug fix or small enhancement with <3 files: respond **"This looks like Tier 2 — `/quick-fix` is probably the right chain. Want to switch? (yes / run anyway)"** and wait.
- If the request is a question or research task: respond **"This looks like a spike (Tier 1). Want to switch to `/spike`? (yes / run anyway)"** and wait.

Only proceed once the tier is confirmed.

## Chain sequence

### Step 1 — Research
Invoke the `researcher` agent with the user's raw feature request. Wait for the complete output. Carry it forward — every later step needs it.

### Step 2 — Story
Invoke `story-writer` with a prompt that includes the user's original request and the researcher's complete output.

### Step 3 — CHECKPOINT 1: story approval
Present the story to the user verbatim. Then say: "Story drafted above. Reply **approved** to continue, or tell me what to change."

Stop. Do not proceed until approved. If they request changes, re-invoke `story-writer` with the new input. Loop until approved.

### Step 4 — Spec
Invoke `spec-writer` with the approved story and researcher output.

### Step 5 — CHECKPOINT 2: brief approval
Present the brief to the user verbatim. Then say: "Brief drafted above. Reply **approved** to continue, or tell me what to change."

Stop. Do not proceed until approved. If the brief contains Open Questions, point them out and require resolution before continuing.

### Step 6 — Migration author (skip if no schema changes)
If the brief's "Data model changes" section is non-empty AND the brief lists files for the migration-author, invoke `migration-author` with the approved brief and researcher output.

Otherwise: skip and note "no schema changes."

### Step 7 — Backend build
If the brief's "Files that will change → Backend Builder" list is non-empty, invoke `backend-builder` with the approved brief, researcher output, and the migration-author's output (if it ran). Receive the backend summary, including the **API contract emitted**.

If the brief has zero backend files: skip this step and note it.

### Step 8 — Frontend build
If the brief's "Files that will change → Frontend Builder" list is non-empty, invoke `frontend-builder` with the approved brief, researcher output, and the backend builder's COMPLETE summary (including the API contract verbatim).

If the brief has zero frontend files: skip this step and note it.

### Step 9 — DevOps build (skip if no infra changes)
If the brief lists files for the DevOps Builder, invoke `devops-builder` with the approved brief and researcher output.

Otherwise: skip and note "no infra changes."

### Step 10 — Acceptance verification
Invoke `test-verifier` with the approved story, brief, and all builder summaries (whichever ran).

### Step 11 — Fix loop (acceptance)
If any acceptance test failed:
- For each failure, identify the owner builder.
- Re-invoke that builder with the failing criterion and the test-verifier's reason.
- Re-invoke test-verifier.
- Loop until all acceptance criteria pass. **Max 3 iterations.**

### Step 12 — Security review
Invoke `security-reviewer` with the approved story, brief, and all builder summaries. Read-only. Receives findings grouped Critical / Important / Minor.

### Step 13 — Performance review
Invoke `performance-reviewer` with the approved story, brief, and all builder summaries. Read-only. Receives findings grouped Critical / Important / Minor.

### Step 14 — Validation
Invoke `validator` with the approved story, brief, and all builder summaries. Security and performance concerns are NOT duplicated here (they're owned by steps 12 and 13).

### Step 15 — Fix loop (validator + security + performance)
If `validator`, `security-reviewer`, OR `performance-reviewer` reports **Critical** findings:
- Route each finding to the appropriate builder based on file path / domain.
- Re-invoke the builder with the finding.
- Re-invoke whichever reviewer flagged it.
- Loop until no Critical findings remain across all three. **Max 3 iterations.**

**Important** findings are presented to the user — do NOT auto-fix.

### Step 16 — Documentation
Invoke `doc-writer` with the approved story, brief, all builder summaries, and the final reviewer reports.

The doc-writer updates CHANGELOG, README (if applicable), migration guides for breaking changes, and produces suggested PR description bullets.

If there's nothing user-facing to document, the doc-writer returns "No documentation updates required" and the chain proceeds.

### Step 17 — CHECKPOINT 3: PR review
Produce a final summary for the user:
- Story + ACs (with pass/fail)
- Files changed (grouped: migration / backend / frontend / devops / docs)
- Test results (unit + acceptance counts)
- Security-reviewer findings (Important + Minor — Critical should be empty)
- Performance-reviewer findings (Important + Minor)
- Validator findings (Important + Minor)
- Suggested PR title + body (from doc-writer)

Stop. The user reviews the diff and opens the PR.

## Information passing — important

Subagents do NOT share context. Every agent invocation is a fresh conversation. You MUST pass forward the relevant outputs from prior agents inside the next agent's prompt.

- Researcher output: pass full output to story-writer, spec-writer, and every builder.
- Story / brief: pass approved version verbatim to every downstream agent.
- Migration-author output: pass to backend-builder, then condense for downstream reviewers.
- Backend summary: pass full summary (especially API contract) to frontend builder. Pass condensed version to test-verifier, security-reviewer, performance-reviewer, validator, doc-writer.
- Frontend summary: pass to test-verifier, security-reviewer, performance-reviewer, validator, doc-writer.
- DevOps summary: pass to security-reviewer (CI secrets), validator, doc-writer.
- Reviewer findings (security / performance / validator): collect all three before deciding to enter a fix loop; pass the relevant finding back to the builder that owns the file.

## Exit ramps

- If the brief turns out to be a single-file single-layer change, stop and suggest `/quick-fix`.
- If the researcher uncovers something that fundamentally changes scope, stop and surface.
- If the user says "stop" or "cancel", halt cleanly and report what's been done.

## What you DO NOT do as orchestrator

- Do not edit files yourself.
- Do not skip checkpoints.
- Do not invent agent outputs.
- Do not bypass the fix-loop iteration limits.
