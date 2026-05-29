# Walkthrough: your first feature through the factory

A complete worked example of one feature going through the Tier 3 chain. Use this as a template the first few times you run the chain.

The example feature: **"add invoice reminders"** — a daily job that emails customers when invoices are >7 days unpaid, plus a manual "send reminder now" button for admins. It touches both backend and frontend, so the full 7-agent chain runs.

## How to invoke the chain — by platform

The chain logic is identical across platforms; only the **entry point** differs. The rest of this walkthrough uses Claude Code syntax in the examples — translate the entry point per the table below.

| Platform | Tier 3 entry | Tier 2 entry | Tier 1 entry |
|----------|--------------|--------------|--------------|
| Claude Code | `/feature-factory <request>` | `/quick-fix <description>` | `/spike <question>` |
| Kiro | `#skill-feature-factory <request>` | `#skill-quick-fix <description>` | `#skill-spike <question>` |
| Codex CLI | `./.codex/orchestrator/feature-factory.sh <request>` | `./.codex/orchestrator/quick-fix.sh <description>` | `./.codex/orchestrator/spike.sh <question>` |

### Platform notes — read the one you'll use

- **Claude Code** — the skill orchestrator is loaded into the main session and drives the chain automatically. Checkpoints pause the conversation; you reply with text. Tool scoping is enforced at the tool level.
- **Kiro** — the skill orchestrator is a steering file the user (or Kiro's agentic chat) follows. Each agent is invoked separately via `#agent-<name>` after the skill tells you which one is next. Chain runs **semi-manually**. Tool scoping is prompt-only.
- **Codex CLI** — the orchestrator is a **bash script** that calls `codex exec` per agent. Checkpoints pause via `read -p` in your terminal — type `yes` to continue, anything else to halt. All step outputs are saved under `.codex/runs/<timestamp>-<skill>/` for replay. Phase A: no automated fix loops yet — re-run after Critical validator findings.

## Before you start

You need:

- The factory installed in your repo (`.claude/`, `CLAUDE.md`, or whatever the platform-specific equivalent is for your target).
- `CLAUDE.md` (or equivalent context file) filled in — especially the **Commands** and **Path scoping for agents** sections. If these are missing, agents will stop and ask.
- A small but real feature to try. Don't pick a typo (Tier 0) and don't pick a massive cross-team feature (you'll lose the thread before checkpoints).

**Good first features to try:**

- Add a created-at timestamp display to an existing entity page
- Add CSV export to a list view
- Add a "mark as archived" action with a confirmation modal

Pick one that touches both backend and frontend but only ~5 files. You'll learn the rhythm in one or two runs.

## Step 0 — kick off

In your project, invoke the chain (substitute the entry from the platform table above):

```
/feature-factory build invoice reminders — when an invoice has been unpaid for more than 7 days, send the customer a reminder email. Admins should also be able to send a reminder manually from the invoice page.
```

(On Kiro: `#skill-feature-factory build invoice reminders — ...`. On Codex CLI: `./.codex/orchestrator/feature-factory.sh "build invoice reminders — ..."`.)

### What makes a good kickoff prompt

| Include | Don't include |
|---------|---------------|
| Concrete behavior ("send a reminder email") | File paths or table names |
| Measurable conditions ("more than 7 days unpaid") | Library names ("use BullMQ") |
| Actor and trigger ("admin can manually send") | Implementation strategy ("write a cron") |
| Why it matters (one short clause) | Long preamble or rationale |

The story writer and spec writer will fill in the technical decisions. Your job at step 0 is to be clear about **behavior**, not implementation.

## Step 1 — researcher runs (no input from you)

The orchestrator invokes the researcher automatically. You'll see output like:

```
### Relevant files
- src/services/invoice.ts:1-150 — invoice service, has findByTenant() and updateStatus()
- src/services/email.ts:20-80 — email sender wrapping Resend
- src/app/api/invoices/route.ts — list/create invoice endpoints
- prisma/schema.prisma:42 — Invoice model has status, dueAt, paidAt
- src/queue/jobs.ts:10 — BullMQ job registration

### Existing patterns to follow
- Tenant scoping via withTenant() helper at src/lib/db.ts:42
- Background jobs registered via registerJob() at src/queue/jobs.ts:8
- Email templates in src/lib/email-templates/

### Similar features already built
- src/services/welcome-email.ts:1-80 — sends welcome emails on signup. Good template.

### Risks
- Tenant isolation: all Invoice queries need tenantId scope
- Idempotency: shouldn't send same reminder twice on retry
- Timezone: "7 days" must be measured in UTC

### Open questions
- Should reminders fire on weekends?
- Max reminders per invoice?

### One-line summary
Add reminder job + admin manual-send button, following the welcome-email pattern.
```

**What to watch for:**

- **Does the researcher list the right files?** If it missed a critical file you know about, the chain will be wrong downstream. You can reply with a hint: `the researcher missed src/services/billing-events.ts — re-run with that context`.
- **Are the risks correct?** If the researcher flagged risks that don't apply, or missed risks you know exist, push back.
- **Open questions?** Note them — they'll come up again at CHECKPOINT 1.

The chain continues automatically — no checkpoint here.

## Step 2 — story writer runs (no input from you yet)

```
### User Story
As a billing admin
I want overdue invoices to remind the customer automatically after 7 days unpaid
So that I get paid sooner without chasing manually

### Acceptance Criteria
1. When an invoice's dueAt is more than 7 calendar days in the past AND status is "unpaid", a reminder email is sent to the customer's email on file.
2. The reminder email contains the invoice ID, amount due, and a link to view the invoice.
3. A single invoice receives at most one reminder per 7-day period (idempotent on retries).
4. An admin viewing an unpaid overdue invoice can click "Send reminder now" to trigger a reminder immediately.
5. Manual reminders are restricted to admins of the invoice's tenant.
6. Failed email sends are logged but do not crash the job.

### Edge Cases
- Invoice has no customer email → skip, log warning
- Customer pays between job scheduling and execution → skip
- Tenant isolation: every query scoped

### Out of Scope
- SMS reminders
- Custom reminder templates
- Multiple reminder cadences

### Open Questions
- Should reminders fire on weekends? Researcher flagged this. Default: YES.
- Max reminders per invoice? Defaulting to "one per 7-day period" per AC3.
```

## ⏸ CHECKPOINT 1 — story approval

The orchestrator stops and presents the story. **You decide.**

### If everything looks right

```
approved
```

### If something is wrong

Be specific:

```
change AC3 — reminders should fire once per invoice ever, not once per 7-day period. Also remove AC5, tenant scoping is implied.
```

The orchestrator re-invokes the story-writer with your feedback, presents the new version, waits again.

### If there are open questions

Answer them as part of your approval:

```
approved, with: weekends YES, max 1 reminder ever per invoice
```

The orchestrator passes your answers forward to the spec-writer.

### Tips for this checkpoint

- **Read every acceptance criterion.** Each one becomes a test later. Vague ACs produce vague tests.
- **Watch for invented requirements.** If the story has an AC you didn't ask for, push back.
- **Watch for missing requirements.** If the original feature should cover X and the story doesn't, push back.
- **Time budget:** 1–2 minutes. Faster than reading a Jira ticket.

## Step 3 — spec writer runs (after your approval)

A detailed technical brief, typically 80–150 lines. Excerpt:

```
### Summary
Add an invoice-reminder feature with both automatic (hourly job) and manual
(admin button) triggers. Uses the existing email and BullMQ infrastructure.
Adds a ReminderLog model for idempotency tracking.

### Data model changes
- ReminderLog (new):
  - id: uuid, pk
  - invoiceId: uuid, fk, indexed
  - tenantId: uuid, fk, indexed
  - sentAt: timestamptz
  - emailMessageId: text
  - Unique constraint: (invoiceId, sentAt::date::week)

### Flow / process flow
1. Hourly job (BullMQ) queries unpaid invoices >7 days overdue without an existing
   ReminderLog entry for the current 7-day window.
2. For each, enqueue sendReminderEmail() job.
3. sendReminderEmail() calls email.send(), then writes ReminderLog row.
4. Manual trigger: POST /api/invoices/:id/remind enqueues sendReminderEmail()
   for that invoice immediately.

### API changes
POST /api/invoices/:id/remind
  Request: { } (no body)
  Response 200: { data: { reminderId: string } }
  Response 403: { error: { code: "FORBIDDEN", message: string } }   # wrong tenant
  Response 404: { error: { code: "NOT_FOUND", message: string } }
  Auth: admin role required, scoped to invoice's tenant

### Frontend changes
- src/app/invoices/[id]/page.tsx (modify) — show ReminderButton when invoice is unpaid AND overdue
- src/components/ReminderButton.tsx (create) — button + loading + success/error toast
- src/hooks/useSendReminder.ts (create) — wraps POST call

### Tests required
Unit (backend):
- invoice-reminder.service.ts: query filters by overdue + unpaid; respects idempotency
- POST handler: rejects non-admin; rejects wrong tenant; enqueues job on success

Unit (frontend):
- ReminderButton: renders only on overdue + unpaid; shows loading; handles 403/404
- useSendReminder: posts to correct endpoint; returns toast-friendly errors

Acceptance:
- AC1 → "fires reminder for >7d unpaid invoice"
- AC2 → "email body contains invoice ID, amount, link"
- AC3 → "doesn't fire twice in same week"
- AC4 → "admin manual trigger works on overdue invoice"
- AC5 → "manual trigger rejects wrong tenant"
- AC6 → "failed email logged, job doesn't crash"

### Files that will change
Backend Builder will modify:
- src/services/invoice-reminder.service.ts (create)
- src/queue/jobs.ts (modify) — register reminder job
- src/app/api/invoices/[id]/remind/route.ts (create)
- prisma/schema.prisma (modify) — add ReminderLog
- prisma/migrations/<timestamp>_add_reminder_log/migration.sql (create)

Frontend Builder will modify:
- src/components/ReminderButton.tsx (create)
- src/hooks/useSendReminder.ts (create)
- src/app/invoices/[id]/page.tsx (modify)

Test Verifier will create:
- tests/acceptance/invoice-reminders.spec.ts

### Patterns to reuse
- registerJob() pattern from src/queue/jobs.ts:8
- withTenant() helper at src/lib/db.ts:42 for all Invoice queries
- Email template pattern from src/lib/email-templates/welcome.mjml

### Risks and open questions
Risks:
- Hourly job + tenant scoping: ensure the WHERE clause is correct
- Time zone: dueAt + 7 days is UTC; document this in code comment
- Idempotency: unique constraint on (invoiceId, weekOfYear) prevents double-send

Open questions: None.
```

## ⏸ CHECKPOINT 2 — brief approval (the most important checkpoint)

This is where architectural mistakes are cheapest to catch. **A mistake caught here costs one re-prompt. The same mistake caught after the builders run costs hours of rework.**

### If it looks sound

```
approved
```

### If you see a problem

Be specific:

```
two changes:
1. The hourly job is too aggressive — make it run every 6 hours.
2. The ReminderLog unique constraint should be on (invoiceId, weekOfYear) but
   we don't store weekOfYear — either add it as a generated column or use a
   date_trunc('week', sentAt) functional index. Pick one and update the brief.
```

### What to look for at this checkpoint

| Look for | Why it matters |
|----------|----------------|
| Wrong table additions | Schema changes are expensive to undo |
| Missing tenant scoping in queries | Tenant data leak — most common security bug |
| Missing idempotency / retry safety | Background jobs WILL retry; duplicate sends are real |
| Missing error states in frontend | Loading-only UIs become "I clicked twice and nothing happened" |
| Files listed that shouldn't be touched | Scope creep |
| Files NOT listed that obviously should be | Will block downstream |
| "Open Questions" still present | Brief is not ready — answer them or push back |
| New dependencies | Approve dependencies explicitly |

### Hard rule

**If the brief has Open Questions, do NOT type `approved`.** Answer them or push back. The brief is not ready while questions are open.

## Steps 4–7 — builders, verifier, validator (no input from you)

After step 3 approval, the chain runs automatically:

```
backend-builder runs    → emits files + API contract
frontend-builder runs   → consumes the contract, writes UI files
test-verifier runs      → writes acceptance tests, runs them
                        (if any AC fails → routes back to relevant builder, max 3 loops)
validator runs          → checks code vs story + brief
                        (if Critical → routes back, max 3 loops)
```

You may see status updates between agents but no checkpoints. The fix loops are bounded — after 3 failed attempts on the same error, the orchestrator stops and surfaces the situation to you.

You can interrupt anytime by typing `stop` or `cancel` — the orchestrator will halt cleanly and report what's been done.

## ⏸ CHECKPOINT 3 — PR review

The orchestrator presents a final summary:

```
## Summary

Story: Invoice reminders for >7 day unpaid invoices, with admin manual trigger.

Files changed:
  Backend (5): invoice-reminder.service.ts, jobs.ts, route.ts, schema.prisma, migration.sql
  Frontend (3): ReminderButton.tsx, useSendReminder.ts, page.tsx
  Tests (1): invoice-reminders.spec.ts

Test results:
  Unit: 14 passed, 0 failed
  Acceptance: 6 passed, 0 failed (1:1 with ACs)

Validator findings:
  Critical: none
  Important:
    - src/components/ReminderButton.tsx:42 — Inline string "Send reminder",
      consider i18n if you're internationalizing soon
  Minor:
    - src/services/invoice-reminder.service.ts:78 — Could destructure earlier; cosmetic

Suggested PR title: "Add 7-day invoice reminder email + admin manual trigger"
Suggested PR body:
- Adds hourly job that emails customers for invoices >7 days unpaid
- Adds POST /api/invoices/:id/remind for admin manual trigger
- Idempotent via ReminderLog table with unique constraint on (invoiceId, week)
- Tenant-scoped: manual trigger rejects wrong-tenant requests
- 14 unit + 6 acceptance tests
```

### What to do now

1. **Read the diff in your editor.** The agents are good but not infallible. Skim the changed files.
2. **Pay attention to Important findings.** Critical should be empty by now (validator's fix loop ran). Important findings are reviewer's-call — you decide.
3. **Run the build locally yourself** if you don't trust the agents' validation output (especially for the first few features).
4. **Open the PR** via your normal workflow (`gh pr create` or web UI).

### If something is wrong at this stage

Push back one more time:

```
the manual trigger button should be disabled while the request is in flight,
not just show a loading state — fix that
```

The orchestrator routes the change to the frontend-builder, re-runs validator, presents again.

## Cheat sheet — what to type at each step

**Entry points (platform-specific):** see the "How to invoke the chain — by platform" table at the top of this doc.

**Mid-chain responses (same on every platform):**

| Situation | Type |
|-----------|------|
| Story approval | `approved` |
| Story with answer to open questions | `approved, with: <answer1>, <answer2>` |
| Story changes needed | `change AC<N> — <what to change>` or `not approved, <issue>` |
| Brief approval | `approved` |
| Brief changes needed | `<specific change>` — name the section and what to change |
| Mid-chain interruption | `stop` or `cancel` (Claude Code / Kiro). On Codex CLI: reply anything other than `yes` at the checkpoint `read` prompt. |
| Final review action | Read diff yourself, open PR yourself |

## Common mistakes when first using it

1. **Too vague at step 0.** "Improve the dashboard" produces a vague story. Better: "show last 30 days of revenue on the dashboard home, broken down by week."

2. **Approving without reading.** The checkpoints exist to catch errors. Take 60 seconds to read the story and brief. The cost of catching an error here is one re-prompt; the cost of catching it later is hours.

3. **Switching to "let me just edit it" mid-chain.** Defeats the purpose. If a step is wrong, push back at that step.

4. **Not updating CLAUDE.md when the agent surprises you.** The chain only improves if you write down what the agent got wrong. Add a rule. After 2–3 weeks, the chain stops surprising you.

5. **Running Tier 3 on a typo.** The triage gate should catch this, but if it slips through, you'll burn 7 agent invocations on a CSS color change. Just edit directly for small things.

6. **Approving a brief with Open Questions.** Open Questions mean the brief is not ready. Answer them first.

## What to do when things go wrong

### "The researcher missed an important file"

Reply during the researcher step (or right after, before story-writer runs):
```
the researcher missed src/services/X — re-run with that file as additional context
```

### "The story has an AC I didn't ask for"

```
not approved. Remove AC5 — that was not in the original request and is out of scope.
```

### "The brief has a wrong architectural decision"

```
not approved. The spec uses cron — we use BullMQ. Rewrite using BullMQ per CLAUDE.md.
```

(Then add to CLAUDE.md: "Do not use cron. We use BullMQ." This prevents it next time.)

### "A builder edited a file outside its scope"

That's a bug the validator should catch. If it doesn't:
- Check `CLAUDE.md` → "Path scoping for agents" — is the file outside the scope listed?
- If yes, the validator's checklist needs reinforcement. Add: "Verify no files were changed outside the brief's 'Files that will change' list. Critical if violated."

### "The fix loop hit 3 iterations and stopped"

The orchestrator surfaces this to you. Usually means the story or brief is wrong, not the code. Re-read both. Common cause: an acceptance criterion is impossible to satisfy given the architecture in the brief. Either change the AC or change the brief.

### "Validator reports 'no issues' but I see issues in the diff"

The validator's checklist is too lenient. Add the missed check to the validator's prompt (`prompts/agents/validator.md`). Re-run `factory install` to push the update to your repos.

## After your first feature: tune the system

Each surprise is a learning signal. Where the chain disappointed you tells you exactly what to fix:

| Where it failed | Where to update |
|-----------------|-----------------|
| Researcher missed a file | Add a hint about that area to the profile |
| Story-writer invented requirements | Tighten the story-writer prompt's "Hard rules" |
| Spec-writer chose wrong architecture | Add the rule to CLAUDE.md's "Architecture rules" or "Don't do" |
| Builder used wrong pattern | Add the pattern to CLAUDE.md's "Conventions" with file:line reference |
| Validator missed something | Add the check to the validator's checklist |

After 5–10 features in the same codebase, the chain knows your conventions cold. The checkpoints get faster (you mostly say "approved"). That's when the factory starts paying back the setup cost.

## Next steps

- Run the chain on one real (small) feature this week.
- Watch where it stumbles. Add CLAUDE.md rules for each surprise.
- Try the Tier 2 chain (quick-fix) on a single-layer bug next.
- Try the Tier 1 chain (spike) on a "how does X work" question.
- After 3–4 features, you'll know whether to add more stack profiles or wire up additional platforms (Cursor, Kiro, etc.).
