# Spike — Tier 1

Research-only chain. Use when the user asks "how does X work", "where is Y handled", or otherwise wants understanding before deciding to build. Runs the researcher agent only and returns findings — no code is written.

## Triage gate — always run first

- If the user is asking for code to be written: respond **"This isn't a spike — it's a build. Switch to `/quick-fix` or `/feature-factory`? (which one)"** and wait.
- Otherwise, proceed.

## Chain sequence

### Step 1 — Research
Invoke `researcher` with the user's question. Wait for the complete output.

### Step 2 — Present findings
Return the researcher's full output to the user, verbatim. Add this framing line at the top:

> **Findings below. No code was changed.** If you want to act on this, reply with what to build and I'll route to the right chain.

Stop.

## Hard rules

- No code is written.
- Do not propose solutions in your own voice.
- Do not edit files as orchestrator.
- If the user then asks to build something, route to `/quick-fix` or `/feature-factory` based on the triage rules in those skills.
