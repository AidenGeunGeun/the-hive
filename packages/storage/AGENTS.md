# @the-hive/storage

SQLite persistence. Only package that touches the database.

## Owns

- SQLite schema and migrations.
- Repositories (task, room, ledger, event).
- Ledger store (decision authority).
- Turn trace store (audit only).
- Workflow event log (task state authority).
- Snapshots (recovery optimization, derived).

## Persistence Authority Model

- Workflow event log = authoritative for task state.
- Ledger store = authoritative for decisions.
- Turn trace store = audit only. Not consumed during normal operation.
- Snapshots = derived. Not authoritative.

## Rules

- Deps: `@the-hive/protocol` only.
- Only package that touches SQLite.
- Only `server` writes to storage. No direct writes from other packages.
- All stores are append-only.
