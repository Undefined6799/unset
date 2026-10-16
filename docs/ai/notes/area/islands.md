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
- `define.ts`, `props.ts`, `slot.ts` and `readProps.ts` are the runtime. `readProps.ts` imports `./props.ts`.
  P1.25e deleted the shared/ui originals (`islands/props.ts`, `src/islands/readProps.ts`), their tests, and
  `tests/move-parity.test.ts` (`docs/ai/book/phase-1.md`).
- `index.ts`: the only file another workspace may import (DC-2). The kit, each `*.island.tsx`, `hydrate.ts` and
  apps/web import this index, never a subpath.

**How data flows.** An island's props are serialised here and read back in the browser by `readProps`.

**Links.** [[ui]], `docs/ai/book/phase-1.md` P1.25p.
