---
id: ui
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/ui: design tokens, fonts, icons, the kit components and safeHref."
code: [shared/ui/index.ts]
sources: []
importance: normal
related: ["[[web]]", "[[ui-build]]", "[[islands]]", "[[copied-svg-committed-as-txt]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-23
---
# ui

**What it owns.** Generic UI with no product meaning, MIT-licensed.

**Parts.**
- `sheet/`: a pinned copy of the unset.sh design sheet; each file's sha256 is in `sheet/source.json`.
- The build code for the generated files (tokens, contrast, font metrics, icons) lives in [[ui-build]]; the Node
  entries that run it are in `scripts/ui/`. `tokens/font-metrics.ts` owns the shape of `font-metrics.json`.
- `src/tokens.css`, `src/base.css`, `src/layers.css`: generated tokens and base styles.
- `icons/`: the 36 imported plus five hash-registered Iconoir 7.12.1 icons (P2.24f: devices, apps; P2.13e: bulb-off, bulb-on, tv), copied byte for byte, plus the generated `icons.json` allowlist and one
  generated `drawings/<name>.generated.ts` per icon. `components/Icon/` renders them: pages use `<Icon name>`;
  islands use `IconDrawing` with the one drawing module they need, because `icons.json` is about 5 KB gzip and would
  not fit the island budget. No icon npm package and nothing fetched at runtime (decision 33).
- `components/<Name>/`: the kit, one folder per sheet component (TSX, `.module.css` in `@layer components`, test).
  They render on the server with no JS; field parts shared by Input, Textarea, Select, Checkbox and RadioGroup are in
  `components/Input/field.tsx`. `css-modules.d.ts` types the class maps. `showcase/` renders every built component
  for P1.26's axe and target-size checks. `index.ts` exports only what the screens use: Button, Callout, Input, Link (P2.05),
  Checkbox (P2.12, server-rendered, no island), RadioGroup (P1.25f's footer theme form), Avatar and Card (P2.13c's account and settings pages) and the shell's Footer, Header, SkipLink (P1.25). The boot chunk no longer imports this index: `readProps` comes from [[islands]] (P1.25p),
  after an earlier re-export pulled the kit into boot (P1.25h; architecture record 2026-10-07-p125h-boot-chunk.md).
  Re-measure with `scripts/budgets/island.ts` before exporting more components.
- `islands/`: the kit's `*.island.tsx` files. Each island's component sits beside its kit component. define, slot,
  the props serialiser and the browser reader are [[islands]] (`@unset/shared-islands`); this index does not
  re-export them. The old copies here are gone: P1.25p deleted `islands/define.ts` and `islands/slot.ts`, and
  P1.25e `islands/props.ts` and `src/islands/readProps.ts`.
- `safe-href.ts`: the one link validator, exported from `index.ts`. Trusted base. Button and Link take only its
  `SafeHref`.
- `inventory.json`: the registered components. A new component needs Alex's approval on the sheet.
- `components/Navigation/`: the approved core rail and phone bar, composed from Avatar and Icon with a native
  popover. Its local README records the Figma extension without changing the imported sheet snapshot. Header's
  `brandOnly` mode delegates to pure BrandHeader for the 64px/56px top logo bar and localized home name; Avatar
  accepts anonymous fallback artwork. Generic link rendering, start/end item placement and an explicit committed
  navigation key support hydrated consumers without importing their routing/state. Hydrated labels appear on
  hover/focus and dismiss on Escape; SSR/no-JS retains native title and accessible-name fallback. Alex's
  2026-10-21 browser revision removes the popup Close control and lifts only current phone artwork within
  stationary targets; `closeLabel` stays optional/deprecated for callers. Native toggle/dismissal remains intact.
- `presentation.ts` / the explicit `./presentation` package export: Navigation, Button, Input, Icon, Avatar,
  safeHref and needed types only. `./brand-header` points directly to the pure BrandHeader module. Use these entries
  for browser presentation: the root barrel still imports full Header and its island runtime. Native Button callbacks,
  refs and ARIA/title props keep action/pending state in the caller. Input is unchanged.
- `approved-extensions.json`: P2.24f's bounded component/API/icon record, hash-pinned on existing Navigation,
  Header, Button and Icon inventory rows; imported sheet bytes/metadata stay immutable. The generator verifies the
  exact two additional copied sources and records separate extensionProvenance in the 38-name output.

**Rules worth knowing.** `shared/ui` imports no Node built-in (dependency-cruiser). Node never loads `index.ts`:
[[ui-build]] imports it for types only (P1.25h). The 0x40 "v2e" look is superseded; follow only
the design sheet. Native Table, CodeBlock, CommandBlock and Kbd tags reuse base.css for identical
properties; keep the base sheet before component layers, as Input already requires.

**Header action as a dialog button (P2.05p).** A `NavLink` with `dialog` renders as a `type="button"` with
`commandfor` and `command="show-modal"` (invoker commands; React 19.3 passes the unknown attributes through), styled
by Button's module like the link; the island schema accepts only lowercase hyphenated ids.

**Links.** ADR 0016 (design source), [[web]].
