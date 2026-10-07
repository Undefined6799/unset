// P1.28h, split out by P1.28i: the Caddyfile reader agrees with `caddy adapt` on the shipped config. It builds the edge
// image, so it lives in an *.image.test.ts file (step book P1.28i; architecture record
// 2026-10-07-test-timing-fuzz-and-image-tests), apart from the reader's unit tests in caddyfile.test.ts.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { readCaddyfile } from "./caddyfile.ts";

// The reader against Caddy itself: the shipped Caddyfile, with the PDS site enabled as P1.29 and P5 mount it, adapted
// by the built edge image (`caddy adapt`, Caddy v2.11.7). It carries no skip of its own (P1.28j): without Docker it
// fails, and whether the images project runs locally is run.ts's decision (P1.28r). The test builds and runs
// the image itself with node built-ins (architecture amendment 3 to 2026-10-07-p130s-networks-and-caddyfile-reader):
// a trusted test owns its inputs, and first proves the image holds the repository's config byte for byte.
const EDGE = import.meta.dirname;
const PDS_HOST = "pds.unset.test";
const built: string[] = [];

function docker(args: readonly string[]): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

/** Builds deployment/edge/Dockerfile with deployment/edge as the context; the image id. */
function buildEdgeImage(): string {
  const result = docker(["build", "-q", "-f", join(EDGE, "Dockerfile"), EDGE]);
  if (result.code !== 0) throw new Error(`edge image build failed: ${result.err.slice(-2000)}`);
  built.push(result.out.trim());
  return result.out.trim();
}

/** The config files the image holds under /etc/caddy, by their repository path under deployment/edge. */
function imageConfig(image: string): Record<string, string> {
  const listed = docker(["run", "--rm", "--entrypoint", "ls", image, "/etc/caddy/snippets"]);
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
      const read = docker(["run", "--rm", "--entrypoint", "cat", image, `/etc/caddy/${file}`]);
      if (read.code !== 0) throw new Error(`reading /etc/caddy/${file} failed: ${read.err.slice(-2000)}`);
      return [file, read.out];
    }),
  );
}

describe("caddyfile reader against caddy adapt", () => {
  const env = { PDS_HOST, PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };
  afterAll(() => {
    for (const image of built) docker(["rmi", "-f", image]);
  });

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
    const theirs = adapt(image, env);
    const ours = readCaddyfile(shippedConfig(), env);
    expect(ours.sites.flatMap((site) => site.addresses.map(hostOf)).sort()).toEqual(adaptedHosts(theirs).sort());
    const route = ours.sites
      .find((site) => site.addresses.includes(PDS_HOST))
      ?.directives.find((directive) => directive.name === "route");
    const handlers = (route?.block ?? []).filter((d) => !d.name.startsWith("@")).map((d) => HANDLER[d.name] ?? d.name);
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
  }, 600_000);
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
