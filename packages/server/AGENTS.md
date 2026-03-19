# @the-hive/server

Runtime host. Composition root. Sole write authority.

## Owns

- Authoritative state writes (calls workflow reducer, persists via storage).
- Job dispatch (receives jobs from workflow, dispatches to rooms).
- WebSocket API (protocol/wire messages only).
- Headless mode (runs without UI connected).
- Wiring all packages together.

## Does Not Own

- Deliberation logic (room).
- State machine logic (workflow).
- Persistence implementation (storage).
- UI rendering (cli).

## Rules

- Deps: protocol, workflow, storage, config, providers, room, context.
- No other package imports server. This is the composition root.
- All writes go through server -> storage. No shortcuts.
- WebSocket messages use protocol/wire types only.
