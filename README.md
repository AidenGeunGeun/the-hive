# The Hive

Multi-agent deliberation system that produces architectural proposals through structured discussion between LLM agents.

> **Status: Shelved.** Phases 0–5 are complete and working (end-to-end pipeline with 113 passing tests). Development paused after architectural exploration of agentic loop models. The codebase is stable and documented — see [archive/](./archive/) for pivot exploration notes.

## What It Does

The Hive runs structured multi-agent discussions to design software architecture **before** any code is written. Domain-specialized agents debate, challenge, and refine architectural decisions in adversarial discussion rooms. The output is a structured decision ledger and proposal artifact — not code.

## What Works

- **Full end-to-end pipeline:** submit task → context build → domain room deliberation → review packet → human approve/cancel (67ms with scripted agents)
- **9 packages:** protocol, config, context, providers, room, workflow, storage, server, cli
- **113 tests passing** across all packages
- **WebSocket protocol** with real-time event streaming
- **Workflow state machine** (pure reducer, 12 commands, 15 events, full lifecycle)
- **Room kernel** with semantic validation, consensus detection, health monitoring
- **SQLite persistence** with append-only event log, ledger store, turn traces

## How It Works

1. **Domain rooms** — Small groups of agents discuss within their domain (frontend, backend, database, etc.). Each agent has an adversarial mandate: find flaws before agreeing.
2. **Synthesis room** — Domain leads convene to discuss cross-system concerns, resolve integration conflicts, and produce a unified architectural proposal.
3. **Human gate** — A human reviews the proposal (with full evidence trail) and approves, rejects with feedback, or cancels.

No code is generated. No files are modified. The Hive only deliberates.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.
See [PLAN.md](./PLAN.md) for the phased implementation plan.

## Quick Start

```bash
bun install
bun run build
bun run test          # 113 tests
bun run smoke         # End-to-end smoke test
bun run smoke:debug   # With full debug output
```

## License

MIT
