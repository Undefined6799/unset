---
id: islands
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/islands: the island runtime the kit, islands and apps/web import."
code: [shared/islands/index.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[ui]]", "[[web]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-17
---
# islands

**What it owns.** The island runtime as `@unset/shared-islands` (P1.25i, P1.25p, `docs/ai/book/phase-1.md`).
MIT-licensed. `safeHref` stays in [[ui]].

**Files.**
- `define.ts`, `props.ts`, `slot.ts` and `readProps.ts` are the runtime, with their tests beside them. `readProps.ts`
  imports `./props.ts`. No copy is left in shared/ui: P1.25p deleted its `define.ts` and `slot.ts`, and P1.25e its
  `props.ts` and `readProps.ts` with their tests, plus this workspace's parity test (`docs/ai/book/phase-1.md`).
- `index.ts`: the only file another workspace may import (DC-2). The kit, each `*.island.tsx`, `hydrate.ts` and
  apps/web import this index, never a subpath.

**How data flows.** An island's props are serialised here and read back in the browser by `readProps`.

**Links.** [[ui]], [[web]], `docs/ai/book/phase-1.md` P1.25i, P1.25p and P1.25e.
