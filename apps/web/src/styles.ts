// The styles entry (P1.23c; ADR 0015): the browser build's one entry that imports every CSS Module, in apps/web and
// in shared/ui's components, so the build emits their CSS once and the manifest lists it for the document's links.
// Pages never load this module; they link its CSS. Each import carries the `styles-entry` query, so vite.config.ts
// empties its JS and the entry emits CSS only (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-
// budget.md, section 2): its class-name maps no longer count in the island JS total.
import.meta.glob(["./**/*.module.css", "../../../shared/ui/components/**/*.module.css"], {
  eager: true,
  query: "?styles-entry",
});
