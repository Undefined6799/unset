---
id: ui
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/ui: design tokens, fonts, icons, the kit components, island helpers and safeHref."
code: [shared/ui/index.ts]
sources: []
importance: normal
related: ["[[web]]", "[[ui-build]]", "[[copied-svg-committed-as-txt]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-07
---
# ui

**What it owns.** Generic UI with no product meaning, MIT-licensed.

**Parts.**
- `sheet/`: a pinned copy of the unset.sh design sheet; each file's sha256 is in `sheet/source.json`.
- The build code for the generated files (tokens, contrast, font metrics, icons) lives in [[ui-build]]; the Node
  entries that run it are in `scripts/ui/`. `tokens/font-metrics.ts` owns the shape of `font-metrics.json`.
- `src/tokens.css`, `src/base.css`, `src/layers.css`: generated tokens and base styles.
- `icons/`: the 36 Iconoir 7.12.1 icons, copied byte for byte, plus the generated `icons.json` allowlist and one
  generated `drawings/<name>.generated.ts` per icon. `components/Icon/` renders them: pages use `<Icon name>`;
  islands use `IconDrawing` with the one drawing module they need, because `icons.json` is about 5 KB gzip and would
  not fit the island budget. No icon npm package and nothing fetched at runtime (decision 33).
- `components/<Name>/`: the kit, one folder per sheet component (TSX, `.module.css` in `@layer components`, test).
  They render on the server with no JS; field parts shared by Input, Textarea, Select, Checkbox and RadioGroup are in
  `components/Input/field.tsx`. `css-modules.d.ts` types the class maps. `showcase/` renders every built component
  for P1.26's axe and target-size checks. `index.ts` does not export the components: the browser's boot chunk imports
  the index (`readProps`), so a component export pulls the kit and its islands into boot (P1.25h; architecture record
  2026-10-07-p125h-boot-chunk.md). The island runtime moves to its own workspace first.
- `islands/`: what an island file exports, the props serialiser, `IslandSlot` (how a kit component places an island)
  and the kit's `*.island.tsx` files; each island's component sits beside its kit component. `src/islands/readProps.ts`
  reads props in the browser.
- `safe-href.ts`: the one link validator, exported from `index.ts`. Trusted base. Button and Link take only its
  `SafeHref`.
- `inventory.json`: the registered components. A new component needs Alex's approval on the sheet.

**Rules worth knowing.** `shared/ui` imports no Node built-in (dependency-cruiser). Node never loads `index.ts`:
[[ui-build]] imports it for types only (P1.25h). The 0x40 "v2e" look is superseded; follow only
the design sheet.

**Links.** ADR 0016 (design source), [[web]].
