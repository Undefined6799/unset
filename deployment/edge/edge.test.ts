// P1.28: what the edge's files must say, read without starting Caddy (the running edge is tested in
// tests/integration/deployment/edge/). Certificates come from Let's Encrypt only; the rate limiter keeps client
// addresses in memory and nowhere else (ADR 0018, invariant 3); the image is built from pinned versions only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type Directive, readCaddyfile } from "./caddyfile.ts";

const EDGE = import.meta.dirname;
const read = (file: string): string => readFileSync(join(EDGE, file), "utf8");
/** Every Caddy config file the image ships, comments removed. */
const config = (): string =>
  ["Caddyfile", ...readdirSync(join(EDGE, "snippets")).map((f) => `snippets/${f}`), "sites/pds.caddy"]
    .map(read)
    .join("\n")
    .replaceAll(/^\s*#.*$/gm, "");
const dockerfile = read("Dockerfile");
const lock = JSON.parse(readFileSync(join(EDGE, "..", "images", "bases.lock.json"), "utf8")) as Record<
  string,
  { ref: string; tag: string; digest: string; source: string }
>;

/** The image each FROM names, stage names left out. */
const froms = (text: string): string[] =>
  [...text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/gim)].map((m) => m[1] ?? "");

/** The environment the PDS site and the TLS snippet read (Caddy's `{$NAME}`); test values only. */
const ENV = { PDS_HOST: "pds.unset.test", PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };
/** Every snippet file but the rate limits, in the order Caddy's `import snippets/*.caddy` reads them. */
const otherSnippets = (): string =>
  readdirSync(join(EDGE, "snippets"))
    .filter((f) => f !== "ratelimit.caddy")
    .sort()
    .map((f) => read(`snippets/${f}`))
    .join("\n");

/** The zones of the pds-ratelimit snippet, in order, read through the Caddyfile reader (P1.28h). */
function zones(ratelimit: string) {
  const limit = readCaddyfile(ratelimit, ENV)
    .snippet("pds-ratelimit")
    .find((directive) => directive.name === "rate_limit");
  return (limit?.block ?? [])
    .filter((directive) => directive.name === "zone")
    .map((zone) => {
      const value = (name: string) => zone.block?.find((directive) => directive.name === name)?.args[0];
      return {
        name: zone.args[0] ?? "",
        match: zone.block?.some((directive) => directive.name === "match") ?? false,
        key: value("key"),
        ipv6Prefix: value("ipv6_prefix"),
        events: Number(value("events")),
        window: value("window"),
      };
    });
}

/** Every directive in `directives` and their blocks, depth first. */
const flatten = (directives: Directive[]): Directive[] =>
  directives.flatMap((directive) => [directive, ...flatten(directive.block ?? [])]);

/**
 * Why some PDS request could pass the edge uncounted; empty when the global zone counts every request (no matcher) and
 * the PDS site applies the zones, once, before any other handler in its route.
 */
function zoneCoverageProblems(ratelimit: string, site: string): string[] {
  const found = [];
  const global = zones(ratelimit).find((zone) => zone.name === "global");
  if (global === undefined) found.push("there is no global zone");
  else if (global.match) found.push("the global zone has a matcher");
  const { sites } = readCaddyfile(`${otherSnippets()}\n${ratelimit}\n${site}`, ENV);
  const pds = sites.find((s) => s.addresses.includes(ENV.PDS_HOST));
  const first = pds?.directives.find((directive) => directive.name === "route")?.block?.[0];
  if (first?.name !== "rate_limit" || first.via !== "pds-ratelimit") {
    found.push("the PDS route does not apply the zones first");
  }
  const imports = sites
    .flatMap((s) => flatten(s.directives))
    .filter((directive) => directive.name === "rate_limit" && directive.via === "pds-ratelimit").length;
  if (imports !== 1) found.push(`the PDS site imports the zones ${imports} times`);
  return found;
}

