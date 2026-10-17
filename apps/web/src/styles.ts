// The styles entry (P1.23c; ADR 0015): the browser build's one entry that imports every CSS Module, in apps/web and
// in shared/ui's components, so the build emits their CSS once and the manifest lists it for the document's links.
// Pages never load this module; they link its CSS. Each import carries the `styles-entry` query, so vite.config.ts
// empties its JS and the entry emits CSS only (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-
// budget.md, section 2): its class-name maps no longer count in the island JS total.
// P1.25: the global sheets come first, layers.css before anything else so each layer's place is fixed (P1.21), then
// the tokens with the two font faces, whose files the build emits for the shell to preload. They are globs too: Vite
// hoists an eager glob's imports above the module's own `import` lines, which would put every component rule first.
import.meta.glob("../../../shared/ui/src/layers.css", { eager: true });
import.meta.glob("../../../shared/ui/src/tokens.css", { eager: true });
import.meta.glob("../../../shared/ui/src/base.css", { eager: true });
import.meta.glob(["./**/*.module.css", "../../../shared/ui/components/**/*.module.css"], {
  eager: true,
  query: "?styles-entry",
});
