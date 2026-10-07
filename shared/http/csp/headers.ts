// The security headers of each route group (P1.08; plan §2 rule 15, §6.1). They are built once at boot from config
// and frozen; the server sets them on every response, error pages included.
import type { HttpKitConfig } from "../config.ts";
import type { RouteGroup } from "../routes.ts";
import { buildCsp } from "./build.ts";
import { type CspOrigins, policiesFor } from "./policies.ts";
import { configOrigin } from "./sources.ts";

export type HeaderSet = Readonly<Record<string, string>>;
type CspConfig = Pick<
  HttpKitConfig,
  "UNSET_ENV" | "PUBLIC_ORIGIN" | "MEDIA_ORIGIN" | "ASSETS_BASE" | "DEV_VITE_ORIGIN"
>;

const GROUPS: readonly RouteGroup[] = ["app", "public", "profile", "static", "media", "admin", "api"];
const PERMISSIONS =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()";

/** The policies' origins from config; a value that is not an exact origin throws ConfigError (exit 78 at boot). */
export function cspOrigins(cfg: CspConfig): CspOrigins {
  const assets = cfg.ASSETS_BASE === "" ? cfg.PUBLIC_ORIGIN : new URL(cfg.ASSETS_BASE).origin;
  return {
    assets: configOrigin(cfg.ASSETS_BASE === "" ? "PUBLIC_ORIGIN" : "ASSETS_BASE", assets),
    media: configOrigin("MEDIA_ORIGIN", cfg.MEDIA_ORIGIN),
    ...(cfg.UNSET_ENV === "dev" && cfg.DEV_VITE_ORIGIN !== ""
      ? { devVite: configOrigin("DEV_VITE_ORIGIN", cfg.DEV_VITE_ORIGIN) }
      : {}),
  };
}

/** The headers every response in `group` carries. Media is embedded from other sites, so it differs in two. */
export function securityHeaders(group: RouteGroup, cfg: CspConfig): HeaderSet {
  const media = group === "media";
  return Object.freeze({
    "content-security-policy": buildCsp(policiesFor(cspOrigins(cfg))[group]),
    "x-content-type-options": "nosniff",
    "referrer-policy": media ? "no-referrer" : "same-origin",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": media ? "cross-origin" : "same-origin",
    "x-frame-options": "DENY",
    "permissions-policy": PERMISSIONS,
    "strict-transport-security": "max-age=63072000; includeSubDomains",
  });
}

/** Every group's headers, built once (step 1). */
export function headerSets(cfg: CspConfig): Readonly<Record<RouteGroup, HeaderSet>> {
  return Object.freeze(Object.fromEntries(GROUPS.map((g) => [g, securityHeaders(g, cfg)]))) as Record<
    RouteGroup,
    HeaderSet
  >;
}
