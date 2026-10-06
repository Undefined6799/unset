// Client entry that only pulls in every CSS Module, so the production build emits their CSS for SSR pages.
// Exported so the bundler keeps the imports (an unused CSS Module import would be tree-shaken with its CSS).
export default import.meta.glob("/src/**/*.module.css", { eager: true });
