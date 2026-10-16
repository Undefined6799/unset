// Shared UI (MIT). The island runtime lives in @unset/shared-islands (P1.25p,
// docs/ai/book/phase-1.md). This index does not re-export it.

// P2.05: the kit components the first screens use (P1.25 exports the rest with the app shell).
export { Button, type ButtonProps } from "./components/Button/Button.tsx";
export { Callout, type CalloutProps } from "./components/Callout/Callout.tsx";
export { Input, type InputProps } from "./components/Input/Input.tsx";
export { Link, type LinkProps } from "./components/Link/Link.tsx";
// P1.24h: the one link validator; every component link takes its SafeHref.
export { type HrefScheme, type SafeHref, safeHref } from "./safe-href.ts";
// P1.25h: the shape of tokens/font-metrics.json, which @unset/shared-ui-build produces.
export type { FallbackFace, FontMetrics } from "./tokens/font-metrics.ts";
