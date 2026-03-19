# @the-hive/room

THE discussion room engine. Kernel + policy implementations.

## Owns

- Room kernel: turn sequencing, ledger management, agent lifecycle, room health.
- Built-in policy implementations (turn, stop, memory, failure, artifact).
- Semantic action validation (beyond schema checks).
- Raw turn trace capture.

## Does Not Own

- Task management or escalation (orchestrator/workflow).
- Persistence (storage).
- Provider connections (providers).
- Configuration loading (config).

## Rules

- Deps: `@the-hive/protocol` only.
- Receives agents, policies, and context as runtime arguments.
- Does NOT import config, context, providers, workflow, storage, or server.
- This is the atomic unit. It does not know about tiers, layers, or escalation.
