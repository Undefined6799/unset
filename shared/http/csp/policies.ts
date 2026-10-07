// The CSP of each route group (P1.08; plan §5.1, §5.2 media sandbox, §5.4 zero-JS profiles). The origins come only
// from config; the sources can only be the shapes in sources.ts.
import type { RouteGroup } from "../routes.ts";
import type { ConfigOrigin, Directives, Source } from "./sources.ts";

/** The origins the policies name. `devVite` is set only when UNSET_ENV is dev (config.ts refuses it otherwise). */
export type CspOrigins = Readonly<{ assets: ConfigOrigin; media: ConfigOrigin; devVite?: ConfigOrigin }>;

const LOCKED = {
  "form-action": ["'self'"],
  "base-uri": ["'none'"],
  "frame-ancestors": ["'none'"],
} as const;

/** The page policy shared by `app` and `admin`; the admin server shows no media, so its `img-src` is `'self'`. */
function pagePolicy(origins: CspOrigins, images: "with-media" | "self-only"): Directives {
  const assets: Source = { originPath: origins.assets, path: "/assets/" };
  const dev = origins.devVite;
  return {
    "default-src": ["'none'"],
    "script-src": dev ? [assets, { origin: dev }] : [assets],
    "style-src": [assets],
    "img-src": images === "with-media" ? ["'self'", { origin: origins.media }] : ["'self'"],
    "font-src": [assets],
    "connect-src": dev ? ["'self'", { origin: dev }, { websocket: dev }] : ["'self'"],
    ...LOCKED,
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
    "require-trusted-types-for": ["'script'"],
    "trusted-types": ["'none'"],
  };
}

/**
 * Every group's policy. `profile` has no `script-src` at all: a profile page runs no script (plan §5.4). `public`
 * (P1.25: our own zero-JS pages such as / and /terms; architecture record 2026-10-07-p125-public-route-group.md) has
 * none either, and its images are the build's own (favicons), never user media.
 */
export function policiesFor(origins: CspOrigins): Readonly<Record<RouteGroup, Directives>> {
  const assets: Source = { originPath: origins.assets, path: "/assets/" };
  return {
    app: pagePolicy(origins, "with-media"),
    admin: pagePolicy(origins, "self-only"),
    public: {
      "default-src": ["'none'"],
      "img-src": [assets],
      "style-src": [assets],
      "font-src": [assets],
      ...LOCKED,
      "object-src": ["'none'"],
      "manifest-src": ["'self'"],
    },
    profile: {
      "default-src": ["'none'"],
      "img-src": [{ origin: origins.media }],
      "style-src": [assets],
      "font-src": [assets],
      ...LOCKED,
    },
    static: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    media: { "default-src": ["'none'"], sandbox: true },
    api: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
  };
}
