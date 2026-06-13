# 03 — The Agent Chain

The files ai-factory generates exist to run a **disciplined chain of specialist
agents**. This chapter explains that chain and, more importantly, the reasoning behind
its shape: where humans decide, where AI decides, and why the checkpoints sit where
they do.

## The cast: 12 agents, 3 skills

**Agents** (`prompts/agents/*.md`) each do one job in a fresh context window:

| Agent | Role | Edits files? |
|---|---|---|
| researcher | Maps the codebase: relevant files, patterns, risks | no (read-only) |
| story-writer | Turns a request into a user story + acceptance criteria | no |
| spec-writer | Turns an approved story into a technical brief | no |
| migration-author | Writes DB migrations safely | yes (migrations) |
| backend-builder | Implements backend changes | yes (backend) |
| frontend-builder | Implements frontend changes, consumes the API contract | yes (frontend) |
| devops-builder | CI/CD + IaC | yes (infra) |
| test-verifier | Writes acceptance tests against the story | yes (tests) |
| security-reviewer | OWASP-flavored audit | no |
| performance-reviewer | N+1, hot paths, unbounded loops | no |
| validator | Compares implementation to story + brief | no |
| doc-writer | CHANGELOG, README, migration guides | yes (docs) |

**Skills** (`prompts/skills/*.md`) are orchestrators — they tell the AI which agents to
invoke, in what order, with what hand-offs. They map to three **tiers** of work:

| Tier | Skill | When | Shape |
|---|---|---|---|
| 1 | `spike` | "How does X work?" research | researcher only, no code |
| 2 | `quick-fix` | small single-layer change (1–3 files) | researcher → one builder → validator |
| 3 | `feature-factory` | substantive feature, multi-layer | the full chain below |

## The Tier 3 chain

`prompts/skills/feature-factory.md` orchestrates this sequence (the orchestrator runs in
the **main** session and invokes each agent as a subagent — it never edits files itself):

```
researcher → story-writer
   ⏸ CHECKPOINT 1 (human approves story)
spec-writer
   ⏸ CHECKPOINT 2 (human approves brief)
migration-author → backend-builder → frontend-builder → devops-builder
test-verifier
   ↻ fix loop (max 3) if any acceptance criterion fails
security-reviewer → performance-reviewer → validator
   ↻ fix loop (max 3) if any Critical finding
doc-writer
   ⏸ CHECKPOINT 3 (human reviews diff, opens PR)
```

Two mechanisms keep it honest:

- **Information passing.** Subagents don't share memory. The orchestrator passes the
  relevant prior outputs forward in each agent's prompt (researcher output → everyone;
  the backend builder's API contract → frontend builder verbatim). This is explicit in
  the skill's "Information passing" section.
- **Bounded fix loops.** A failing acceptance criterion or Critical finding routes back
  to the responsible builder and re-runs the reviewer — but at most 3 times, then it
  surfaces to the human. No infinite flailing.

## Why this particular split

The chain encodes a belief about **where humans and AI each have an edge**:

- **Humans are better at** business judgment, ambiguous trade-offs, catching a missing
  requirement, taste. So humans own the three checkpoints and the merge decision.
- **AI is better at** breadth (reading many files fast), discipline (checking the same
  30 things every time), and patience (writing the boring fixtures). So AI owns
  research, drafting, building, and the mechanical review checklists.

The checkpoints sit **where a wrong assumption is cheapest to fix**:

- Catch a wrong *story* (CHECKPOINT 1) → cost is a re-draft.
- Catch a wrong *technical approach* (CHECKPOINT 2) → cost is a re-prompt.
- Catch the same mistake *after the builders run* → cost is hours of rework.

That economic argument — fix early because it's cheap early — is the reason the
checkpoints aren't bureaucracy. Remove them and you move the discovery of mistakes to
the most expensive possible moment.

## Why one job per agent, in a fresh context

Each agent is a separate invocation with a narrow role and (on Claude Code) a narrow
toolset. This buys three things:

1. **Focus** — a fresh context window with one job produces better output than a single
   mega-prompt juggling research + build + review.
2. **Tool scoping** — the researcher literally cannot edit files (no `Edit`/`Write`
   tool), so "read-only" is structural, not a polite request.
3. **Tunability** — when an agent surprises you, you fix *one* prompt. The validator's
   checklist is the highest-leverage prompt: every gap it misses becomes a new line in
   it, and the whole fleet improves.

## The chain's blind spot (be honest about it)

The chain is only as good as the validator's checklist. It is bad at anything not on
that checklist. This is why the most valuable maintenance activity is **tuning the
validator** — and why a human still reviews the diff at CHECKPOINT 3. Don't mistake "the
chain ran clean" for "the code is correct"; it means "the code passed the checks we
thought to write."

Next: [04 — Path enforcement](04-path-enforcement.md), where "this agent may only edit
backend files" stops being prose and becomes a tool-level block.
