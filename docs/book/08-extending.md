# 08 — Extending the Factory

Recipes for the changes you'll actually make. Each one is small *because* of the
four-primitive separation (Chapter [01](01-concepts.md)): a change touches one axis.

Golden rule for all of them: **write a test, run `pnpm test` and `npx tsc --noEmit`,
commit.** The suite is fast (~100 tests, sub-second) and the generated-code tests
execute the real output, so they catch the subtle breakage.

---

## Recipe A — Add a stack profile

**Touches:** `profiles/` (+ optionally `src/util/detect-stack.ts`).

1. Copy the closest existing profile to `profiles/<your-stack>.md`.
2. Rewrite the four prose sections (stack assumptions, architecture rules, don't-do,
   conventions) for your stack.
3. Set least-privilege `Default paths` (Chapter [06](06-profiles.md)): migrations under
   `migrations`, CI/containers under `infra`, docs under `docs`, secrets under
   `forbidden`. Frontend/library stacks omit `migrations`.
4. (Optional) Teach auto-detection: add a branch to `detectStack()` in
   `src/util/detect-stack.ts` (e.g. "if `deno.json` exists → this profile"). Add a case
   to `test/detect-stack.test.ts`.

No code change is required for the profile to *work* — `factory install` reads whatever
profile a manifest names. Detection is just the convenience that makes `factory init`
suggest it.

---

## Recipe B — Add a new platform adapter (e.g. Cursor, Windsurf)

**Touches:** `src/manifest.ts` (the `Platform` union + `validPlatforms`),
`src/platforms/<name>.ts`, `src/platforms/index.ts` (registry), `test/adapters.test.ts`.

1. Add the platform name to the `Platform` union and the `validPlatforms` array in
   `src/manifest.ts`.
2. Create `src/platforms/<name>.ts` implementing `PlatformAdapter`. Use `buildContextFile()`
   for the context document and `render(body, { CONTEXT_FILE: "<the file>" })` for each
   prompt. Follow `kiro.ts` as the closest "no native subagents" model.
3. Import + register it in the `registry` in `src/platforms/index.ts`.
4. Add an adapter test mirroring the kiro/codex blocks in `test/adapters.test.ts`
   (assert the file set, `{{CONTEXT_FILE}}` substitution, no leftover template vars). Update
   the "exactly the … platforms" registry test.

If the platform has a real enforcement seam, wire path scoping: a pre-edit `PreToolUse`-style
hook (reuse `assets/factory-guard.mjs`, like Claude Code / Kiro CLI) or a post-run check
(like Codex's `factory-check.mjs`). **Verify it against the real tool before claiming it's
enforced** — Cursor and Windsurf are rules-file tools with no such seam, which is why they
aren't shipped: an adapter would be prompt-only. Document any prompt-only limitation in the
adapter's `FACTORY.md`, like kiro/codex do.

---

## Recipe C — Add or change an agent

**Touches:** `prompts/agents/<name>.md`, `src/platforms/claude-code.ts`, the relevant
orchestrator skill, possibly Chapter-[04] enforcement.

1. Write `prompts/agents/<name>.md` — platform-neutral, using `{{CONTEXT_FILE}}` for any
   reference to the context doc. No stack or platform specifics.
2. In `src/platforms/claude-code.ts`:
   - Add an entry to `TOOLS_BY_AGENT` (read-only → `Read, Grep, Glob`; builder → add
     `Edit, Write, Bash`).
   - Add a one-line `DESCRIPTIONS_BY_AGENT` entry (this drives Claude's auto-invocation —
     make it a real "what + when").
   - **If it edits files**, add it to `ALLOW_KEY_BY_AGENT` mapping it to a manifest path
     key (Chapter [04](04-path-enforcement.md)), so it gets an enforced allow-list.
3. Wire it into the chain: edit `prompts/skills/feature-factory.md` (and/or `quick-fix`)
   to invoke it at the right step, with the right hand-off inputs.
4. The kiro/codex adapters pick up new agents automatically (they iterate the prompts
   dir); for codex, check whether the orchestrator script needs a new step.

To change an *existing* agent's behavior, edit only its prompt — that's the high-leverage
move. The validator's checklist is the one most worth tuning.

---

## Recipe D — Add a path-scoping key (a new agent domain)

This is the multi-file one; it's the worked example of how a single concept threads
through the primitives. (This is exactly how `migrations`/`infra`/`docs` were added.)

**Touches, in order:**

1. `src/manifest.ts` — add the key to the `Paths` interface.
2. `src/render.ts` — add a block in `buildContextFile` so the key renders under
   "Path scoping for agents" (guarded by `&& .length > 0`). Add a `test/render.test.ts`
   case.
3. `src/util/profile-defaults.ts` — add the key to the `ProfileDefaults["paths"]` type.
4. `src/commands/init.ts` — add the key to the `as const` array in `composeManifest`.
5. `src/platforms/claude-code.ts` — map the owning agent in `ALLOW_KEY_BY_AGENT` (and
   ensure that agent is a builder with edit tools). The per-agent hook + config flow then
   enforce it automatically.
6. `profiles/*.md` — add sensible least-privilege defaults for the key.
7. `README.md` + this book — document it.

The TypeScript compiler is your guide here: after step 1, `tsc` errors point you at every
consumer that must learn the key (steps 3–4 are forced by `tsc`; steps 2/5 are behavior).

---

## Recipe E — Extend the guard's glob engine

**Touches:** `assets/factory-guard.mjs` (the real guard script),
`test/factory-guard.test.ts` (direct unit tests), and optionally `test/guard.test.ts`
(adapter-wired integration tests).

The guard is a **real, committed `.mjs` file** at `assets/factory-guard.mjs`. The Claude
Code adapter copies it verbatim into each repo's `.claude/hooks/` (`copyFileSync`,
`GUARD_ASSET_PATH` in `claude-code.ts`) and writes `factory-scope.json` beside it. So:

- **Edit the script directly** — it's ordinary JavaScript, no template-string escaping.
  The glob→regex logic (`globToRegExp`, supporting `**`, `*`, `?`, `{a,b}`) lives there.
- **Test it directly.** `test/factory-guard.test.ts` copies the asset + a hand-written
  `factory-scope.json` into a temp dir and runs real payloads through it — no adapter
  needed. Add cases there (e.g. the brace-glob `{a,b}` support, added after a review caught
  that `*.test.{ts,tsx}` matched nothing). `test/guard.test.ts` separately covers the
  script as wired by the adapter.

> The guard used to live as an escaped template literal inside `guardScript()` — the
> doubled-backslash fragility caused two real bugs. It was refactored to this static-asset
> form (see Chapter [09](09-design-decisions.md) D9).

---

## Where tests live

All tests are in `test/*.test.ts` (Vitest). The split mirrors the source: `manifest`,
`render`, `profile-defaults`, `detect-stack`, `contracts`, `workspace`, `adapters`,
`guard`, `feature`. When you add behavior, add to the matching file. For anything that
generates code (adapters, guard), **execute the generated output** in the test rather than
asserting on its source — that's the pattern that catches real bugs.

Next: [09 — Design decisions](09-design-decisions.md).
