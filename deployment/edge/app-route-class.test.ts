// The dev app site's route class (snippets/route-class.caddy app-route-class): the access log names what kind of
// request each line was, from a closed set, so a burst of refusals can be told apart (staging, 2026-11-21: 429s from
// app_files that the log could not attribute) while no path segment, query or handle is written. Read from the
// reviewed adapted config, which adapted.image.test.ts holds equal to what the built image adapts. Caddy's map
// tries its regexps in order and takes the first match (caddyserver/caddy modules/caddyhttp/map/map.go, v2.11.9);
// Go's RE2 and JavaScript agree on these patterns (no lookaround or backreference).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Json } from "./adapted.ts";

type Mapping = { input_regexp: string; outputs: string[] };
type MapHandler = { handler: "map"; source: string; mappings: Mapping[]; defaults: string[] };

const DEV = JSON.parse(readFileSync(join(import.meta.dirname, "adapted", "dev.generated.json"), "utf8")) as Json;

function appMap(): MapHandler {
  const servers = Object.values(
    (DEV as { apps: { http: { servers: Record<string, { routes: unknown[] }> } } }).apps.http.servers,
  );
  for (const server of servers) {
    for (const route of server.routes as {
      match?: { host?: string[] }[];
      handle: { routes: { handle: unknown[] }[] }[];
    }[]) {
      if (route.match?.some((m) => m.host?.includes("app-host.invalid"))) {
        return route.handle[0]?.routes[0]?.handle[0] as MapHandler;
      }
    }
  }
  throw new Error("no app site");
}

function classOf(uri: string): string {
  const map = appMap();
  const hit = map.mappings.find((mapping) => new RegExp(mapping.input_regexp).test(uri));
  return hit?.outputs[0] ?? (map.defaults[0] as string);
}

describe("the app site's route class", () => {
  test("app_route_class_reads_the_raw_uri_and_names_only_fixed_words", () => {
    const map = appMap();
    expect(map.handler).toBe("map");
    expect(map.source).toBe("{http.request.orig_uri}");
    for (const output of [...map.mappings.flatMap((m) => m.outputs), ...map.defaults]) {
      expect(output).toMatch(/^[a-z]+$/);
    }
  });

  test.each([
    ["/_app/immutable/chunks/BsdUFiuI.js", "build"],
    ["/_app/immutable/nodes/12.Dt2TcbBM.js", "build"],
    ["/_app/version.json", "version"],
    ["/fonts/SpaceGrotesk-Variable.woff2", "fonts"],
    ["/did:plc:mmmmmmmmmmmmmmmmmmmmmmmm/__data.json?x-sveltekit-invalidated=01", "data"],
    ["/__data.json", "data"],
    ["/did:plc:mmmmmmmmmmmmmmmmmmmmmmmm?/saveAll", "action"],
    ["/allow?/reconsent", "action"],
    ["/images", "images"],
    ["/health", "health"],
    ["/did:plc:mmmmmmmmmmmmmmmmmmmmmmmm", "other"],
    ["/settings/privacy?saved", "other"],
    ["/@alice.example.com", "other"],
    ["/login?next=%2F_app%2Fimmutable%2F", "other"],
    ["/x?q=/__data.json", "other"],
  ])("app_route_class %s is %s", (uri, expected) => {
    expect(classOf(uri)).toBe(expected);
  });
});
