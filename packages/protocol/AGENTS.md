# @the-hive/protocol

Base package. Types, interfaces, schemas. No logic, no side effects.

## Two Entrypoints

- `wire/` — stable public API. What crosses process boundaries (server <-> CLI). Breaking changes require major version bump.
- `engine/` — internal shared contracts. Can change freely.

## Deciding Where a Type Goes

- Does it cross a process boundary? -> `wire/`
- Is it only used between internal packages? -> `engine/`

## Rules

- No runtime logic. Types and interfaces only.
- No dependencies on any other `@the-hive/*` package.
- No external dependencies.
- When modifying `wire/`, consider backward compatibility.
- When modifying `engine/`, ensure no import from `cli` references it.
