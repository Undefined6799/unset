// The CSP's typed allowlist (P1.08; plan §5.1). A source can only be one of these shapes, so no policy can say
// 'unsafe-inline', 'unsafe-eval', 'strict-dynamic', a nonce, `data:`, `https:` or `*`: there is no way to write one.
import { ConfigError } from "@unset/shared-config";

declare const configOriginBrand: unique symbol;
/** An origin that came from loaded config and passed `configOrigin`, never a string built from a request. */
export type ConfigOrigin = string & { readonly [configOriginBrand]: true };

/** A source any fetch directive may list. */
export type Source = "'self'" | "'none'" | { origin: ConfigOrigin } | { originPath: ConfigOrigin; path: "/assets/" };
/** `img-src` and `media-src` may also list `blob:` (Phase 2's upload preview); no other directive can. */
export type ImageSource = Source | "blob:";
/** `connect-src` may also list a dev server's WebSocket form (`ws:` or `wss:`, Vite HMR); nothing else can. */
export type ConnectSource = Source | { websocket: ConfigOrigin };

/**
 * One group's policy. The directives with a single safe value are typed as exactly that value, so
 * `form-action 'self'` is the only form-action any policy can hold.
 */
export type Directives = Readonly<{
  "default-src": readonly ["'none'"];
  "script-src"?: readonly Source[];
  "style-src"?: readonly Source[];
  "img-src"?: readonly ImageSource[];
  "media-src"?: readonly ImageSource[];
  "font-src"?: readonly Source[];
  "connect-src"?: readonly ConnectSource[];
  "form-action"?: readonly ["'self'"];
  "base-uri"?: readonly ["'none'"];
  "frame-ancestors"?: readonly ["'none'"];
  "object-src"?: readonly ["'none'"];
  "manifest-src"?: readonly ["'self'"];
  "require-trusted-types-for"?: readonly ["'script'"];
  "trusted-types"?: readonly ["'none'"];
  sandbox?: true;
}>;

/** `value` as a ConfigOrigin: an http or https origin exactly as `URL` serialises it, else a ConfigError for `key`. */
export function configOrigin(key: string, value: string): ConfigOrigin {
  const parsed = URL.canParse(value) ? new URL(value) : undefined;
  const ok = parsed !== undefined && ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value;
  if (!ok) throw new ConfigError([{ key, reason: "invalid" }]);
  return value as ConfigOrigin;
}

/** The text of one source in a policy. */
export function renderSource(source: ImageSource | ConnectSource | "'script'"): string {
  if (typeof source === "string") return source;
  if ("websocket" in source) return source.websocket.replace(/^http/, "ws");
  if ("originPath" in source) return `${source.originPath}${source.path}`;
  return source.origin;
}
