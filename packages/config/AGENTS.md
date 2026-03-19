# @the-hive/config

Configuration loading, validation, and defaults.

## Owns

- Config types: TeamConfig, RoomConfig, ProviderConfig, AgentConfig, PolicyConfig.
- Loading config from file and validating against schema.
- Sensible defaults so users can start with minimal config.

## Does Not Own

- Runtime types (those are in protocol/engine).
- Any business logic.

## Rules

- Deps: `@the-hive/protocol` only.
- No I/O beyond reading the config file.
- Validate at load time, not at use time. If config passes validation, it is safe to use.
