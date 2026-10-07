// P1.28: what the edge's files must say, read without starting Caddy (the running edge is tested in
// tests/integration/deployment/edge/). Certificates come from Let's Encrypt only; the rate limiter keeps client
// addresses in memory and nowhere else (ADR 0018, invariant 3); the image is built from pinned versions only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

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

/** The zones of a rate_limit block, in order. */
function zones(block: string) {
  return [...block.matchAll(/\tzone (\w+) \{\n([\s\S]*?)\n\t\t\}/g)].map(([, name = "", body = ""]) => ({
    name,
    match: /\bmatch \{/.test(body),
    key: /\bkey (\S+)/.exec(body)?.[1],
    ipv6Prefix: /\bipv6_prefix (\d+)/.exec(body)?.[1],
    events: Number(/\bevents (\d+)/.exec(body)?.[1]),
    window: /\bwindow (\S+)/.exec(body)?.[1],
  }));
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
    const block = /rate_limit \{([\s\S]*?)\n\t\}\n\}/.exec(read("snippets/ratelimit.caddy"))?.[1] ?? "";
    // Every zone is keyed by the client address, IPv6 by its /64.
    for (const zone of zones(block)) {
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
    const block = /rate_limit \{([\s\S]*?)\n\t\}\n\}/.exec(read("snippets/ratelimit.caddy"))?.[1] ?? "";
    const limits = JSON.parse(read("limits.json")) as { rateLimitZones: Record<string, unknown> };
    const shipped = Object.fromEntries(zones(block).map((z) => [z.name, { events: z.events, window: z.window }]));
    expect(shipped).toEqual(limits.rateLimitZones);
  });

  test("every_pds_route_has_a_zone", () => {
    // The global zone has no matcher, so it counts every request; the PDS site applies the zones before anything else.
    const block = /rate_limit \{([\s\S]*?)\n\t\}\n\}/.exec(read("snippets/ratelimit.caddy"))?.[1] ?? "";
    const global = zones(block).find((zone) => zone.name === "global");
    expect(global?.match).toBe(false);
    const site = read("sites/pds.caddy").replaceAll(/^\s*#.*$/gm, "");
    expect(/route \{\s*import pds-ratelimit\n/.test(site)).toBe(true);
    expect([...site.matchAll(/import pds-ratelimit/g)].length).toBe(1);
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
