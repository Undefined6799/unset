// P1.28h: the Caddyfile reader refuses what it does not model and expands same-file snippets the way Caddy does
// (architecture record 2026-10-07-p130s-networks-and-caddyfile-reader, point 2), and agrees with `caddy adapt` on the
// shipped config (caddyfile_reader_matches_caddy_adapt, below).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildEdgeImage, docker, EDGE, PDS_HOST } from "../../tests/integration/deployment/edge/edge-container.ts";
import { type Directive, readCaddyfile } from "./caddyfile.ts";

const ENV = { HOST: "pds.unset.test", UPSTREAM: "upstream:3000" };
const read = (text: string) => readCaddyfile(text, ENV);
const names = (directives: Directive[]) => directives.map((d) => d.name);

describe("caddyfile reader", () => {
  test("caddyfile_reader_unknown_token_fails", () => {
    for (const [text, why] of [
      ["site {\n\trespond <<EOF\n\thello\n\tEOF\n}", "heredoc not supported"],
      ["{$MISSING} {\n}", "has no value"],
      ["{$HOST:fallback} {\n}", "unsupported environment placeholder"],
      ['site {\n\trespond "open\n}', "unterminated quote"],
      ["site {\n\trespond 200\n", "unclosed block"],
      ["site {\n\trespond 200 }\n}", "brace inside a line"],
      ["site {\n\treverse_proxy {args[0]}\n}", "outside a snippet"],
      ["(s) {\n\t{block}\n}\nsite {\n\timport s\n}", "unsupported placeholder"],
      ["respond 200", "a top-level line must open a site block"],
      ["(s) {\n}\n(s) {\n}", "snippet s is defined twice"],
    ] as const) {
      expect(() => read(text), text).toThrow(why);
    }
  });

  test("caddyfile_reader_resolves_snippet_imports", () => {
    const config = read(
      [
        "{",
        "\tadmin off",
        "}",
        "(proxy) {",
        "\treverse_proxy {args[0]} {",
        "\t\theader_up -Forwarded",
        "\t}",
        "}",
        "(guard) {",
        "\t@admin path /admin/*",
        "\trespond @admin 404",
        "\timport proxy {$UPSTREAM}",
        "}",
        "# a comment line",
        '{$HOST} "second name" {',
        "\troute {",
        "\t\timport guard",
        "\t}",
        "}",
      ].join("\n"),
    );
    expect(names(config.global ?? [])).toEqual(["admin"]);
    expect(config.sites.map((site) => site.addresses)).toEqual([["pds.unset.test", "second name"]]);
    const route = config.sites[0]?.directives[0];
    expect(route?.name).toBe("route");
    // A nested import keeps the outermost snippet's name, and its argument is in place.
    expect(route?.block?.map((d) => [d.name, d.args, d.via])).toEqual([
      ["@admin", ["path", "/admin/*"], "guard"],
      ["respond", ["@admin", "404"], "guard"],
      ["reverse_proxy", ["upstream:3000"], "guard"],
    ]);
    expect(route?.block?.[2]?.block?.map((d) => [d.name, d.args])).toEqual([["header_up", ["-Forwarded"]]]);
    expect(names(config.snippet("proxy", ["x:1"]))).toEqual(["reverse_proxy"]);
    // An import before its snippet, a missing argument, and a snippet importing itself all fail.
    expect(() => read("site {\n\timport later\n}\n(later) {\n}")).toThrow("not a snippet defined above");
    expect(() => read("(p) {\n\treverse_proxy {args[1]}\n}\nsite {\n\timport p a\n}")).toThrow("has no value");
    expect(() => read("(loop) {\n\timport loop\n}\nsite {\n\timport loop\n}")).toThrow("too many imports");
  });

  test("caddyfile_reader_refuses_file_imports", () => {
    for (const target of ["snippets/*.caddy", "sites/enabled/*.caddy", "other.caddy", "missing", '"proxy"']) {
      expect(() => read(`(proxy) {\n}\nsite {\n\timport ${target}\n}`), target).toThrow(
        "is not a snippet defined above (file imports are refused)",
      );
      expect(() => read(`import ${target}\nsite {\n}`), target).toThrow("file imports are refused");
    }
    expect(() => read("site {\n\timport\n}")).toThrow("import without a target");
  });
});

