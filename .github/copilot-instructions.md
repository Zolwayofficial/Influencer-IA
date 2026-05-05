# FactorIA v8 final Instructions

Before suggesting code, you should be aware that this project follows FactorIA. The agent and human operate by reading project docs as source of truth.

## Always read before generating code

- `docs/project_memory.md`
- `docs/task_tracker.md`
- `docs/design_summary.md`
- `docs/stack.md`
- `docs/anti_patterns.md`
- `docs/capability_map.md`

## Hard constraints when generating suggestions

- Do not suggest installing a library that is not declared in `docs/stack.md`. If the project already has a library for the same purpose, use it.
- Do not propose patterns or solutions listed as forbidden in `docs/anti_patterns.md`.
- Do not reimplement capabilities listed in `docs/capability_map.md`. Use the existing capability.
- When justifying a non-trivial choice, reference the source file from which the constraint comes.
- Do not invent test results, security claims, or compatibility statements.
- Do not propose reverting documented decisions in `decision_log.md` without external evidence.
- Flag any task that combines access to private data, exposure to untrusted input, and capability to communicate externally — this is the lethal trifecta and requires explicit human approval.

## Modes

Use Full mode (more thorough docs reading) when the task touches: architecture, data model, API contracts, security, deploy, auth, payments, agents, external services, integrations, licenses, secrets, persistent data, stack changes, or capability changes.
