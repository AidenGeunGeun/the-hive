# @the-hive/cli

Stateless WebSocket client. Terminal UI.

## Owns

- Terminal rendering: task status, deliberation progress, approve/reject flow.
- Human interaction point.

## Does Not Own

- Any business logic. Pure view layer.
- State. All state comes from server via WebSocket.

## Rules

- Deps: `@the-hive/protocol/wire` ONLY.
- Never import from `protocol/engine`. Never import any other package.
- Enforced by CI.
