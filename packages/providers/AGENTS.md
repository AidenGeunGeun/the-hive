# @the-hive/providers

Model/provider adapters over pi-ai. Only package that imports provider SDKs.

## Owns

- Unified provider interface over `@mariozechner/pi-ai`.
- Capability matrix (structured output, tool calling, context limits, cost).
- Structured-output normalization across providers.
- Retry and rate-limit handling.

## Does Not Own

- Agent behavior (room's concern).
- Which models to use (config's concern).

## Rules

- Deps: `@the-hive/protocol`, `@mariozechner/pi-ai`.
- Only package that imports pi-ai or any provider SDK.
- No other package should talk to LLM APIs directly.