// The reader against Caddy itself: the shipped Caddyfile, with the PDS site enabled as P1.29 and P5 mount it, adapted
// by the built edge image (`caddy adapt`, Caddy v2.11.7). CI only, like the edge integration tests that build the same
// image; `npm test` locally skips it unless CI is set.
describe("caddyfile reader against caddy adapt", () => {
  const env = { PDS_HOST, PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };

  test.runIf(process.env.CI)(
    "caddyfile_reader_matches_caddy_adapt",
    () => {
      const theirs = adapt(buildEdgeImage(), env);
      const ours = readCaddyfile(shippedConfig(), env);
      expect(ours.sites.flatMap((site) => site.addresses.map(hostOf)).sort()).toEqual(adaptedHosts(theirs).sort());
      const route = ours.sites
        .find((site) => site.addresses.includes(PDS_HOST))
        ?.directives.find((directive) => directive.name === "route");
      const handlers = (route?.block ?? [])
        .filter((d) => !d.name.startsWith("@"))
        .map((d) => HANDLER[d.name] ?? d.name);
      const pdsRoute = adaptedPdsRoute(theirs);
      expect(handlers).toEqual(pdsRoute.flatMap((r) => r.handle.map((h) => h.handler)));
      expect(route?.block?.map((d) => d.via)).toEqual(["pds-ratelimit", ...Array(6).fill("xrpc-guard"), "upstream"]);
      const zones = route?.block?.find((d) => d.name === "rate_limit")?.block?.filter((d) => d.name === "zone") ?? [];
      const limits = pdsRoute.flatMap((r) => r.handle).find((h) => h.handler === "rate_limit")?.rate_limits ?? {};
      expect(zones.map((zone) => zone.args[0]).sort()).toEqual(Object.keys(limits).sort());
      for (const zone of zones) {
        const value = (name: string) => zone.block?.find((d) => d.name === name)?.args[0] ?? "";
        const name = zone.args[0] ?? "";
        expect(
          {
            key: KEY[value("key")] ?? value("key"),
            ipv6_prefix: Number(value("ipv6_prefix")),
            max_events: Number(value("events")),
            window: nanoseconds(value("window")),
            matched: zone.block?.some((d) => d.name === "match") ?? false,
          },
          name,
        ).toEqual({ ...pick(limits[name]), matched: limits[name]?.match !== undefined });
      }
    },
    600_000,
  );
});

type AdaptedHandler = { handler: string; routes?: AdaptedRoute[]; rate_limits?: Record<string, AdaptedZone> };
type AdaptedRoute = { match?: { host?: string[] }[]; handle: AdaptedHandler[] };
type AdaptedZone = { key: string; ipv6_prefix: number; max_events: number; window: number; match?: unknown };
type Adapted = { apps: { http: { servers: Record<string, { routes: AdaptedRoute[] }> } } };

/** The Caddyfile directive each adapted handler comes from, where the names differ. */
const HANDLER: Record<string, string> = { respond: "static_response" };
/** Caddyfile placeholder shorthands the zones use, in their adapted long form (Caddy v2.11.7 caddyfile/parse.go). */
const KEY: Record<string, string> = { "{remote_host}": "{http.request.remote.host}" };

const pick = (zone: AdaptedZone | undefined) => ({
  key: zone?.key,
  ipv6_prefix: zone?.ipv6_prefix,
  max_events: zone?.max_events,
  window: zone?.window,
});
const hostOf = (address: string): string => address.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
const nanoseconds = (duration: string): number => {
  const [, amount = "", unit = ""] = /^(\d+)([smh])$/.exec(duration) ?? [];
  return Number(amount) * { s: 1, m: 60, h: 3600 }[unit as "s" | "m" | "h"] * 1e9;
};

/** The shipped Caddyfile with its two file imports resolved as Caddy would (sorted globs), the PDS site enabled. */
function shippedConfig(): string {
  const caddyfile = readFileSync(join(EDGE, "Caddyfile"), "utf8");
  const snippets = readdirSync(join(EDGE, "snippets"))
    .sort()
    .map((file) => readFileSync(join(EDGE, "snippets", file), "utf8"))
    .join("\n");
  const imports = [...caddyfile.matchAll(/^import (\S+)$/gm)].map((match) => match[1]);
  expect(imports).toEqual(["snippets/*.caddy", "sites/enabled/*.caddy"]);
  return caddyfile
    .replace("import snippets/*.caddy", snippets)
    .replace("import sites/enabled/*.caddy", readFileSync(join(EDGE, "sites", "pds.caddy"), "utf8"));
}

function adapt(image: string, env: Record<string, string>): Adapted {
  const result = docker([
    "run",
    "--rm",
    "--read-only",
    "--entrypoint",
    "caddy",
    ...Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
    "-v",
    `${join(EDGE, "sites", "pds.caddy")}:/etc/caddy/sites/enabled/pds.caddy:ro`,
    image,
    "adapt",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]);
  if (result.code !== 0) throw new Error(`caddy adapt failed: ${result.err.slice(-2000)}`);
  return JSON.parse(result.out) as Adapted;
}

const adaptedHosts = (adapted: Adapted): string[] =>
  Object.values(adapted.apps.http.servers).flatMap((server) => server.routes.flatMap((r) => r.match?.[0]?.host ?? []));

/** The routes of the PDS site's `route` block: the site's subroute handler that holds the rate limiter. */
function adaptedPdsRoute(adapted: Adapted): AdaptedRoute[] {
  const site = Object.values(adapted.apps.http.servers)
    .flatMap((server) => server.routes)
    .find((r) => r.match?.[0]?.host?.includes(PDS_HOST));
  const handlers = (site?.handle[0]?.routes ?? []).flatMap((r) => r.handle);
  const block = handlers.find((h) => h.routes?.some((r) => r.handle.some((x) => x.handler === "rate_limit")));
  return block?.routes ?? [];
}
