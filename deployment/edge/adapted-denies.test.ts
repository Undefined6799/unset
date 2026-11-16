// P1.36b, P1.38f (ADR 0031 Decision 4; TE-6): the dev edge's two deny patterns match every spelling of their paths a
// client can send. The patterns are read from the reviewed adapted config (adapted/dev.generated.json), which
// adapted.image.test.ts holds equal to what the built image adapts and adapted-rules.ts pins whole (BLOB_DENY,
// SIGNIN_FILES), so the regular expressions tried here are the ones Caddy runs. Moved from the Caddyfile reader's
// tests when P1.39e deleted the reader.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { Json } from "./adapted.ts";

const DEV = JSON.parse(readFileSync(join(import.meta.dirname, "adapted", "dev.generated.json"), "utf8")) as Json;

/** Every `path_regexp` matcher named `name` anywhere in the adapted config, as its pattern. */
function patterns(value: Json, name: string): string[] {
  if (Array.isArray(value)) return value.flatMap((each) => patterns(each, name));
  if (typeof value !== "object" || value === null) return [];
  const own = value.path_regexp;
  const here =
    typeof own === "object" &&
    own !== null &&
    !Array.isArray(own) &&
    own.name === name &&
    typeof own.pattern === "string"
      ? [own.pattern]
      : [];
  return [...here, ...Object.values(value).flatMap((each) => patterns(each, name))];
}

describe("dev edge denies, on the adapted config (P1.36b; TE-6)", () => {
  /** The decoded path's spellings a client can send: letter case, runs of slashes and a trailing slash. */
  const spelled = (segments: readonly string[]) =>
    fc
      .tuple(
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: segments.length, maxLength: segments.length }),
        fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        fc.integer({ min: 0, max: 2 }),
      )
      .map(([runs, upper, trailing]) => {
        let at = 0;
        const flip = (text: string) =>
          [...text].map((ch) => ((upper[at++ % upper.length] ?? false) ? ch.toUpperCase() : ch.toLowerCase())).join("");
        return (
          segments.map((segment, i) => `${"/".repeat(runs[i] ?? 1)}${flip(segment)}`).join("") + "/".repeat(trailing)
        );
      });
  /** Percent-encodes the characters `mask` picks, slashes included, as a client may send them on the wire. */
  const encoded = (path: string, mask: boolean[]) =>
    [...path].map((ch, i) => (mask[i % mask.length] ? `%${ch.charCodeAt(0).toString(16).toUpperCase()}` : ch)).join("");
  /** The raw path with a dot segment or a parent hop (`/x/..`) before each segment `dots` picks. */
  const dotted = (path: string, dots: number[]) => {
    let at = 0;
    return path.replace(/\/(?=[^/])/g, () => ["/", "/./", "/x/../"][dots[at++ % dots.length] ?? 0] as string);
  };
  /**
   * The path a path_regexp matcher sees for a raw request path, as Caddy v2.11.7 makes it: r.URL.Path is the
   * URI-decoded path (Go net/url, %2F included), then cleanPath runs path.Clean and keeps a trailing slash
   * (modules/caddyhttp/matchers.go:812-823, caddyhttp.go:302-308; website 1957519 matchers.md:707).
   */
  const matched = (raw: string) => {
    const path = decodeURIComponent(raw);
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    const clean = `/${parts.join("/")}`;
    return path.endsWith("/") && !clean.endsWith("/") ? `${clean}/` : clean;
  };

  /** The one pattern the adapted dev config holds under `name`, as a JavaScript RegExp (RE2's `(?i)` as a flag). */
  const regexOf = (name: string) => {
    const found = patterns(DEV, name);
    expect(found, name).toHaveLength(1);
    const pattern = found[0] as string;
    return new RegExp(pattern.replace(/^\(\?i\)/, ""), pattern.startsWith("(?i)") ? "i" : "");
  };

  // P1.38f (ADR 0031 Decision 4; TE-6): every spelling of the three blob methods a client can send is denied.
  test("blob_routes_denied_in_every_spelling", () => {
    const blob = regexOf("blob");
    for (const method of ["com.atproto.repo.uploadBlob", "com.atproto.sync.getBlob", "com.atproto.repo.importRepo"]) {
      fc.assert(
        fc.property(
          spelled(["xrpc", method]),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
          fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 4 }),
          (path, mask, dots) => {
            const raw = encoded(dotted(path, dots), mask);
            expect(blob.test(matched(raw)), raw).toBe(true);
          },
        ),
      );
    }
    for (const other of ["/xrpc/com.atproto.sync.getRecord", "/xrpc/com.atproto.repo.uploadBlobx", "/blob/getBlob"]) {
      expect(blob.test(other), other).toBe(false);
    }
    // Fixed raw spellings, each decoded and cleaned as Caddy does before the matcher runs.
    for (const raw of [
      "/xrpc%2Fcom.atproto.sync.getBlob",
      "/xrpc/com.atproto.sync.get%42lob",
      "/x/../xrpc/com.atproto.sync.getBlob",
      "/xrpc/./com.atproto.repo.uploadBlob/",
      "/xrpc/com.atproto.sync.GETBLOB",
      "/%78rpc/com%2Eatproto%2Erepo%2EimportRepo",
    ]) {
      expect(blob.test(matched(raw)), raw).toBe(true);
    }
    expect(matched("/a/../xrpc//x/./y/")).toBe("/xrpc/x/y/");
  });

  test("signin_files_405_in_every_spelling", () => {
    const files = regexOf("signin_files_write");
    for (const segments of [["oauth-client-metadata.json"], ["oauth", "jwks.json"]]) {
      fc.assert(
        fc.property(spelled(segments), fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }), (path, mask) => {
          const raw = encoded(path, mask);
          expect(files.test(matched(raw)), raw).toBe(true);
        }),
      );
    }
    for (const other of ["/oauth/callback", "/oauth-client-metadata.jsonx", "/x/oauth/jwks.json", "/"]) {
      expect(files.test(other), other).toBe(false);
    }
  });
});
