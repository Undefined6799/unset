# 0055 — shadcn-svelte components, themed by one file in the repo

Status: Proposed. Supersedes ADR 0016 (proposed) when accepted.

## Context
On 2026-11-17 Alex chose shadcn-svelte (Bits UI underneath, Tailwind 4) over our 34 hand-built components and Panda
CSS, asked to keep the components nearly stock and theme them only, and said the design sheet is a reference, not a
pinned or hashed source. He also asked that the app and the PDS screens share one theme.

## Decision
1. Components are shadcn-svelte, copied into `apps/web` at a pinned registry version and kept stock. A change to one
   needs a real need, recorded in that file.
2. Tailwind utility classes appear only inside those component files and the app shell; pages compose components.
3. One theme file in the repo holds the shadcn variables for light and dark, seeded from the design sheet. Later
   sheet changes reach it by pull request. The PDS screens (ADR 0027) read the same file.
4. Icons stay Iconoir (decision 33): the Lucide imports in shadcn components are swapped for our `Icon` component.
5. Only the components today's screens need are added.

## Alternatives
- **Keep our 34 hand-built components and CSS Modules.** Known and reviewed, but every component is ours to maintain,
  and Alex chose standard components.
- **Panda CSS with our own components.** Chosen and then dropped by Alex on 2026-11-17 once shadcn-svelte covered
  what the app needs.
- **Bits UI with no shadcn layer.** Fewer copied files, but each component's styling would be ours to write.

## Consequences
- Two stock components fail `exactOptionalPropertyTypes`; ADR 0056 records the web folder's exception.
- The select placeholder fails colour contrast with the seeded theme; the theme file fixes it, not the component.
- The `shared/ui` inventory test and its approval rule cover the new components in place of the old ones.

## Compliance
The `shared/ui` inventory test lists the components and fails on one that is not listed. The icon guard keeps
icons to the Iconoir data; Biome's CSS rules and a lint rule added in P1.20c keep utility classes out of pages.
