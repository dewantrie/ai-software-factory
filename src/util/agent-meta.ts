/**
 * Platform-neutral one-line descriptions per agent. Used by adapters that need a
 * `description` field (Claude Code subagent frontmatter, Kiro CLI agent config).
 * Kept here, shared, so the descriptions can't drift between platforms.
 *
 * Note: the wording mentions "CLAUDE.md" for the builders only as a familiar
 * example of the per-repo context file; each adapter renders the actual context
 * file name into the agent body via `{{CONTEXT_FILE}}`.
 */
export const DESCRIPTIONS_BY_AGENT: Record<string, string> = {
  researcher: "Read-only codebase mapper. Invoke first in any feature, fix, or spike.",
  "story-writer": "Turns a rough feature request into a user story with acceptance criteria. Read-only.",
  "spec-writer": "Turns an approved story into a technical brief. Read-only.",
  "migration-author":
    "Writes DB schema migrations safely (backfill-before-NOT-NULL, online indexes, drop-column dance). Scoped to migrations paths only. Skips if the brief has no data model changes.",
  "backend-builder": "Implements backend-only changes per the context file's path scoping. Cannot touch frontend or migrations.",
  "frontend-builder": "Implements frontend-only changes per the context file's path scoping. Consumes backend's API contract verbatim.",
  "devops-builder":
    "Implements CI/CD and IaC changes (GitHub Actions, Terraform, Helm, Docker). Scoped to infra paths only. Skips if the brief has no infra changes.",
  "test-verifier": "Writes acceptance tests against the user story. Edits only test files.",
  "security-reviewer":
    "Read-only OWASP-flavored security audit. Reports findings by severity (Critical / Important / Minor) with file:line.",
  "performance-reviewer":
    "Read-only performance audit. N+1 queries, unbounded loops, hot-path issues. Reports findings by severity with file:line.",
  validator:
    "Compares implementation against story + brief. Read-only. Reports gaps by severity. Security and performance concerns are delegated to dedicated reviewers.",
  "doc-writer": "Writes CHANGELOG entries, README updates, migration guides for breaking changes. Scoped to docs paths only.",
};

export function descriptionFor(agentName: string): string {
  return DESCRIPTIONS_BY_AGENT[agentName] ?? `${agentName} agent.`;
}
