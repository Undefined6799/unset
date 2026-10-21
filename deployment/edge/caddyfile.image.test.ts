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
  PDS_FONT_EXPRESSION,
  PDS_FONT_PATHS,
  PDS_FONT_POLICY,
  PDS_FONT_TEMPLATE,
  readEdgeConfig,
} from "./caddyfile.ts";
import { removeEveryTag } from "./image-cleanup.ts";

// The reader against Caddy itself: the shipped Caddyfile, with the PDS site enabled as P1.29 and P5 mount it, adapted
// by the built edge image (`caddy adapt`, Caddy v2.11.7). It carries no skip of its own (P1.28j): without Docker it
// fails, and whether the images project runs locally is run.ts's decision (P1.28r). The test builds and runs
// the image itself with node built-ins (architecture amendment 3 to 2026-10-07-p130s-networks-and-caddyfile-reader):
// a trusted test owns its inputs, and first proves the image holds the repository's config byte for byte.
const EDGE = import.meta.dirname;
const PDS_HOST = "pds.unset.test";
const built: string[] = [];
// A container start, exec or removal waits on the one docker daemon, behind CI's parallel image builds, so it gets
// the budget of this repository's container tests (60 to 120 s), never vitest's 5 s test or 10 s hook default (P1.29o).
const CONTAINER_MS = 120_000;

// Every docker call is killed at its own budget with SIGKILL (P1.27t, as P1.27k does for tests/support/docker.ts): a
// blocked spawnSync holds the event loop, so vitest's budget cannot stop it, and a hung daemon would hold the run
// until scripts/test/run.ts kills it whole at 600 s, failing with no name. A daemon call (run, cat, rmi) gets 50 s, so
// the afterAll's two removals fit inside CONTAINER_MS; a build gets 300 s inside its test's 600 s. This trusted test
// keeps its own helper rather than import product test code.
const CALL_MS = 50_000;
const BUILD_MS = 300_000;

/** Docker's subcommand in full: up to two leading words (`run`, `image inspect`), never a flag or a reference. */
function subcommand(args: readonly string[]): string {
  const end = args.findIndex((arg) => !/^[a-z][a-z-]*$/.test(arg));
  return args.slice(0, Math.min(end === -1 ? args.length : end, 2)).join(" ");
}

function docker(args: readonly string[], timeoutMs: number): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`docker ${subcommand(args)} killed after ${timeoutMs} ms`);
  }
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

/**
 * Builds deployment/edge/Dockerfile with deployment/edge as the context under its own tag; the tag (P1.27z, as P1.27x
 * does for product tests). Two builds of one context share an image id on CI's classic image store, so removing by id
 * with -f removed the image under every other edge test; `rmi <tag>` removes the image only with its last tag
 * (docs.docker.com, "docker image rm"). Plain progress, not -q, so a failure keeps the failing step's own log lines.
 */
function buildEdgeImage(): string {
  const tag = `unset-test-${randomBytes(8).toString("hex")}`;
  const result = docker(["build", "--progress=plain", "-t", tag, "-f", join(EDGE, "Dockerfile"), EDGE], BUILD_MS);
  if (result.code !== 0) throw new Error(`edge image build failed: ${failedStep(result.err)}`);
  built.push(tag);
  return tag;
}

/** BuildKit's summary of the failing step to the end of its output (docker buildx 0.35.0), else the last 4000 chars. */
function failedStep(stderr: string): string {
  const from = stderr.lastIndexOf("\n------\n > ");
  return (from === -1 ? stderr : stderr.slice(from + 1)).slice(-4_000);
}

/** The config files the image holds under /etc/caddy, by their repository path under deployment/edge. */
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
  return Object.fromEntries(
    files.map((file) => {
      const read = docker(["run", "--rm", "--entrypoint", "cat", image, `/etc/caddy/${file}`], CALL_MS);
      if (read.code !== 0) throw new Error(`reading /etc/caddy/${file} failed: ${read.err.slice(-2000)}`);
      return [file, read.out];
    }),
  );
}

describe("caddyfile reader against caddy adapt", () => {
  const env = { PDS_HOST, PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };
  afterAll(() => {
    // The tag only, never -f: an image another edge test built from the same context stays (P1.27z). Every tag is
    // tried, even after a removal fails or is killed (P1.11r).
    removeEveryTag(built, (tag) => {
      const removed = docker(["rmi", tag], CALL_MS);
      if (removed.code !== 0) throw new Error(removed.err.trim().slice(-500));
    });
  }, CONTAINER_MS);

  test("caddyfile_reader_matches_caddy_adapt", () => {
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
      ...Array(6).fill("pds-fonts"),
      "pds-upstream",
    ]);
    expectFontAdapt(pdsRoute);
    expectPackagedFonts(image);
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
  }, 600_000);

  // P1.34q (architecture record 2026-10-13-p127l-local-gaps, Amendment 3 S3): each env's served config, adapted by the
  // image, gets its certificates only from Let's Encrypt (dev, prod) or the dev leaf's files (local), and no host
  // falls to Caddy's internal CA. Dev mounts sites/ itself (compose.dev.yaml), prod the PDS site file (P5), and local
  // every site file, the app site and its tls snippet (Amendment 3 S2). With `tls <cert> <key>` Caddy v2.11.7 adapts a
  // load_files loader and a connection policy selecting its tag (caddyconfig/httpcaddyfile/builtins.go:154-198,
  // tlsapp.go:288-320), and at run time skips automating a name a loaded certificate covers (modules/caddyhttp/
  // autohttps.go:208); the internal issuer it would give a non-public name that is not covered (autohttps.go:318-332)
  // never appears in adapt output, which is why P1.33t's C18 rule refuses every other source of certificates.
  test("each_env_gets_certificates_from_acme_or_the_leaf_files", () => {
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
  }, 600_000);

  // P1.36b (ADR 0032): the dev sites, mounted as ADR 0032 Decision 3's three file binds (DEV_MOUNTS), adapt
  // to https on the edge's newt_edge address and nothing else: no :80 server and no issuer, only the dev leaf's two
  // files. Caddy's run-time HTTP->HTTPS redirect is added after adapt (caddy v2.11.7
  // modules/caddyhttp/autohttps.go:229-268), so it is not in this config.
  test("dev_sites_listen_https_with_the_leaf_files", () => {
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
  }, 600_000);

  // P1.36j (ADR 0030 Decision 2): adapted, the shipped PDS site's server trusts no proxy, and the dev sites' server on
  // DEV_LISTENER trusts Newt's address alone, right to left, from X-Forwarded-For. Caddy applies a listener's
  // `servers` block only to the server bound to exactly that address (caddyserver/caddy v2.11.7
  // caddyconfig/httpcaddyfile/serveroptions.go:427-437).
  test("only_the_dev_listener_trusts_newt", () => {
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
  }, 600_000);
});

