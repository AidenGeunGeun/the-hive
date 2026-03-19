# @the-hive/workflow

Pure state machine reducer. Zero side effects.

## Owns

- Task lifecycle: submitted -> running -> awaiting_review -> approved/rejected/failed/cancelled.
- Internal phases: mini_rooms -> synthesis -> [query_back -> synthesis] -> rendering -> rerun.
- Escalation logic (ledger handoff between stages).
- Query-back job emission.

## Does Not Own

- Persistence (storage).
- Job dispatch (server).
- Room execution (room).

## Rules

- Deps: `@the-hive/protocol` only.
- `apply(command, state) -> { newState, events, jobs }`. Pure function.
- Zero I/O. Zero persistence. Zero network.
- Fully testable without a server, database, or network.
