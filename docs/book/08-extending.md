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

## Recipe B — Implement a stub adapter (Cursor / Windsurf)

**Touches:** `src/platforms/<name>.ts`, `test/adapters.test.ts`.

1. Read the target layout documented in the stub's comments (`src/platforms/cursor.ts`).
2. Replace the throwing `generate()` with a real one. Use `buildContextFile()` for the
   context document and `render(body, { CONTEXT_FILE: "<the file>" })` for each prompt.
   Follow `kiro.ts` as the closest "no native subagents" model.
3. It's already in the `registry` in `src/platforms/index.ts`, so no wiring needed — just
   make `generate` stop throwing.
4. Add an adapter test mirroring the kiro/codex blocks in `test/adapters.test.ts`
   (assert the file set, `{{CONTEXT_FILE}}` substitution, no leftover template vars).

If the platform supports a `PreToolUse`-style hook, consider porting the path guard
(Chapter [04](04-path-enforcement.md)); if not, document the prompt-only limitation in the
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

**Touches:** the `guardScript()` template in `src/platforms/claude-code.ts`,
`test/guard.test.ts`.

The glob→regex logic is a template literal *string* inside `guardScript()` (it's written
to `.claude/hooks/factory-guard.mjs`). Two cautions:

- **Escaping is load-bearing.** Backslashes are doubled (`"\\\\"` → `"\\"` in the emitted
  file). Change escaping carelessly and you corrupt the generated script. Always verify by
  generating into a temp dir and running the script, not by eyeballing.
- **Test by execution.** `test/guard.test.ts` runs the real `.mjs` with sample payloads
  and asserts exit codes. Add cases there (the brace-glob support, `{a,b}`, was added this
  way after a review caught that `*.test.{ts,tsx}` matched nothing).

> **Architectural note / good first refactor:** the guard script currently lives as an
> escaped template string. A cleaner design is to ship it as a static
> `assets/factory-guard.mjs` file, unit-test it directly, and `copyFileSync` it at install
> (writing the JSON config beside it). That removes the escaping fragility entirely. It's
> listed as future work in Chapter [09](09-design-decisions.md).

---

## Where tests live

All tests are in `test/*.test.ts` (Vitest). The split mirrors the source: `manifest`,
`render`, `profile-defaults`, `detect-stack`, `contracts`, `workspace`, `adapters`,
`guard`, `feature`. When you add behavior, add to the matching file. For anything that
generates code (adapters, guard), **execute the generated output** in the test rather than
asserting on its source — that's the pattern that catches real bugs.

Next: [09 — Design decisions](09-design-decisions.md).