type AdaptedHandler = {
  handler: string;
  routes?: AdaptedRoute[];
  rate_limits?: Record<string, AdaptedZone>;
  handle_response?: unknown;
  hide?: string[];
  root?: string;
};
type AdaptedRoute = {
  match?: { host?: string[]; expression?: { expr: string; name: string }; method?: string[]; path?: string[] }[];
  handle: AdaptedHandler[];
  group?: string;
};
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
const HANDLER: Record<string, string> = { respond: "static_response", handle: "subroute" };
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

/** Compare the full native response-handler JSON: matching, replacement deferral and both unchanged copies. */
function expectFontAdapt(routes: AdaptedRoute[]): void {
  const proxy = routes.flatMap((r) => r.handle).find((h) => h.handler === "reverse_proxy");
  expect(proxy?.handle_response).toStrictEqual([
    {
      routes: [
        {
          match: [
            {
              expression: { expr: PDS_FONT_EXPRESSION, name: "ui" },
              method: ["GET", "HEAD"],
              path: ["/account", "/account/*", "/oauth/authorize", "/oauth/authorize/redirect"],
            },
          ],
          handle: [
            {
              handler: "subroute",
              routes: [
                {
                  handle: [
                    {
                      handler: "headers",
                      response: {
                        deferred: true,
                        replace: {
                          "Content-Security-Policy": [
                            {
                              search_regexp: PDS_FONT_POLICY,
                              replace: PDS_FONT_TEMPLATE.replaceAll("{$PDS_HOST}", PDS_HOST),
                            },
                          ],
                        },
                      },
                    },
                    { handler: "copy_response" },
                  ],
                },
              ],
            },
          ],
        },
        { handle: [{ handler: "copy_response" }] },
      ],
    },
  ]);
  const fontRoutes = routes.filter((r) => r.match?.[0]?.expression?.name.startsWith("font"));
  expect(fontRoutes).toHaveLength(2);
  expect(fontRoutes[0]?.group).toBeTypeOf("string");
  expect(fontRoutes[1]?.group).toBe(fontRoutes[0]?.group);
  for (const [i, path] of PDS_FONT_PATHS.entries()) {
    const route = fontRoutes[i];
    expect(route?.match).toStrictEqual([
      { method: ["GET", "HEAD"], expression: { expr: `{http.request.orig_uri} == '${path}'`, name: `font${i}` } },
    ]);
    const handlers = route?.handle[0]?.routes?.[0]?.handle ?? [];
    const file = handlers.at(-1);
    expect({ ...file, hide: undefined }).toStrictEqual({
      handler: "file_server",
      root: "/etc/caddy/pds-public",
      hide: undefined,
    });
    expect(file?.hide?.slice().sort()).toStrictEqual(
      [
        "/etc/caddy/sites/enabled/pds.caddy",
        ...[
          "log",
          "pds-fonts",
          "pds-upstream",
          "ratelimit",
          "route-class",
          "security-headers",
          "tls",
          "upstream",
          "xrpc-guard",
        ].map((name) => `/etc/caddy/snippets/${name}.caddy`),
      ].sort(),
    );
    expect(handlers.slice(0, -1)).toStrictEqual([
      { handler: "headers", response: { set: { "Content-Type": ["font/woff2"] } } },
      { handler: "headers", response: { set: { "Cache-Control": ["public, max-age=0, must-revalidate"] } } },
      { handler: "headers", response: { set: { "Cross-Origin-Resource-Policy": ["same-origin"] } } },
    ]);
  }
}

/** Final UID can read exact fonts/licences; files remain regular, root-owned and non-writable. */
function expectPackagedFonts(image: string): void {
  const files = JSON.parse(readFileSync(join(EDGE, "pds-fonts.json"), "utf8")) as { copy: string; sha256: string }[];
  for (const file of files) {
    const path = `/etc/caddy/${file.copy}`;
    const hashed = docker(["run", "--rm", "--entrypoint", "sha256sum", image, path], CALL_MS);
    expect(hashed.code).toBe(0);
    expect(hashed.out.trim()).toBe(`${file.sha256}  ${path}`);
    const stat = docker(["run", "--rm", "--entrypoint", "stat", image, "-c", "%u:%g:%a:%h:%F", path], CALL_MS);
    expect(stat.code).toBe(0);
    expect(stat.out.trim()).toBe("0:0:644:1:regular file");
  }
}
