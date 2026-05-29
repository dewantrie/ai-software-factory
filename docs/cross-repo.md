# Walkthrough: a feature across multiple repos

A worked example of one feature shipping through **two repos** (backend + frontend) via the contracts bridge. Read [`walkthrough.md`](walkthrough.md) first if you haven't seen the single-repo Tier 3 flow — this doc layers polyrepo coordination on top of it.

**The example feature:** "invoice reminders" — same as the single-repo walkthrough, but split across two repos:

| Repo | Layer | What it ships |
|------|-------|---------------|
| `billing-api` | backend | service + API endpoint + queue job + OpenAPI contract |
| `billing-web` | frontend | "Send reminder now" button + reminder badge on overdue invoices |

A third repo, `ai-factory-contracts`, holds the shared story and the API contract that bridges the two.

## Setup

You need three repos:

```
your-org/
├── ai-factory/                  # the factory framework (this checkout)
├── ai-factory-contracts/        # the bridge — needs `features/` dir; that's all
├── billing-api/                 # backend, with its own .factory.yaml
└── billing-web/                 # frontend, with its own .factory.yaml
```

Both implementing repos point at the contracts repo in their manifest:

```yaml
# billing-api/.factory.yaml
name: billing-api
layer: backend
profile: node-fastify
contracts-repo: ../ai-factory-contracts
# ... rest as usual ...
```

```yaml
# billing-web/.factory.yaml
name: billing-web
layer: frontend
profile: nextjs-app-router
contracts-repo: ../ai-factory-contracts
# ... rest as usual ...
```

Generate platform files in each:

```bash
cd billing-api && factory install
cd billing-web && factory install
```

## Step 1 — author the story (in the backend repo)

Start where the feature originates. Usually that's the backend repo for an API-led feature, but any implementing repo can be the author.

```bash
cd billing-api
factory feature start invoice-reminders
```

Output:

```
Created feature scaffold: <abs-path>/ai-factory-contracts/features/invoice-reminders

Next steps:
  1. Edit <path>/story.md with the user story + acceptance criteria.
  2. Commit the contracts repo (so other repos can pull it).
  3. In each implementing repo, run: factory feature pull invoice-reminders
```

Edit `ai-factory-contracts/features/invoice-reminders/story.md` — fill in the user story, acceptance criteria, edge cases, out-of-scope, open questions.

**Why the story lives in the contracts repo and not in each implementing repo:** so backend and frontend cannot drift on what the feature actually *is*. One file, one definition of done, two implementations.

Commit and push the contracts repo:

```bash
cd ../ai-factory-contracts
git add features/invoice-reminders
git commit -m "feature: invoice-reminders — start"
git push
```

## Step 2 — backend runs the chain

Back in the backend repo, pull the now-committed story:

```bash
cd ../billing-api
factory feature pull invoice-reminders
# → copies story.md into .factory/features/invoice-reminders/
```

Now run the Tier 3 chain. The skill orchestrator (in Claude Code, Kiro, or Codex CLI — see [walkthrough.md](walkthrough.md) for invocation per platform) reads the pulled story instead of having story-writer draft a new one.

The chain runs in **backend-only mode** because the brief will have zero frontend files (the manifest says `layer: backend`):

```
researcher → (skip story-writer — story already exists) → spec-writer → ⏸ approve brief →
  backend-builder → test-verifier → validator → ⏸ approve PR
```

When the backend builder finishes, it emits an API contract — typically saved at `docs/api/invoice-reminders.openapi.yaml` (or wherever your project keeps contracts).

## Step 3 — backend ships

After the backend PR is merged, ship the contract:

```bash
cd billing-api
factory feature ship invoice-reminders \
  --contract docs/api/invoice-reminders.openapi.yaml \
  --commit $(git rev-parse HEAD)
```

Output:

```
Copied contract: <abs>/billing-api/docs/api/invoice-reminders.openapi.yaml
              → <abs>/ai-factory-contracts/features/invoice-reminders/api.yaml
Added billing-api to status.shipped

Done. Don't forget to commit + push the contracts repo.
Status file: <abs>/ai-factory-contracts/features/invoice-reminders/status.yaml
```

Commit and push the contracts repo again:

```bash
cd ../ai-factory-contracts
git add features/invoice-reminders
git commit -m "feature: invoice-reminders — backend shipped"
git push
```

Now `status.yaml` records that backend has shipped, with the commit SHA:

```yaml
feature: invoice-reminders
created: 2026-05-29T10:00:00.000Z
shipped:
  - name: billing-api
    layer: backend
    shipped_at: 2026-05-29T15:00:00.000Z
    commit: abc1234
```

## Step 4 — frontend runs the chain

Switch to the frontend repo:

```bash
cd ../billing-web
factory feature pull invoice-reminders
```

Output:

```
Pulled feature "invoice-reminders" → <abs>/billing-web/.factory/features/invoice-reminders
  + api.yaml
  + story.md
```

