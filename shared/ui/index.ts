// Shared UI (MIT). The island runtime lives in @unset/shared-islands (P1.25p,
// docs/ai/book/phase-1.md). This index does not re-export it.

export { Avatar, type AvatarProps, type AvatarSize } from "./components/Avatar/Avatar.tsx";
// P2.05: the kit components the first screens use; P1.25 adds the app shell's chrome (Footer, Header, SkipLink).
// P2.12 adds Checkbox for the terms screen. It is server-rendered, like Input, and adds no island.
// P1.25f adds RadioGroup for the footer's theme form, server-rendered the same way.
export { Button, type ButtonProps } from "./components/Button/Button.tsx";
export { Callout, type CalloutProps } from "./components/Callout/Callout.tsx";
export { Card, type CardProps } from "./components/Card/Card.tsx";
export { Checkbox, type CheckboxProps } from "./components/Checkbox/Checkbox.tsx";
export {
  type DescriptionItem,
  DescriptionList,
  type DescriptionListProps,
} from "./components/DescriptionList/DescriptionList.tsx";
export { Footer, type FooterProps } from "./components/Footer/Footer.tsx";
export { BrandHeader, type BrandHeaderProps } from "./components/Header/BrandHeader.tsx";
export { Header, type HeaderProps } from "./components/Header/Header.tsx";
export { Input, type InputProps } from "./components/Input/Input.tsx";
export { Link, type LinkProps } from "./components/Link/Link.tsx";
export {
  Navigation,
  type NavigationAnchorProps,
  type NavigationLinkRenderer,
  type NavigationProps,
} from "./components/Navigation/Navigation.tsx";
export { RadioGroup, type RadioGroupProps } from "./components/RadioGroup/RadioGroup.tsx";
export { SkipLink, type SkipLinkProps } from "./components/SkipLink/SkipLink.tsx";
export { Switch, type SwitchProps } from "./components/Switch/Switch.tsx";
// P1.24h: the one link validator; every component link takes its SafeHref.
export { type HrefScheme, type SafeHref, safeHref } from "./safe-href.ts";
// P1.25h: the shape of tokens/font-metrics.json, which @unset/shared-ui-build produces.
export type { FallbackFace, FontMetrics } from "./tokens/font-metrics.ts";
