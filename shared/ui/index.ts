// Shared UI (MIT). The island runtime lives in @unset/shared-islands (P1.25p,
// docs/ai/book/phase-1.md). This index does not re-export it.

// P2.05: the kit components the first screens use; P1.25 adds the app shell's chrome (Footer, Header, SkipLink). A
// screen that needs another component exports it here in its own step, after re-measuring the island budget.
export { Button, type ButtonProps } from "./components/Button/Button.tsx";
export { Callout, type CalloutProps } from "./components/Callout/Callout.tsx";
export { Footer, type FooterProps } from "./components/Footer/Footer.tsx";
export { Header, type HeaderProps } from "./components/Header/Header.tsx";
export { Input, type InputProps } from "./components/Input/Input.tsx";
export { Link, type LinkProps } from "./components/Link/Link.tsx";
export { SkipLink, type SkipLinkProps } from "./components/SkipLink/SkipLink.tsx";
// P1.24h: the one link validator; every component link takes its SafeHref.
export { type HrefScheme, type SafeHref, safeHref } from "./safe-href.ts";
// P1.25h: the shape of tokens/font-metrics.json, which @unset/shared-ui-build produces.
export type { FallbackFace, FontMetrics } from "./tokens/font-metrics.ts";
