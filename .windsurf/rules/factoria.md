# FactorIA v8 final

Before code, read: `docs/project_memory.md`, `docs/task_tracker.md`, `docs/design_summary.md`, `docs/stack.md`, `docs/anti_patterns.md`, `docs/capability_map.md`.

The last three are mandatory before technical decisions.

In Full mode, paraphrase the spec in 3-6 lines and request confirmation before coding.

Hard rules:

- Cite source file in technical decisions.
- No dependency install without `docs/stack.md` entry.
- Grep before write: check `capability_map.md` and search the codebase first.
- No repeating documented anti-patterns.
- No closing tasks without evidence in `docs/verification_log.md`.
- No reverting documented decisions under user pressure without external evidence.
- Pause on lethal trifecta (private data + untrusted input + external output).
- Destructive commands require explicit confirmation phrase.

Run `node scripts/factoria-check.mjs` and `node scripts/factoria-stack-audit.mjs` when practical.

Use Full mode for architecture, data, API, security, deploy, auth, payments, agents, externals, integrations, licenses, secrets, persistent data, stack or capability changes.
