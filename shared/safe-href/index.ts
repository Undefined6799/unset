// The one link validator (P1.24h; moved out of shared/ui in P1.20i so the Svelte UI uses it with no React): every link
// a page renders is a `SafeHref`. No dependencies, browser-safe.
export { type HrefScheme, type SafeHref, safeHref } from "./safe-href.ts";
