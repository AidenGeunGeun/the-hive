# The Hive

Multi-agent deliberation system that produces architectural proposals through structured discussion between LLM agents.

## What It Does

The Hive runs structured multi-agent discussions to design software architecture **before** any code is written. Domain-specialized agents debate, challenge, and refine architectural decisions in adversarial discussion rooms. The output is a structured decision ledger and proposal artifact — not code.

## How It Works

1. **Domain rooms** — Small groups of agents discuss within their domain (frontend, backend, database, etc.). Each agent has an adversarial mandate: find flaws before agreeing.
2. **Synthesis room** — Domain leads convene to discuss cross-system concerns, resolve integration conflicts, and produce a unified architectural proposal.
3. **Human gate** — A human reviews the proposal (with full evidence trail) and approves, rejects with feedback, or cancels.

No code is generated. No files are modified. The Hive only deliberates.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Setup

```bash
bun install
bun run build
```

## License

MIT
