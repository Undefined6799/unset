// The Content-Security-Policy of each page group (ADR 0054 decision 4). The `app` group's header is SvelteKit's own
// (kit.csp in vite.config.ts), which adds the hash of its startup script at each build; kit's config is fixed at build
// time and names 'self', so `narrowed` replaces 'self' in script-src, style-src and font-src with the path sources
// files are served from (`/_app/` for the build, `/fonts/` for our fonts). The groups that run no script get fixed
// headers built from the origin here. This file is the web's only CSP source: server.ts sends STATIC_CSP on every
// response, and the hook replaces it on a page with its group's.
import type { PageGroup } from "./policy.ts";

const LOCKED = "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
/** The policy of anything that is not a page: build files, fonts, refusals sent before the hook (server.ts). */
export const STATIC_CSP = "default-src 'none'; frame-ancestors 'none'";

/** The header for the groups that run no script, by group. `app` is SvelteKit's own; this is its fallback. */
export function zeroScriptCsp(origin: string): Readonly<Record<PageGroup, string>> {
  const build = `${origin}/_app/`;
  const fonts = `${origin}/fonts/`;
  return Object.freeze({
    public: `default-src 'none'; img-src ${build}; style-src ${build}; font-src ${fonts}; ${LOCKED}; object-src 'none'; manifest-src 'self'`,
    static: STATIC_CSP,
    app: STATIC_CSP,
  });
}

const FILE_DIRECTIVES: Readonly<Record<string, string>> = {
  "script-src": "/_app/",
  "style-src": "/_app/",
  "font-src": "/fonts/",
};

/**
 * SvelteKit's header with 'self' in the file directives replaced by `${origin}<path>`; every other source kept. With
 * `frames`, the chat door's origin, a `frame-src` of that origin alone is added for the chat box (ADR 0115); kit's
 * `default-src 'none'` frames nothing else.
 */
export function narrowed(header: string, origin: string, frames?: string): string {
  const policy = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [name = "", ...sources] = part.split(/\s+/);
      const path = FILE_DIRECTIVES[name];
      if (path === undefined) return part;
      return [name, ...sources.map((s) => (s === "'self'" ? `${origin}${path}` : s))].join(" ");
    })
    .join("; ");
  return frames === undefined ? policy : `${policy}; frame-src ${frames}`;
}
