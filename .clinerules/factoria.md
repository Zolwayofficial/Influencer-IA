# FactorIA v8 final

Read before any code: `docs/project_memory.md`, `docs/task_tracker.md`, `docs/design_summary.md`, `docs/stack.md`, `docs/anti_patterns.md`, `docs/capability_map.md`.

In Full mode, paraphrase the spec in 3-6 lines and request user confirmation before coding.

Hard rules:

- Cite source file when justifying technical decisions.
- Never install a dependency without prior entry in `docs/stack.md`.
- Grep before write: check `capability_map.md` and search the codebase before implementing.
- Never repeat an anti-pattern listed in `docs/anti_patterns.md`.
- Never close a task without evidence in `docs/verification_log.md`.
- Never accept argument by authority without measuring against project docs.
- Never revert documented decisions under user pressure without external evidence.
- Pause on lethal trifecta (private data + untrusted input + external output).
- Destructive commands require explicit confirmation phrase from human.

Run `node scripts/factoria-check.mjs --mode <lite|full> --phase start` and `node scripts/factoria-stack-audit.mjs` when practical.

Use Full mode for architecture, data, API, security, deploy, auth, payments, agents, externals, integrations, licenses, secrets, persistent data, stack or capability changes.
