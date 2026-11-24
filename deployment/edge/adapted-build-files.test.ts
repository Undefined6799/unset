// P1.21g (ADR 0069; TE-6): the dev app edge counts a request in app_files instead of app_burst only when it is a
// content-hashed build file, and no other spelling a client can send gets that allowance. The pattern is read from the
// reviewed adapted config (adapted/dev.generated.json), which adapted.image.test.ts holds equal to what the built image
// adapts and adapted-rules.ts pins whole (BUILD_FILE_PATH), so the regular expression tried here is the one Caddy runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { Json } from "./adapted.ts";
import { BUILD_FILE_PATH } from "./adapted-rules.ts";

const DEV = JSON.parse(readFileSync(join(import.meta.dirname, "adapted", "dev.generated.json"), "utf8")) as Json;

/** Every `vars_regexp` pattern on `{http.request.uri.path}` anywhere in the adapted config. */
function patterns(value: Json): string[] {
  if (Array.isArray(value)) return value.flatMap(patterns);
  if (typeof value !== "object" || value === null) return [];
  const own = value.vars_regexp;
  const on = typeof own === "object" && own !== null && !Array.isArray(own) ? own["{http.request.uri.path}"] : null;
  const pattern = typeof on === "object" && on !== null && !Array.isArray(on) ? on.pattern : undefined;
  return [...(typeof pattern === "string" ? [pattern] : []), ...Object.values(value).flatMap(patterns)];
}

/** Names `vite build` wrote for interfaces/web at c567d70 under the split strategy, one or two of each kind. */
const BUILT = [
  "/_app/immutable/entry/start.CFNELKP9.js",
  "/_app/immutable/entry/app.Dz9hjeQb.js",
  "/_app/immutable/entry/payload.DSmR2FwN.js",
  "/_app/immutable/nodes/0.CLfLl3xE.js",
  "/_app/immutable/nodes/12.Dt2TcbBM.js",
  "/_app/immutable/chunks/8WZVJ_R6.js",
  "/_app/immutable/chunks/q-i9K1th.js",
  "/_app/immutable/assets/0.Bg63KeTC.css",
  "/_app/immutable/assets/SpaceGrotesk-Variable.BhU9QXUp.woff2",
  "/_app/immutable/assets/unset-favicon-32.D9mHZMag.png",
] as const;

/** {http.request.uri.path} for a raw request path: Go's r.URL.Path, the path percent-decoded, %2F included. */
const uriPath = (raw: string): string => decodeURIComponent(raw);

/**
 * The path web routes on for a raw request path: SvelteKit 3.2.0 parses the request URL with the WHATWG URL parser
 * (adapter-node getRequest), which resolves dot segments, `%2e` among them, then decodes everything but %2F and %25
 * (kit src/utils/url.js decode_pathname).
 */
const webPath = (raw: string): string =>
  new URL(raw, "https://app.invalid").pathname
    .split(/%2f/i)
    .map((part) => part.split(/%25/).map(decodeURI).join("%25"))
    .join("%2F");

