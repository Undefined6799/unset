// P1.28h, split out by P1.28i: the Caddyfile reader agrees with `caddy adapt` on the shipped config. It builds the edge
// image, so it lives in an *.image.test.ts file (step book P1.28i; architecture record
// 2026-10-07-test-timing-fuzz-and-image-tests), apart from the reader's unit tests in caddyfile.test.ts.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  type Caddyfile,
  DEV_APP,
  DEV_EDGE_ADDRESS,
  DEV_LISTENER,
  DEV_PROXY_ADDRESS,
  DEV_TLS,
  type EdgeFiles,
  readEdgeConfig,
} from "./caddyfile.ts";
import { BUILD_CALL_MS, buildTestBudget, CALL_MS, removalBudget, runOrKill } from "./docker-call.ts";
import { removeEveryTag } from "./image-cleanup.ts";

// The reader against Caddy itself: the shipped Caddyfile, with the PDS site enabled as P1.29 and P5 mount it, adapted
// by the built edge image (`caddy adapt`, Caddy v2.11.7). It carries no skip of its own (P1.28j): without Docker it
// fails, and whether the images project runs locally is run.ts's decision (P1.28r). The test builds and runs
// the image itself with node built-ins (architecture amendment 3 to 2026-10-07-p130s-networks-and-caddyfile-reader):
// a trusted test owns its inputs, and first proves the image holds the repository's config byte for byte.
const EDGE = import.meta.dirname;
const docker = (args: readonly string[], timeoutMs: number) => runOrKill(spawnSync, "docker", args, timeoutMs);
const PDS_HOST = "pds.unset.test";
const built: string[] = [];
// Every docker call is killed at its own budget with SIGKILL by docker-call.ts (P1.27t). Each test's budget is one
// build slot plus CALL_MS for each other docker call it makes, which keeps the sum of its kills under that budget and
// the budget under run.ts's 600 s (P1.27h, N1; docker-call.ts buildTestBudget). The afterAll's removals are one `rmi`
// per tag, one tag per test that builds (BUILDS of them), each killed at CALL_MS.
const BUILDS = 4;

/**
 * Builds deployment/edge/Dockerfile with deployment/edge as the context under its own tag; the tag (P1.27z, as P1.27x
 * does for product tests). Two builds of one context share an image id on CI's classic image store, so removing by id
 * with -f removed the image under every other edge test; `rmi <tag>` removes the image only with its last tag
 * (docs.docker.com, "docker image rm"). Plain progress, not -q, so a failure keeps the failing step's own log lines.
 */
function buildEdgeImage(): string {
  const tag = `unset-test-${randomBytes(8).toString("hex")}`;
  const result = docker(["build", "--progress=plain", "-t", tag, "-f", join(EDGE, "Dockerfile"), EDGE], BUILD_CALL_MS);
  if (result.code !== 0) throw new Error(`edge image build failed: ${failedStep(result.err)}`);
  built.push(tag);
  return tag;
}

/** BuildKit's summary of the failing step to the end of its output (docker buildx 0.35.0), else the last 4000 chars. */
function failedStep(stderr: string): string {
  const from = stderr.lastIndexOf("\n------\n > ");
  return (from === -1 ? stderr : stderr.slice(from + 1)).slice(-4_000);
}

/**
 * The config files the image holds under /etc/caddy, by their repository path under deployment/edge, in three calls
 * whatever the number of snippets (P1.27h, N1): the snippet names, each file's size in bytes (busybox `stat -c %s`, one
 * line per file in the order given), and every file through one `cat`, cut at those sizes.
 */
function imageConfig(image: string): Record<string, string> {
  const listed = docker(["run", "--rm", "--entrypoint", "ls", image, "/etc/caddy/snippets"], CALL_MS);
  if (listed.code !== 0) throw new Error(`listing the image's snippets failed: ${listed.err.slice(-2000)}`);
  const files = [
    "Caddyfile",
    "sites/pds.caddy",
    ...listed.out
      .split("\n")
      .filter((f) => f !== "")
      .map((f) => `snippets/${f}`),
  ];
  const paths = files.map((file) => `/etc/caddy/${file}`);
  const stat = docker(["run", "--rm", "--entrypoint", "stat", image, "-c", "%s", ...paths], CALL_MS);
  if (stat.code !== 0) throw new Error(`sizing the image's config failed: ${stat.err.slice(-2000)}`);
  const sizes = stat.out
    .split("\n")
    .filter((line) => line !== "")
    .map(Number);
  if (sizes.length !== files.length) throw new Error(`stat gave ${sizes.length} sizes for ${files.length} files`);
  const read = docker(["run", "--rm", "--entrypoint", "cat", image, ...paths], CALL_MS);
  if (read.code !== 0) throw new Error(`reading the image's config failed: ${read.err.slice(-2000)}`);
  const bytes = Buffer.from(read.out, "utf8");
  if (bytes.length !== sizes.reduce((sum, size) => sum + size, 0)) throw new Error("cat and stat disagree on the size");
  let at = 0;
  return Object.fromEntries(
    files.map((file, index) => {
      const size = sizes[index] ?? 0;
      const content = bytes.subarray(at, at + size).toString("utf8");
      at += size;
      return [file, content];
    }),
  );
}

