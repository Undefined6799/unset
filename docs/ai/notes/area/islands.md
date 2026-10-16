---
id: islands
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/islands: the island runtime the kit, islands and apps/web import."
code: [shared/islands/index.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[ui]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-16
---
# islands

**What it owns.** The island runtime as `@unset/shared-islands` (P1.25i, P1.25p, `docs/ai/book/phase-1.md`).
MIT-licensed. `safeHref` stays in [[ui]].

**Files.**
- `define.ts`, `props.ts`, `slot.ts` and `readProps.ts`. `readProps.ts` is the only file whose import specifier
  changed when it was copied (`../../islands/props.ts` to `./props.ts`). `tests/move-parity.test.ts` reads the
  shared/ui originals by path. A missing `define.ts` or `slot.ts` original is allowed (P1.25p deleted them); a
  missing `props.ts` or `readProps.ts` original is not, and a missing copy never is.
- `index.ts`: the only file another workspace may import (DC-2). The kit, each `*.island.tsx`, `hydrate.ts` and
  apps/web import this index, never a subpath. P1.25e deletes the trusted originals still in [[ui]].

**How data flows.** An island's props are serialised here and read back in the browser by `readProps`. The old
`props.ts` and `readProps.ts` in [[ui]], and their tests, stay until P1.25e. [[ui]]'s index no longer exports them.

**Links.** [[ui]], `docs/ai/book/phase-1.md` P1.25p.