describe("app_files counts build files only, on the adapted config (P1.21g; TE-6)", () => {
  const found = patterns(DEV);
  const regex = new RegExp(BUILD_FILE_PATH);

  test("the_one_pattern_is_the_ruled_one_on_both_zones", () => {
    // app_files matches it and app_burst matches its negation; nothing else in the config reads the raw path.
    expect(found).toEqual([BUILD_FILE_PATH, BUILD_FILE_PATH]);
  });

  test("every_kind_of_file_the_build_writes_is_a_build_file", () => {
    for (const path of BUILT) expect(regex.test(uriPath(path)), path).toBe(true);
  });

  test("no_other_spelling_of_a_build_file_is_one", () => {
    // Letter case, runs of slashes, dot segments and parent hops, a trailing slash, and percent-encoding of any
    // character: whatever a client sends, the allowance holds only where web itself reads a path under /_app/, where
    // adapter-node serves the file or SvelteKit answers a plain 404 before any hook (respond.js:367).
    const spelled = fc.record({
      file: fc.constantFrom(...BUILT),
      upper: fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
      runs: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 8 }),
      dots: fc.array(fc.constantFrom("", "/.", "/x/..", "/%2e", "/x/%2E%2E"), { minLength: 1, maxLength: 8 }),
      encode: fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
      trailing: fc.boolean(),
    });
    fc.assert(
      fc.property(spelled, ({ file, upper, runs, dots, encode, trailing }) => {
        let at = 0;
        const spell = (segment: string): string =>
          [...segment]
            .map((ch) => ((upper[at % upper.length] ?? false) ? ch.toUpperCase() : ch))
            .map((ch) => ((encode[at++ % encode.length] ?? false) ? `%${ch.charCodeAt(0).toString(16)}` : ch))
            .join("");
        const raw =
          file
            .split("/")
            .slice(1)
            .map(
              (segment, i) =>
                `${dots[i % dots.length] ?? ""}${"/".repeat(runs[i % runs.length] ?? 1)}${spell(segment)}`,
            )
            .join("") + (trailing ? "/" : "");
        if (regex.test(uriPath(raw))) {
          expect(webPath(raw).startsWith("/_app/immutable/"), raw).toBe(true);
          expect(uriPath(raw).toLowerCase(), raw).toBe(file.toLowerCase());
        }
      }),
      { numRuns: 2000 },
    );
    for (const raw of [
      "//_app/immutable/chunks/8WZVJ_R6.js",
      "/_APP/immutable/chunks/8WZVJ_R6.js",
      "/login/../_app/immutable/chunks/8WZVJ_R6.js",
      "/_app/immutable/chunks/../../../login",
      "/_app/immutable/chunks/%2e%2e/x.js",
      "/%2F_app/immutable/chunks/8WZVJ_R6.js",
      "/_app/immutable/chunks/8WZVJ_R6.js/",
      "/_app/immutable/chunks/a/b.js",
      "/_app/immutable/chunks/8WZVJ_R6.js.br",
      "/_app/immutable/chunks/8WZVJ_R6.svg",
      "/_app/version.json",
      "/_app/remote/abc",
      "/_app/env.js",
      "/fonts/SpaceGrotesk-Variable.woff2",
    ]) {
      expect(regex.test(uriPath(raw)), raw).toBe(false);
    }
  });
});

// P1.22f (ADR 0116): a visitor the edge refuses must not spend more of the allowance reading the refusal. The Too many
// tries page each site answers a refused navigation with (snippets/too-many-tries.caddy) names no file to fetch, and
// its policy lets it load nothing but its one hashed style, so a browser asks for no build file, no font, no image.
describe("the refusal page asks for no build file (P1.22f)", () => {
  /** Every static_response body in the adapted config that is the Too many tries page. */
  function refusalPages(value: Json): string[] {
    if (Array.isArray(value)) return value.flatMap(refusalPages);
    if (typeof value !== "object" || value === null) return [];
    const body = value.handler === "static_response" ? value.body : undefined;
    const own = typeof body === "string" && body.includes("<title>Too many tries</title>") ? [body] : [];
    return [...own, ...Object.values(value).flatMap(refusalPages)];
  }
  /** Every Content-Security-Policy the adapted config sets on an error route (only the refusal page sets one). */
  function errorPolicies(value: Json, inErrors = false): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => errorPolicies(item, inErrors));
    if (typeof value !== "object" || value === null) return [];
    const set =
      inErrors && typeof value.set === "object" && value.set !== null && !Array.isArray(value.set) ? value.set : {};
    const policy = (set as Record<string, Json>)["Content-Security-Policy"];
    const own = Array.isArray(policy) ? policy.filter((item): item is string => typeof item === "string") : [];
    return [
      ...own,
      ...Object.entries(value).flatMap(([key, item]) => errorPolicies(item, inErrors || key === "errors")),
    ];
  }

  test("every_site_s_refusal_page_names_nothing_to_fetch", () => {
    const pages = refusalPages(DEV);
    expect(pages.length).toBeGreaterThan(0);
    for (const body of pages) {
      expect(body).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|\bsrc=|url\(|@import/i);
      expect(body).not.toContain("/_app/");
      // Its one link is a plain navigation home, which a person follows after waiting, not at load.
      expect([...body.matchAll(/href="([^"]*)"/g)].map((match) => match[1])).toEqual(["/"]);
    }
  });

  test("its_policy_lets_it_load_nothing_but_its_style", () => {
    const policies = errorPolicies(DEV);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/]{43}='; /);
      expect(policy).not.toMatch(/script-src|img-src|font-src|connect-src/);
    }
  });
});