describe("caddyfile reader against caddy adapt", () => {
  const env = { PDS_HOST, PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };
  afterAll(() => {
    // The tag only, never -f: an image another edge test built from the same context stays (P1.27z). Every tag is
    // tried, and each result checked, even after a removal fails or is killed (P1.11r).
    removeEveryTag(built, (tag) => {
      const removed = docker(["rmi", tag], CALL_MS);
      if (removed.code !== 0) throw new Error(removed.err.trim().slice(-500));
    });
    if (built.length > BUILDS) throw new Error(`${built.length} builds, but this hook's budget covers ${BUILDS}`);
  }, removalBudget(BUILDS));

  // Its docker calls after the build: ls, stat and cat of the config, then one adapt (4).
  test("caddyfile_reader_matches_caddy_adapt", { timeout: buildTestBudget(4) }, () => {
    const image = buildEdgeImage();
    const repository = Object.fromEntries(
      [
        "Caddyfile",
        "sites/pds.caddy",
        ...readdirSync(join(EDGE, "snippets"))
          .sort()
          .map((f) => `snippets/${f}`),
      ].map((file) => [file, readFileSync(join(EDGE, file), "utf8")]),
    );
    expect(imageConfig(image)).toStrictEqual(repository);
    const theirs = adapt(image, env, [PDS_SITE]);
    const ours = shippedConfig(env);
    expect(ours.sites.flatMap((site) => site.addresses.map(hostOf)).sort()).toEqual(adaptedHosts(theirs).sort());
    const route = ours.sites
      .find((site) => site.addresses.includes(PDS_HOST))
      ?.directives.find((directive) => directive.name === "route");
    const handlers = (route?.block ?? []).filter((d) => !d.name.startsWith("@")).map((d) => HANDLER[d.name] ?? d.name);
    const pdsRoute = adaptedPdsRoute(theirs);
    expect(handlers).toEqual(pdsRoute.flatMap((r) => r.handle.map((h) => h.handler)));
    expect(route?.block?.map((d) => d.via)).toEqual([
      "pds-ratelimit",
      ...Array(6).fill("xrpc-guard"),
      ...Array(5).fill("pds-fonts"),
      "upstream",
    ]);
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
  });

  // P1.34q (architecture record 2026-10-13-p127l-local-gaps, Amendment 3 S3): each env's served config, adapted by the
  // image, gets its certificates only from Let's Encrypt (dev, prod) or the dev leaf's files (local), and no host
  // falls to Caddy's internal CA. Dev mounts sites/ itself (compose.dev.yaml), prod the PDS site file (P5), and local
  // every site file, the app site and its tls snippet (Amendment 3 S2). With `tls <cert> <key>` Caddy v2.11.7 adapts a
  // load_files loader and a connection policy selecting its tag (caddyconfig/httpcaddyfile/builtins.go:154-198,
  // tlsapp.go:288-320), and at run time skips automating a name a loaded certificate covers (modules/caddyhttp/
  // autohttps.go:208); the internal issuer it would give a non-public name that is not covered (autohttps.go:318-332)
  // never appears in adapt output, which is why P1.33t's C18 rule refuses every other source of certificates.
  // Its docker calls after the build: one adapt per env (3).
  test("each_env_gets_certificates_from_acme_or_the_leaf_files", { timeout: buildTestBudget(3) }, () => {
    const image = buildEdgeImage();
    const acme = {
      automation: {
        policies: [
          {
            subjects: [PDS_HOST],
            issuers: [{ ca: "https://acme-v02.api.letsencrypt.org/directory", email: env.ACME_EMAIL, module: "acme" }],
          },
        ],
      },
    };
    for (const [name, mounts] of [
      ["prod", [PDS_SITE]],
      ["dev", [`${join(EDGE, "sites")}:/etc/caddy/sites/enabled:ro`]],
    ] as const) {
      const adapted = adapt(image, env, mounts);
      expect(modules(adapted), name).not.toContain("internal");
      expect(adapted.apps.tls, name).toStrictEqual(acme);
    }
    const local = {
      PDS_HOST: "pds.unset.localhost",
      PDS_UPSTREAM: "pds:3000",
      APP_HOST: "app.unset.localhost",
      APP_UPSTREAM: "web:8080",
    };
    const adapted = adapt(image, local, [
      PDS_SITE,
      `${join(EDGE, "local", "app.caddy")}:/etc/caddy/sites/enabled/app.caddy:ro`,
      `${join(EDGE, "local", "tls.caddy")}:/etc/caddy/snippets/tls.caddy:ro`,
    ]);
    expect(modules(adapted)).not.toContain("internal");
    expect(adapted.apps.tls).toStrictEqual({
      certificates: {
        load_files: [
          { certificate: "/run/secrets/local_tls_cert", key: "/run/secrets/local_tls_key", tags: ["cert0"] },
        ],
      },
    });
    const https = Object.values(adapted.apps.http.servers).find((server) => server.listen.includes(":443"));
    expect(https?.automatic_https?.ignore_loaded_certificates).toBeUndefined();
    expect(https?.tls_connection_policies?.[0]).toStrictEqual({
      match: { sni: [local.APP_HOST, local.PDS_HOST] },
      certificate_selection: { any_tag: ["cert0"] },
    });
  });

  // P1.36b (ADR 0032): the dev sites, mounted as ADR 0032 Decision 3's three file binds (DEV_MOUNTS), adapt
  // to https on the edge's newt_edge address and nothing else: no :80 server and no issuer, only the dev leaf's two
  // files. Caddy's run-time HTTP->HTTPS redirect is added after adapt (caddy v2.11.7
  // modules/caddyhttp/autohttps.go:229-268), so it is not in this config.
  // Its docker calls after the build: one adapt (1).
  test("dev_sites_listen_https_with_the_leaf_files", { timeout: buildTestBudget(1) }, () => {
    const image = buildEdgeImage();
    const adapted = adapt(image, { ...env, ...DEV_APP, PDS_HOST: "staging.unset.ac" }, DEV_MOUNTS);
    const listens = Object.values(adapted.apps.http.servers).flatMap((server) => server.listen);
    expect(listens.sort()).toEqual([`${DEV_EDGE_ADDRESS}:443`, "127.0.0.1:8081"].sort());
    expect(modules(adapted)).not.toContain("acme");
    expect(modules(adapted)).not.toContain("internal");
    expect(adapted.apps.tls).toStrictEqual({
      certificates: { load_files: [{ certificate: DEV_TLS[0], key: DEV_TLS[1], tags: ["cert0"] }] },
    });
    expect(adaptedHosts(adapted).sort()).toEqual(["127.0.0.1", "staging.unset.ac", "staging.unset.sh"]);
  });

  // P1.36j (ADR 0030 Decision 2): adapted, the shipped PDS site's server trusts no proxy, and the dev sites' server on
  // DEV_LISTENER trusts Newt's address alone, right to left, from X-Forwarded-For. Caddy applies a listener's
  // `servers` block only to the server bound to exactly that address (caddyserver/caddy v2.11.7
  // caddyconfig/httpcaddyfile/serveroptions.go:427-437).
  // Its docker calls after the build: two adapts (2).
  test("only_the_dev_listener_trusts_newt", { timeout: buildTestBudget(2) }, () => {
    const image = buildEdgeImage();
    const trust = (server: AdaptedServer) => ({
      listen: server.listen,
      trusted_proxies: server.trusted_proxies,
      trusted_proxies_strict: server.trusted_proxies_strict,
      client_ip_headers: server.client_ip_headers,
    });
    const shipped = Object.values(adapt(image, env, [PDS_SITE]).apps.http.servers);
    for (const server of shipped) {
      expect(trust(server)).toStrictEqual({ listen: server.listen, ...NO_TRUST });
    }
    const dev = Object.values(
      adapt(image, { ...env, ...DEV_APP, PDS_HOST: "staging.unset.ac" }, DEV_MOUNTS).apps.http.servers,
    );
    expect(dev.map(trust).sort((a, b) => a.listen[0]?.localeCompare(b.listen[0] ?? "") ?? 0)).toStrictEqual([
      {
        listen: [DEV_LISTENER],
        trusted_proxies: { source: "static", ranges: [`${DEV_PROXY_ADDRESS}/32`] },
        trusted_proxies_strict: 1,
        client_ip_headers: ["X-Forwarded-For"],
      },
      { listen: ["127.0.0.1:8081"], ...NO_TRUST },
    ]);
  });
});

