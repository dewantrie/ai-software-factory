# 07 — Cross-Repo Features

Some features span repos: the backend emits an API contract, the frontend consumes it.
The story behind that feature should be written **once**, and the contract should pass
between repos in a controlled way. That's what the contracts bridge is for.

Implemented in `src/commands/feature.ts` and `src/util/contracts.ts`.

## The bridge: a contracts repo

Instead of coupling repos directly, the factory uses a separate **contracts repo** as a
neutral meeting point. Each repo points at it via `contracts-repo:` in its manifest (or
`--contracts-repo`). On disk:

```
<contracts-repo>/
└── features/
    └── invoice-reminders/
        ├── story.md            # authored once, shared by every repo
        ├── api.openapi.yaml    # backend writes; frontend reads
        └── status.yaml         # append-only ship log
```

The story lives in one place, so every implementing repo works from the *same*
requirements. The contract file is the hand-off artifact. The status file records who
shipped what, when, at which commit.

## The lifecycle

```
factory feature start <name>     # scaffold features/<name>/{story.md, status.yaml}
                                 #   --from <md> seeds story.md from a PM's export
        ▼  (edit story.md, commit + push the contracts repo)
factory feature pull <name>      # copy story + any contracts into local
                                 #   .factory/features/<name>/  (inputs for the chain)
        ▼  (run the Tier 3 chain in this repo)
factory feature ship <name> \    # record this repo in status.yaml; optionally copy
  --contract <path> --commit SHA #   an emitted contract back into the contracts repo
        ▼
factory feature list             # all features + ship counts
factory feature status <name>    # which repos shipped, when, at what commit
```

A worked two-repo example (backend → contract → frontend) is in
[`docs/cross-repo.md`](../cross-repo.md).

## Design choices worth knowing

- **Filesystem copy, not magic.** `pull` copies files into `.factory/features/<name>/`;
  `ship` copies the contract into the contracts repo and appends to `status.yaml`. It's
  deliberately boring and inspectable — no daemon, no database.
- **`start` is fail-safe.** `--from` is resolved (and the file's required sections are
  checked) *before* the feature directory is created, so a missing/typo'd `--from` path
  never leaves a half-created feature. Small thing, but it's the kind of care that
  prevents confusing half-states.
- **`ship` is idempotent per repo.** Re-shipping the same repo updates its entry in
  `status.yaml` rather than appending a duplicate (`featureShip` finds the existing entry
  by repo name).
- **Identity is derived, overridable.** `ship` reads this repo's name/layer from its
  `.factory.yaml`, or you pass `--repo-name`/`--layer`. So it works even from a repo
  without a manifest, as long as you're explicit.

## What it deliberately does *not* do (yet)

This is an MVP bridge. Known gaps (also in Chapter [09](09-design-decisions.md)):

- **Manual, not chain-integrated.** You run `pull`/`ship` by hand around the chain; the
  orchestrator skill doesn't auto-pull on start or auto-ship on completion. Wiring that
  in is a clean future step.
- **No contract-format validation.** Nothing checks that the backend's emitted contract
  (OpenAPI/proto/Zod) matches what the frontend's spec-writer expects. Today that's a
  human's job at the frontend's CHECKPOINT 2.
- **No locking.** Two people running `ship` on the same repo simultaneously could race
  on `status.yaml`. Rare in practice; noted so nobody assumes otherwise.

The shape is intentionally simple so it can be made smarter later without a rewrite —
the data model (`story.md` + `api.*` + `status.yaml`) is the stable part.

Next: [08 — Extending the factory](08-extending.md).
