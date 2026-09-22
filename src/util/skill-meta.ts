/**
 * Skill description extraction, shared by every adapter that needs a
 * `description` in skill frontmatter (Claude Code skills, Kiro Agent Skills).
 * Kept here so the two can't drift — both platforms match a request against
 * this text to decide whether to invoke the skill, so it has to be the real
 * trigger prose, not a title.
 */

/**
 * Pull the first real prose paragraph out of a skill body.
 *
 * Skips leading markdown headings: every prompt opens with a `# Title`, which
 * must NOT become the description — a title says what the skill is called, not
 * when to use it.
 *
 * @param maxLength platform cap on the description field.
 */
export function skillDescription(body: string, maxLength: number): string | null {
  const paragraphs = body.trim().split(/\n\s*\n/);
  for (const para of paragraphs) {
    const prose = para
      .split("\n")
      .filter((line) => !/^\s*#{1,6}\s/.test(line)) // drop heading lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (prose) {
      return prose.length > maxLength ? prose.slice(0, maxLength - 3) + "..." : prose;
    }
  }
  return null;
}