Both `story.md` (story authored in step 1) and `api.yaml` (contract from step 3) are now available locally. Run the chain.

The frontend chain runs in **frontend-only mode** (manifest says `layer: frontend`):

```
researcher → (skip story-writer) → spec-writer (consumes the pulled API contract) →
  ⏸ approve brief → frontend-builder → test-verifier → validator → ⏸ approve PR
```

The spec-writer reads the API contract from `.factory/features/invoice-reminders/api.yaml` and writes the brief consuming it verbatim. The frontend-builder calls the endpoint as specified.

If the contract is wrong for the UI, the frontend chain stops and surfaces the mismatch — it does **not** invent a different endpoint. That's the whole point of the bridge.

## Step 5 — frontend ships

After the frontend PR merges:

```bash
factory feature ship invoice-reminders --commit $(git rev-parse HEAD)
```

(No `--contract` this time — the contract is the backend's responsibility.)

Commit the contracts repo:

```bash
cd ../ai-factory-contracts
git add features/invoice-reminders
git commit -m "feature: invoice-reminders — frontend shipped"
git push
```

`status.yaml` now shows both shipped:

```yaml
feature: invoice-reminders
created: 2026-05-29T10:00:00.000Z
shipped:
  - name: billing-api
    layer: backend
    shipped_at: 2026-05-29T15:00:00.000Z
    commit: abc1234
  - name: billing-web
    layer: frontend
    shipped_at: 2026-05-29T18:00:00.000Z
    commit: def5678
```

## Step 6 — verify

From either repo:

```bash
factory feature status invoice-reminders
```

```
Feature:   invoice-reminders
Created:   2026-05-29T10:00:00.000Z
Shipped in 2 repos:
  - billing-api (backend) — shipped 2026-05-29T15:00:00.000Z @abc1234
  - billing-web (frontend) — shipped 2026-05-29T18:00:00.000Z @def5678
```

Or to see everything in flight across all features:

```bash
factory feature list
```

## What this gives you

- **One story, two repos, zero drift.** Backend and frontend can't disagree about what the feature is because the AC list is one file.
- **Typed handoff.** The API contract is a real artifact (OpenAPI/proto/etc.) — the frontend chain can validate against it, and a codegen step can produce typed clients.
- **Audit trail.** Every ship records a commit SHA. Going back to "what shipped when" is just `git log` on the contracts repo.
- **Each repo's chain stays focused.** The backend chain has zero frontend agents to confuse it. Same for the frontend.

## Common mistakes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Frontend chain invents an endpoint instead of using the contract | The contract wasn't pulled, or wasn't named where the spec-writer expected | Confirm `.factory/features/<name>/api.yaml` exists. The spec-writer's prompt should reference it; if not, add the path to your profile or CLAUDE.md. |
| Two repos show the same story but diverge in implementation | Story was edited in one repo's local pull instead of in the contracts repo | Stories MUST be edited in the contracts repo. Local pulls are read-only. |
| `factory feature pull` returns nothing | The contracts repo hasn't been committed and pushed since `feature start` | Commit + push the contracts repo after `start` and after each `ship`. |
| Backend repo runs ship before the chain produced a contract | `--contract` flag points at a nonexistent file | Confirm the backend builder emitted the contract artifact at the expected path. Otherwise omit `--contract` and ship later. |
| Status.yaml shows a repo twice for one ship | You ran ship twice with different commit SHAs | Expected — ship is upsert (replaces existing entry by repo name). Use this to re-ship after a fix. |

## When NOT to use the bridge

- **Single repo with both backend and frontend (fullstack).** Use the single-repo walkthrough; you don't need a contracts bridge for code that lives together.
- **Pure exploration / spike.** Don't scaffold a feature for a "how does this work" question. Use the spike chain instead.
- **Features that touch only one repo.** Don't add the overhead — just run the chain in that repo without `feature start`.

## Phase A limitations (worth knowing)

- **No auto-pull on chain start.** You run `factory feature pull <name>` manually before invoking `/feature-factory`. A later phase can have the skill orchestrator auto-pull.
- **No auto-ship on chain completion.** You run `factory feature ship` manually after the chain finishes. Same — a later phase can integrate.
- **No validation that the API contract format matches the spec.** If the backend emits OpenAPI but the frontend chain expects proto, you'll discover at runtime. Add a check in the profile if your project standardizes on one format.
- **No locking.** Two developers running `feature ship` for the same repo simultaneously will race on `status.yaml`. Rare in practice; serialize manually if it bites.

## Next

Try this on a real two-repo feature in your monorepo or polyrepo. Start small — a single endpoint with a single UI element is enough to feel the rhythm.

When you find the pain points (and you will), they tell you what to upgrade next: maybe auto-pull, maybe a different contract format, maybe a `feature status --all` view. The factory grows in the direction of the friction.
