# @the-hive/context

Builds immutable ContextBundles from documentation, schemas, and manifests.

## Owns

- ContextBundle construction from multiple sources (AGENTS.md, API schemas, dependency manifests, DB schemas, architecture docs).
- Staleness detection (last-verified timestamps per section).
- Source parsing and normalization.

## Does Not Own

- How agents consume bundles (that is room's concern).
- What context agents need (that is a config/domain decision).

## Rules

- Deps: `@the-hive/protocol` only.
- Bundles are immutable once built. No mutation after creation.
- Every section must carry staleness metadata.