type AdaptedHandler = { handler: string; routes?: AdaptedRoute[]; rate_limits?: Record<string, AdaptedZone> };
type AdaptedRoute = { match?: { host?: string[] }[]; handle: AdaptedHandler[] };
type AdaptedZone = { key: string; ipv6_prefix: number; max_events: number; window: number; match?: unknown };
type AdaptedServer = {
  listen: string[];
  routes: AdaptedRoute[];
  automatic_https?: { ignore_loaded_certificates?: boolean };
  tls_connection_policies?: unknown[];
  trusted_proxies?: unknown;
  trusted_proxies_strict?: number;
  client_ip_headers?: string[];
};
const NO_TRUST = { trusted_proxies: undefined, trusted_proxies_strict: undefined, client_ip_headers: undefined };
type Adapted = { apps: { http: { servers: Record<string, AdaptedServer> }; tls?: unknown } };

/** The PDS site's file mount, as P1.29 and P5 enable it. */
const PDS_SITE = `${join(EDGE, "sites", "pds.caddy")}:/etc/caddy/sites/enabled/pds.caddy:ro`;
/** The dev edge's three read-only file binds, as compose.dev.yaml mounts them (ADR 0032 Decision 3). */
const DEV_MOUNTS = [
  `${join(EDGE, "dev", "app.caddy")}:/etc/caddy/sites/enabled/app.caddy:ro`,
  `${join(EDGE, "dev", "pds.caddy")}:/etc/caddy/sites/enabled/pds.caddy:ro`,
  `${join(EDGE, "dev", "tls.caddy")}:/etc/caddy/snippets/tls.caddy:ro`,
];