/** Why the shipped Caddy config could keep or share a rate-limit key beyond memory; empty when it cannot. */
function memoryOnlyProblems(text: string): string[] {
  const found = [];
  for (const [word, pattern] of [
    ["distributed", /\bdistributed\b/],
    ["storage", /\bstorage\b/],
    ["log_key", /\blog_key\b/],
  ] as const) {
    if (pattern.test(text)) found.push(`config sets ${word}`);
  }
  if (/^\s*metrics\b/m.test(text)) found.push("config enables global metrics");
  if (/\brate_limit \{/.test(text) && !/\bdisable_metrics\b/.test(text))
    found.push("rate_limit without disable_metrics");
  return found;
}

/** Why the Dockerfile's Go build is not pinned and checked; empty when Caddy and the plugin are. */
function pinProblems(text: string): string[] {
  const instructions = text.replaceAll(/^\s*#.*$/gm, "");
  const found = [];
  if (!/^RUN xcaddy build v2\.11\.7 \\$/m.test(instructions)) found.push("Caddy version not pinned");
  if (!/--with github\.com\/mholt\/caddy-ratelimit@v0\.1\.1-0\.20260612195517-5625512f24f6 \\$/m.test(instructions))
    found.push("plugin pseudo-version not pinned");
  if ([...instructions.matchAll(/--with /g)].length !== 1) found.push("not exactly one plugin");
  if (!/^ENV GOFLAGS=-mod=readonly$/m.test(instructions)) found.push("GOFLAGS is not exactly -mod=readonly");
  // The checksum database and the default proxy stay on.
  for (const unsafe of ["GONOSUMDB", "GONOSUMCHECK", "GOINSECURE", "GOPRIVATE", "GONOPROXY", "GOSUMDB", "GOPROXY"]) {
    if (instructions.includes(unsafe)) found.push(`sets ${unsafe}`);
  }
  if (/-insecure|XCADDY_GO_BUILD_FLAGS|XCADDY_GO_MOD_FLAGS/.test(instructions)) found.push("insecure build flag");
  return found;
}

describe("edge config", () => {
  test("edge_tls_issuer_letsencrypt", () => {
    const tls = read("snippets/tls.caddy").replaceAll(/^\s*#.*$/gm, "");
    expect([...tls.matchAll(/\bissuer\s+(\S+)/g)].map((m) => m[1])).toEqual(["acme"]);
    expect([...tls.matchAll(/\bdir\s+(\S+)/g)].map((m) => m[1])).toEqual([
      "https://acme-v02.api.letsencrypt.org/directory",
    ]);
    // No other CA anywhere: no global acme_ca, no ZeroSSL, no internal issuer in what ships.
    expect(config()).not.toMatch(/\bacme_ca\b|zerossl|\binternal\b|local_certs/i);
    // The contact address is not committed.
    expect(tls).toMatch(/\bemail \{\$ACME_EMAIL\}/);
  });

  test("edge_ratelimit_memory_only", () => {
    expect(memoryOnlyProblems(config())).toEqual([]);
    // Every zone is keyed by the client address, IPv6 by its /64.
    for (const zone of zones(read("snippets/ratelimit.caddy"))) {
      expect(zone.key, zone.name).toBe("{remote_host}");
      expect(zone.ipv6Prefix, zone.name).toBe("64");
    }
    // A fixture with shared state, storage or a metrics label fails.
    const shipped = config();
    const withMetrics = shipped.replace("disable_metrics", "");
    for (const fixture of [
      shipped.replace("rate_limit {", "rate_limit {\n\t\tdistributed {\n\t\t}"),
      `${shipped}\n{\n\tstorage file_system /data\n}`,
      shipped.replace("rate_limit {", "rate_limit {\n\t\tlog_key"),
      `{\n\tmetrics\n}\n${shipped}`,
    ]) {
      expect(memoryOnlyProblems(fixture)).not.toEqual([]);
    }
    expect(memoryOnlyProblems(withMetrics)).toEqual(["rate_limit without disable_metrics"]);
  });

  test("edge_ratelimit_matches_limits", () => {
    // The zone values are architecture's (record 2026-10-07-p1b-a1-pds-no-forwarded-address, 01:52Z), kept once in
    // limits.json; the snippet must say the same.
    const limits = JSON.parse(read("limits.json")) as { rateLimitZones: Record<string, unknown> };
    const shipped = Object.fromEntries(
      zones(read("snippets/ratelimit.caddy")).map((z) => [z.name, { events: z.events, window: z.window }]),
    );
    expect(shipped).toEqual(limits.rateLimitZones);
  });

  test("every_pds_route_has_a_zone", () => {
    expect(zoneCoverageProblems(read("snippets/ratelimit.caddy"), read("sites/pds.caddy"))).toEqual([]);
  });

  test("pds_route_without_zone_fails", () => {
    // P1.28b: the negative twin. A PDS site whose route skips the zones, imports them after another handler or twice,
    // or a global zone narrowed by a matcher, each leaves some PDS request uncounted.
    const limits = read("snippets/ratelimit.caddy");
    const site = read("sites/pds.caddy");
    expect(zoneCoverageProblems(limits, site.replace("\t\timport pds-ratelimit\n", ""))).toEqual([
      "the PDS route does not apply the zones first",
      "the PDS site imports the zones 0 times",
    ]);
    const late = site.replace(
      "\t\timport pds-ratelimit\n\t\timport xrpc-guard\n",
      "\t\timport xrpc-guard\n\t\timport pds-ratelimit\n",
    );
    expect(late).not.toBe(site);
    expect(zoneCoverageProblems(limits, late)).toEqual(["the PDS route does not apply the zones first"]);
    expect(zoneCoverageProblems(limits, `${site}\nother {\n\timport pds-ratelimit\n}\n`)).toEqual([
      "the PDS site imports the zones 2 times",
    ]);
    const narrowed = limits.replace(/(\tzone global \{\n)/, "$1\t\t\tmatch {\n\t\t\t\tpath /xrpc/*\n\t\t\t}\n");
    expect(narrowed).not.toBe(limits);
    expect(zoneCoverageProblems(narrowed, site)).toEqual(["the global zone has a matcher"]);
    expect(zoneCoverageProblems(limits.replace(/\tzone global \{/, "\tzone overall {"), site)).toEqual([
      "there is no global zone",
    ]);
  });

  test("edge_admin_api_off_in_config", () => {
    expect(read("Caddyfile")).toMatch(/^\tadmin off$/m);
    expect(read("Caddyfile")).toMatch(/^\tpersist_config off$/m);
    expect(config()).not.toMatch(/trusted_proxies/);
  });
});

describe("edge image", () => {
  test("edge_from_matches_lock", () => {
    expect(froms(dockerfile)).toEqual([
      `docker.io/library/caddy:${lock["caddy-builder"]?.tag}@${lock["caddy-builder"]?.digest}`,
      `docker.io/library/caddy:${lock.caddy?.tag}@${lock.caddy?.digest}`,
    ]);
    expect(lock.caddy?.tag).toMatch(/^2\.11\.7-alpine$/);
    expect(lock["caddy-builder"]?.tag).toMatch(/^2\.11\.7-builder-alpine$/);
    // The DL3026 ignore sits directly above each upstream FROM, the reason comment above it (as P1.27).
    const lines = dockerfile.split("\n");
    for (const [at, line] of lines.entries()) {
      if (!line.startsWith("FROM ")) continue;
      expect(lines[at - 1]).toBe("# hadolint ignore=DL3026");
      expect(lines[at - 2]).toMatch(/^# .*2026-10-07-p128-edge-bases-and-ratelimit-adr.*removed by P1\.27s/);
    }
  });

  test("edge_dockerfile_pins_caddy_and_plugin", () => {
    expect(pinProblems(dockerfile)).toEqual([]);
    // A fixture missing either pin, or turning the checksum database or the proxy off, fails.
    const plugin = "caddy-ratelimit@v0.1.1-0.20260612195517-5625512f24f6";
    for (const fixture of [
      dockerfile.replace("xcaddy build v2.11.7", "xcaddy build latest"),
      dockerfile.replace(plugin, "caddy-ratelimit"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=mod"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly GONOSUMDB=*"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly\nENV GOINSECURE=*"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly\nENV GONOSUMCHECK=1"),
      dockerfile.replace("--output", "-insecure --output"),
      dockerfile.replace("--output", "--with github.com/example/other \\\n      --output"),
    ]) {
      expect(pinProblems(fixture), fixture).not.toEqual([]);
    }
  });

  test("edge_runtime_non_root", () => {
    const runtime = dockerfile.split(/^FROM .*$/m).at(-1) ?? "";
    expect(runtime.match(/^USER .*$/gm)).toEqual(["USER 65532:65532"]);
    expect(runtime.slice(runtime.indexOf("USER ")).match(/^RUN /m)).toBeNull();
    expect(runtime).toMatch(/^RUN setcap cap_net_bind_service=\+ep \/usr\/bin\/caddy \\$/m);
    expect(runtime).toMatch(/HEALTHCHECK [\s\S]*http:\/\/127\.0\.0\.1:8081\/health/);
  });
});
