# 0038 — Explicit undo boundaries for editor block actions

Status: Proposed (implementation ready for review)

## Context

Moving a README block is an explicit action. BlockNote 0.56.0's `transact` batches the move but its existing
ProseMirror history can group adjacent typing before and after it into the same undo event. A real-editor test
reproduces one Undo reverting both the move and recently typed text.

## Decision

Declare `prosemirror-history` 1.5.1 directly in apps/web and use its public `closeHistory` API before and after
the move. This exact package is already locked and shipped through BlockNote; there is no additional resolved
package, version change, editor UI dependency, network call or storage mechanism.

## Alternatives

- Keep `transact` alone: avoids a direct import, but fails the requirement that Undo reverses only the move.
- Depend on internal history plugin keys or timestamp manipulation: avoids the declaration while coupling the
  adapter to undocumented implementation details.

## Consequences

Typing before the move, the move itself, and subsequent typing undo separately. The import remains confined to
the existing editor adapter. Dependency updates must keep the direct pin aligned with BlockNote's history engine.

## Compliance

D8 records the direct runtime dependency; DO-3 source checked at
`node_modules/prosemirror-history/src/history.ts` (1.5.1), exported `closeHistory`.
`apps/web/src/editor/block-actions.test.ts` tests consecutive undo and preservation of nested content.
