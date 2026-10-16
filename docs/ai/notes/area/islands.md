---
id: islands
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/islands: copies of the island runtime (define, props, readProps, slot) until importers move."
code: [shared/islands/index.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[ui]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-16
---
# islands

**What it owns.** The island runtime as `@unset/shared-islands` (P1.25i, `docs/ai/book/phase-1.md`). MIT-licensed.
`safeHref` stays in [[ui]].

**Files.**
- `define.ts`, `props.ts`, `slot.ts` and `readProps.ts`: copies of the shared/ui originals. `readProps.ts` is the
  only file whose import specifier changed (`../../islands/props.ts` to `./props.ts`). `tests/move-parity.test.ts`
  reads the originals by path and checks the copies are otherwise the same bytes. A missing `define.ts` or `slot.ts`
  original is allowed; a missing `props.ts` or `readProps.ts` original is not, and a missing copy never is.
- `index.ts`: the only file another workspace may import (DC-2). Nothing outside this workspace imports it yet.
  P1.25p points the importers here and deletes the untrusted originals; P1.25e deletes the trusted ones.

**How data flows.** Unchanged in this step. Pages still import the runtime from [[ui]]. This package only holds
the copies.

**Links.** [[ui]], `docs/ai/book/phase-1.md` P1.25i.
