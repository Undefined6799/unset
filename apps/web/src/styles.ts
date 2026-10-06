// The styles entry (P1.23c; ADR 0015): the browser build's one entry that imports every CSS Module, in apps/web and
// in shared/ui's components, so the build emits their CSS once and the manifest lists it for the document's links.
// The import is exported so the bundler keeps it. Pages never load this module; they link its CSS.
export default import.meta.glob(["./**/*.module.css", "../../../shared/ui/components/**/*.module.css"], {
  eager: true,
});
