---
id: ui
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/ui: design tokens, fonts, icons, the Icon component, island helpers and safeHref."
code: [shared/ui/index.ts]
sources: []
importance: normal
related: ["[[web]]", "[[copied-svg-committed-as-txt]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-06
---
# ui

**What it owns.** Generic UI with no product meaning, MIT-licensed.

**Parts.**
- `sheet/`: a pinned copy of the unset.sh design sheet; each file's sha256 is in `sheet/source.json`.
- `scripts/`: pure build functions (tokens, contrast, font metrics, icons). The Node entries that call them live in
  `scripts/ui/`. Each generated file has a freshness test.
- `src/tokens.css`, `src/base.css`, `src/layers.css`: generated tokens and base styles.
- `icons/`: the 36 Iconoir 7.12.1 icons, copied byte for byte, plus the generated `icons.json` allowlist.
  `components/Icon/` renders them. No icon npm package and nothing fetched at runtime (decision 33).
- `islands/`: what an island file exports, and the props serialiser. `src/islands/readProps.ts` reads props in the
  browser.
- `safe-href.ts`: the one link validator. Trusted base.
- `inventory.json`: the registered components. A new component needs Alex's approval on the sheet.

**Rules worth knowing.** `shared/ui` imports no Node built-in (dependency-cruiser), so file access arrives as an
argument. The 0x40 "v2e" look is superseded; follow only the design sheet.

**Links.** ADR 0016 (design source), [[web]].