/** Every `module` name anywhere in the adapted config. */
const modules = (value: unknown): string[] =>
  typeof value !== "object" || value === null
    ? []
    : Object.entries(value).flatMap(([key, inner]) =>
        key === "module" && typeof inner === "string" ? [inner] : modules(inner),
      );

/** The Caddyfile directive each adapted handler comes from, where the names differ. */
const HANDLER: Record<string, string> = { respond: "static_response", header: "headers" };
/** Caddyfile placeholder shorthands the zones use, in their adapted long form (Caddy v2.11.7 caddyfile/parse.go). */
const KEY: Record<string, string> = { "{client_ip}": "{http.vars.client_ip}" };

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

/** The shipped Caddyfile through the one edge reader (P1.28e), copied with sites/enabled linking to the PDS site as
 * P1.29 and P5 mount it: the reader refuses a sites directory outside the edge's sites/ (P1.28f). */
function shippedConfig(env: Record<string, string>): Caddyfile {
  const edgeDir = mkdtempSync(join(tmpdir(), "edge-"));
  try {
    for (const part of ["Caddyfile", "snippets", "sites"])
      cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
    const sitesDir = join(edgeDir, "sites", "enabled");
    mkdirSync(sitesDir);
    symlinkSync(join(edgeDir, "sites", "pds.caddy"), join(sitesDir, "pds.caddy"));
    return readEdgeConfig(edgeDir, sitesDir, env, FILES);
  } finally {
    rmSync(edgeDir, { recursive: true, force: true });
  }
}

/** The reader's file-system reads, through node:fs (caddyfile.ts itself imports nothing). */
const FILES: EdgeFiles = {
  list: (dir) => readdirSync(dir),
  kind: (path) => {
    const stat = lstatSync(path);
    const type = stat.isSymbolicLink() ? "link" : stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other";
    return { type, links: stat.nlink };
  },
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  read: (path) => readFileSync(path, "utf8"),
};

/** `caddy adapt` of the image's Caddyfile with `mounts` (docker -v specs, each read-only) in place. */
function adapt(image: string, env: Record<string, string>, mounts: readonly string[]): Adapted {
  const result = docker(
    [
      "run",
      "--rm",
      "--read-only",
      "--entrypoint",
      "caddy",
      ...Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
      ...mounts.flatMap((mount) => ["-v", mount]),
      image,
      "adapt",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    CALL_MS,
  );
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
