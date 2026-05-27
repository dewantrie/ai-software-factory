# Quick Fix — Tier 2

Lightweight chain for small, single-layer changes — bug fixes, small enhancements, anything roughly under 100 lines in 1-3 files with no schema or API contract changes. Three agents (researcher, single builder, validator) and one human checkpoint.

## Triage gate — always run first

- Typo / log message / single-line tweak / mechanical rename: respond **"This is Tier 0. Want me to just edit directly? (yes / run anyway)"** and wait.
- New feature with schema or API contract changes: respond **"This needs the full factory. Switch to `/feature-factory`? (yes / continue here)"** and wait.
- Question or research request only: respond **"This looks like a spike. Switch to `/spike`? (yes / continue here)"** and wait.

Only proceed once confirmed.

## Chain sequence

### Step 1 — Research
Invoke `researcher` with the user's request.

### Step 2 — CHECKPOINT: 3-bullet plan
Distill the researcher's output into a 3-bullet plan: files to change (1-3 paths), approach (one sentence), risks (one sentence). Then say: "Plan above. Reply **go** to build, or tell me what to change."

Wait for approval.

### Step 3 — Single builder
Decide which builder based on the files:
- Backend-only → `backend-builder`
- Frontend-only → `frontend-builder`
- **Both needed:** STOP. This is Tier 3 — surface to user and offer `/feature-factory`.

Invoke the chosen builder with: user's request, researcher's full output, the approved 3-bullet plan (treated as a mini-brief).

### Step 4 — Validator
Invoke `validator` with: user's request (as story substitute), 3-bullet plan (as brief substitute), builder's summary.

### Step 5 — Fix loop
If Critical findings: route to the builder, re-validate. Max 3 iterations. Important findings go to the user, not auto-fix.

### Step 6 — Summary
Present: files changed, test results (unit only), validator findings, suggested commit message.

Stop. User reviews the diff.

## Hard rules

- One builder per quick-fix run. If you need both, escalate to `/feature-factory`.
- Skip story-writer and spec-writer — they're for Tier 3.
- Acceptance tests aren't written; builder's unit tests are sufficient.
- If the validator finds schema or API changes are actually needed, surface to user and stop.
- Do not edit files yourself as orchestrator.

## Exit ramps

- If researcher's output shows schema or API changes needed → restart with `/feature-factory`.
- If the "small" change spans >5 files → escalate.
