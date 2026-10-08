// P1.28: what the edge's files must say, read without starting Caddy (the running edge is tested in
// tests/integration/deployment/edge/). Certificates come from Let's Encrypt only; the rate limiter keeps client
// addresses in memory and nowhere else (ADR 0018, invariant 3); the image is built from pinned versions only.
import {
  cpSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type EdgeFiles, edgeSiteProblems, readEdgeConfig } from "./caddyfile.ts";

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

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});
/**
 * A copy of the edge's config files with `edits` written over them (a null edit deletes the file), and a
 * sites/enabled directory linking to sites/pds.caddy, as P1.29 and P5 mount it.
 */
function edgeTree(edits: Record<string, string | null> = {}): { edgeDir: string; sitesDir: string } {
  const edgeDir = mkdtempSync(join(tmpdir(), "edge-"));
  trees.push(edgeDir);
  for (const part of ["Caddyfile", "snippets", "sites"])
    cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
  const sitesDir = join(edgeDir, "sites", "enabled");
  mkdirSync(sitesDir);
  symlinkSync(join(edgeDir, "sites", "pds.caddy"), join(sitesDir, "pds.caddy"));
  for (const [file, text] of Object.entries(edits)) {
    if (text === null) rmSync(join(edgeDir, file));
    else writeFileSync(join(edgeDir, file), text);
  }
  return { edgeDir, sitesDir };
}
/** The shipped config, or an edited copy, read through the one edge reader (P1.28e). */
const shippedConfig = (edits: Record<string, string | null> = {}) => {
  const { edgeDir, sitesDir } = edgeTree(edits);
  return readEdgeConfig(edgeDir, sitesDir, ENV, FILES);
};
const siteProblems = (edits: Record<string, string | null> = {}) => edgeSiteProblems(shippedConfig(edits));

/** The zones of the pds-ratelimit snippet's first rate_limit block, in order. */
function zones() {
  const limit = shippedConfig()
    .snippet("pds-ratelimit")
    .find((directive) => directive.name === "rate_limit");
  return (limit?.block ?? [])
    .filter((directive) => directive.name === "zone")
    .map((zone) => {
      const value = (name: string) => zone.block?.find((directive) => directive.name === name)?.args[0];
      return {
        name: zone.args[0] ?? "",
        key: value("key"),
        ipv6Prefix: value("ipv6_prefix"),
        events: Number(value("events")),
        window: value("window"),
      };
    });
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
    for (const zone of zones()) {
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
    const shipped = Object.fromEntries(zones().map((z) => [z.name, { events: z.events, window: z.window }]));
    expect(shipped).toEqual(limits.rateLimitZones);
  });

  test("every_pds_route_has_a_zone", () => {
    expect(siteProblems()).toEqual([]);
  });

  test("pds_route_without_zone_fails", () => {
    // P1.28b: the negative twin. A PDS site whose route skips the zones, imports them after another handler or twice,
    // or a global zone narrowed by a matcher, each leaves some PDS request uncounted.
    const limits = read("snippets/ratelimit.caddy");
    const site = read("sites/pds.caddy");
    const pds = (text: string) => siteProblems({ "sites/pds.caddy": text });
    expect(pds(site.replace("\t\timport pds-ratelimit\n", ""))).toEqual([
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: 0 rate_limit blocks",
    ]);
    const late = site.replace(
      "\t\timport pds-ratelimit\n\t\timport xrpc-guard\n",
      "\t\timport xrpc-guard\n\t\timport pds-ratelimit\n",
    );
    expect(late).not.toBe(site);
    expect(pds(late)).toEqual(["{$PDS_HOST}: the route does not apply the zones first"]);
    // P1.28h (#463 verification, D2): a route behind a matcher, a second route, or a second rate_limit block.
    const matched = site.replace("\troute {\n", "\troute /never-matches {\n");
    expect(matched).not.toBe(site);
    expect(pds(matched)).toEqual([
      "{$PDS_HOST}: not exactly one plain route",
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: a reverse_proxy is outside the route",
    ]);
    const second = site.replace("\troute {\n", "\troute {\n\t\trespond 200\n\t}\n\troute {\n");
    expect(pds(second)).toEqual([
      "{$PDS_HOST}: not exactly one plain route",
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: a reverse_proxy is outside the route",
    ]);
    const forwarded = limits.replace(
      /\t\tdisable_metrics\n\t\}\n/,
      "\t\tdisable_metrics\n\t}\n\trate_limit {\n\t\tzone xff {\n\t\t\tkey {remote_host}\n\t\t\tevents 1\n\t\t\twindow 1m\n\t\t}\n\t}\n",
    );
    expect(forwarded).not.toBe(limits);
    expect(siteProblems({ "snippets/ratelimit.caddy": forwarded })).toEqual([
      "the zones snippet holds 2 rate_limit blocks",
      "{$PDS_HOST}: 2 rate_limit blocks",
    ]);
    const narrowed = limits.replace(/(\tzone global \{\n)/, "$1\t\t\tmatch {\n\t\t\t\tpath /xrpc/*\n\t\t\t}\n");
    expect(narrowed).not.toBe(limits);
    expect(siteProblems({ "snippets/ratelimit.caddy": narrowed })).toEqual(["the global zone has a matcher"]);
    expect(
      siteProblems({ "snippets/ratelimit.caddy": limits.replace(/\tzone global \{/, "\tzone overall {") }),
    ).toEqual(["there is no global zone"]);
  });

  test("edge_site_rules_apply_to_every_upstream", () => {
    // P1.28e (architecture amendment 7, point 3): the rule follows the upstream, not the PDS host's name.
    const site = read("sites/pds.caddy");
    const upstream = read("snippets/upstream.caddy");
    const extra = (text: string) => ({ "sites/other.caddy": text });
    const enable = (edits: Record<string, string>) => {
      const { edgeDir, sitesDir } = edgeTree(edits);
      for (const file of Object.keys(edits)) {
        if (file.startsWith("sites/")) symlinkSync(join(edgeDir, file), join(sitesDir, file.slice("sites/".length)));
      }
      return edgeSiteProblems(readEdgeConfig(edgeDir, sitesDir, ENV, FILES));
    };
    // A second site whose route proxies without the zones; a proxy written straight in a site the reader refuses.
    expect(enable(extra("other.unset.test {\n\troute {\n\t\timport upstream other:80\n\t}\n}\n"))).toEqual([
      "other.unset.test: a literal site address is not loopback",
      "other.unset.test: a site other than {$PDS_HOST} has an upstream",
      "other.unset.test: the route does not apply the zones first",
      "other.unset.test: a reverse_proxy does not name one placeholder upstream",
      "other.unset.test: 0 rate_limit blocks",
    ]);
    expect(() => enable(extra("other.unset.test {\n\timport upstream other:80\n}\n"))).toThrow(
      "directive reverse_proxy is not allowed in site",
    );
    // A proxy outside the route.
    const outside = site.replace("\troute {\n", "\troute /other {\n\t\timport upstream other:80\n\t}\n\troute {\n");
    expect(outside).not.toBe(site);
    expect(siteProblems({ "sites/pds.caddy": outside })).toEqual([
      "{$PDS_HOST}: not exactly one plain route",
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: a reverse_proxy is outside the route",
      "{$PDS_HOST}: a reverse_proxy does not name one placeholder upstream",
    ]);
    // A missing header_up, and one that sets a removed header again.
    expect(siteProblems({ "snippets/upstream.caddy": upstream.replace("\t\theader_up -X-Real-IP\n", "") })).toEqual([
      "{$PDS_HOST}: a reverse_proxy passes X-Real-IP",
    ]);
    const reset = upstream.replace(
      "\t\theader_up -Forwarded\n",
      "\t\theader_up -Forwarded\n\t\theader_up forwarded x\n",
    );
    expect(siteProblems({ "snippets/upstream.caddy": reset })).toEqual([
      "{$PDS_HOST}: a reverse_proxy passes Forwarded",
    ]);
    // A public site with no upstream, and one bound to loopback but named for a public host.
    expect(enable(extra("other.unset.test {\n\trespond 200\n}\n"))).toEqual([
      "other.unset.test: a literal site address is not loopback",
      "other.unset.test: public site without rate limit",
    ]);
    expect(enable(extra("other.unset.test {\n\tbind 127.0.0.1\n\trespond 200\n}\n"))).toEqual([
      "other.unset.test: a literal site address is not loopback",
      "other.unset.test: public site without rate limit",
    ]);
    expect(enable(extra("http://127.0.0.1:8082 {\n\trespond 200\n}\n"))).toEqual([
      "http://127.0.0.1:8082: public site without rate limit",
    ]);
    expect(enable(extra("http://[::1]:8082 {\n\tbind ::1\n\trespond 200\n}\n"))).toEqual([]);
  });

  test("edge_admin_api_off_in_config", () => {
    expect(read("Caddyfile")).toMatch(/^\tadmin off$/m);
    expect(read("Caddyfile")).toMatch(/^\tpersist_config off$/m);
    expect(config()).not.toMatch(/trusted_proxies/);
  });
});

describe("edge config reader (P1.28e)", () => {
  // The two file imports resolved as Caddy v2.11.7 does (caddyconfig/caddyfile/parse.go doImport: filepath.Glob, whose
  // glob() sorts names, go1.25 src/path/filepath/match.go), and everything Caddy would read differently refused.
  const load = (tree: { edgeDir: string; sitesDir: string }) => () =>
    readEdgeConfig(tree.edgeDir, tree.sitesDir, ENV, FILES);

  test("edge_config_reads_shipped_sites", () => {
    const config = shippedConfig();
    expect(config.sites.map((site) => site.addresses)).toEqual([["http://127.0.0.1:8081"], [ENV.PDS_HOST]]);
  });

  test("edge_config_sites_dir_entries_refused", () => {
    const outside = edgeTree();
    writeFileSync(join(outside.edgeDir, "elsewhere.caddy"), "other.unset.test {\n\trespond 200\n}\n");
    symlinkSync(join(outside.edgeDir, "elsewhere.caddy"), join(outside.sitesDir, "z.caddy"));
    expect(load(outside)).toThrow("z.caddy: the link leaves sites/");
    // A sibling whose name starts with "sites", and a chain whose last hop leaves sites/, both fail too.
    const sibling = edgeTree();
    mkdirSync(join(sibling.edgeDir, "sites-evil"));
    writeFileSync(join(sibling.edgeDir, "sites-evil", "x.caddy"), "other.unset.test {\n\trespond 200\n}\n");
    symlinkSync(join(sibling.edgeDir, "sites-evil", "x.caddy"), join(sibling.sitesDir, "x.caddy"));
    expect(load(sibling)).toThrow("x.caddy: the link leaves sites/");
    const chain = edgeTree();
    writeFileSync(join(chain.edgeDir, "elsewhere.caddy"), "other.unset.test {\n\trespond 200\n}\n");
    symlinkSync(join(chain.edgeDir, "elsewhere.caddy"), join(chain.edgeDir, "sites", "hop.caddy"));
    symlinkSync(join(chain.edgeDir, "sites", "hop.caddy"), join(chain.sitesDir, "hop.caddy"));
    expect(load(chain)).toThrow("hop.caddy: the link leaves sites/");
    const subdir = edgeTree();
    mkdirSync(join(subdir.sitesDir, "more"));
    expect(load(subdir)).toThrow("more: not a .caddy file");
    const other = edgeTree();
    writeFileSync(join(other.sitesDir, "notes.txt"), "");
    expect(load(other)).toThrow("notes.txt: not a .caddy file");
    const hidden = edgeTree();
    writeFileSync(join(hidden.sitesDir, ".old.caddy"), "");
    expect(load(hidden)).toThrow(".old.caddy: not a .caddy file");
    const dangling = edgeTree();
    symlinkSync(join(dangling.edgeDir, "sites", "gone.caddy"), join(dangling.sitesDir, "gone.caddy"));
    expect(load(dangling)).toThrow("gone.caddy: dangling link");
    const linkedDir = edgeTree();
    mkdirSync(join(linkedDir.edgeDir, "sites", "x.caddy"));
    symlinkSync(join(linkedDir.edgeDir, "sites", "x.caddy"), join(linkedDir.sitesDir, "x.caddy"));
    expect(load(linkedDir)).toThrow("x.caddy: the link target is not a regular file");
    // A link in snippets/ is refused: only sites/enabled holds links.
    const snippetLink = edgeTree();
    symlinkSync(join(snippetLink.edgeDir, "sites", "pds.caddy"), join(snippetLink.edgeDir, "snippets", "z.caddy"));
    expect(load(snippetLink)).toThrow("z.caddy: not a regular file");
  });

  test("edge_config_imports_refused", () => {
    const caddyfile = read("Caddyfile");
    const empty = edgeTree();
    rmSync(join(empty.sitesDir, "pds.caddy"));
    expect(load(empty)).toThrow("import sites/enabled/*.caddy matches nothing");
    const extra = edgeTree({ Caddyfile: `${caddyfile}\nimport extra.caddy\n` });
    writeFileSync(join(extra.edgeDir, "extra.caddy"), "");
    expect(load(extra)).toThrow("file imports are refused");
    const twice = edgeTree({ Caddyfile: `${caddyfile}\nimport snippets/*.caddy\n` });
    expect(load(twice)).toThrow("the Caddyfile must import snippets/*.caddy exactly once");
    const indented = edgeTree({
      Caddyfile: caddyfile.replace("import sites/enabled/*.caddy", " import sites/enabled/*.caddy"),
    });
    expect(load(indented)).toThrow("the Caddyfile must import sites/enabled/*.caddy exactly once");
    // An included file's own file import is not expanded again.
    const nested = edgeTree({ "sites/pds.caddy": `${read("sites/pds.caddy")}\nimport snippets/*.caddy\n` });
    expect(load(nested)).toThrow("file imports are refused");
  });
});

describe("edge reader containment (P1.28f)", () => {
  // Architecture amendment 8 to 2026-10-07-p130s-networks-and-caddyfile-reader, point 1; step book
  // 2026-10-08-p128f-p128g-edge-reader-follow-ups. Every fixture goes through the real node:fs adapter.
  const load =
    (tree: { edgeDir: string; sitesDir: string }, files: EdgeFiles = FILES) =>
    () =>
      readEdgeConfig(tree.edgeDir, tree.sitesDir, ENV, files);
  const outsideDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "outside-"));
    trees.push(dir);
    return dir;
  };

  test("edge_reader_symlinked_sites_enabled_fails", () => {
    const tree = edgeTree();
    const outside = outsideDir();
    cpSync(join(EDGE, "sites", "pds.caddy"), join(outside, "pds.caddy"));
    rmSync(tree.sitesDir, { recursive: true });
    symlinkSync(outside, tree.sitesDir);
    expect(load(tree)).toThrow("the enabled sites directory is not inside sites/");
  });

  test("edge_reader_symlinked_sites_fails", () => {
    const tree = edgeTree();
    const outside = join(outsideDir(), "sites");
    cpSync(join(tree.edgeDir, "sites"), outside, { recursive: true, verbatimSymlinks: true });
    rmSync(join(tree.edgeDir, "sites"), { recursive: true });
    symlinkSync(outside, join(tree.edgeDir, "sites"));
    expect(load(tree)).toThrow("sites/ leaves the edge directory");
  });

  test("edge_reader_sites_dir_outside_tree_fails", () => {
    const tree = edgeTree();
    const outside = outsideDir();
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(outside, "pds.caddy"));
    expect(load({ edgeDir: tree.edgeDir, sitesDir: outside })).toThrow(
      "the enabled sites directory is not inside sites/",
    );
    // Its real path counts, not how it is written.
    expect(load({ edgeDir: tree.edgeDir, sitesDir: `${tree.edgeDir}/sites/../../${basename(outside)}` })).toThrow(
      "the enabled sites directory is not inside sites/",
    );
  });

  test("edge_reader_file_through_symlinked_parent_fails", () => {
    const tree = edgeTree();
    const outside = join(outsideDir(), "snippets");
    cpSync(join(tree.edgeDir, "snippets"), outside, { recursive: true });
    rmSync(join(tree.edgeDir, "snippets"), { recursive: true });
    symlinkSync(outside, join(tree.edgeDir, "snippets"));
    expect(load(tree)).toThrow("log.caddy: the file is not inside snippets/");
  });

  test("edge_reader_hard_linked_file_fails", () => {
    const tree = edgeTree();
    linkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(outsideDir(), "pds.caddy"));
    expect(load(tree)).toThrow("pds.caddy: the file has 2 hard links");
    const snippet = edgeTree();
    linkSync(join(snippet.edgeDir, "snippets", "tls.caddy"), join(outsideDir(), "tls.caddy"));
    expect(load(snippet)).toThrow("tls.caddy: the file has 2 hard links");
  });

  test("edge_reader_checks_adapter_answers", () => {
    // An adapter answering `root/sites/../../x` would pass a bare prefix check.
    const tree = edgeTree();
    const outside = outsideDir();
    writeFileSync(join(outside, "x.caddy"), "other.unset.test {\n\trespond 200\n}\n");
    const lying = (from: string, to: string): EdgeFiles => ({
      ...FILES,
      realpath: (path) => (path === from ? to : FILES.realpath(path)),
    });
    const entry = join(tree.sitesDir, "pds.caddy");
    const outward = `${realpathSync(tree.edgeDir)}/sites/../../${outside.slice(1)}/x.caddy`;
    expect(load(tree, lying(entry, outward))).toThrow("pds.caddy resolves to a path that is not absolute and normal");
    expect(load(tree, lying(tree.edgeDir, "relative/edge"))).toThrow(
      "the edge directory resolves to a path that is not absolute and normal",
    );
    expect(load(tree, lying(tree.edgeDir, `${realpathSync(tree.edgeDir)}/`))).toThrow("not absolute and normal");
    expect(load(tree, lying(tree.edgeDir, `${realpathSync(tree.edgeDir)}/./x`))).toThrow("not absolute and normal");
  });

  test("edge_reader_bounds_caddyfile_sites_dir_and_link_targets", () => {
    // Mutation pins (verification of #541): the Caddyfile's own bound, the sitesDir path boundary, and a link target
    // that must be a .caddy file.
    const tree = edgeTree();
    const outside = outsideDir();
    cpSync(join(EDGE, "Caddyfile"), join(outside, "Caddyfile"));
    const files: EdgeFiles = {
      ...FILES,
      realpath: (path) =>
        path === `${realpathSync(tree.edgeDir)}/Caddyfile`
          ? realpathSync(join(outside, "Caddyfile"))
          : FILES.realpath(path),
    };
    expect(load(tree, files)).toThrow("Caddyfile: the file is not inside the edge directory");
    const sibling = join(tree.edgeDir, "sites-evil");
    mkdirSync(sibling);
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(sibling, "pds.caddy"));
    expect(load({ edgeDir: tree.edgeDir, sitesDir: sibling })).toThrow(
      "the enabled sites directory is not inside sites/",
    );
    expect(load({ edgeDir: tree.edgeDir, sitesDir: join(tree.edgeDir, "sites") })).toThrow(
      "the enabled sites directory is not inside sites/",
    );
    const notes = edgeTree();
    writeFileSync(join(notes.edgeDir, "sites", "notes.txt"), "other.unset.test {\n\trespond 200\n}\n");
    symlinkSync(join(notes.edgeDir, "sites", "notes.txt"), join(notes.sitesDir, "x.caddy"));
    expect(load(notes)).toThrow("x.caddy: the link target is not a regular file");
  });

  test("edge_reader_legitimate_link_reads", () => {
    expect(load(edgeTree())().sites.map((site) => site.addresses)).toEqual([["http://127.0.0.1:8081"], [ENV.PDS_HOST]]);
  });

  test("edge_reader_snippets_in_byte_order", () => {
    // Mutation pin for the sort: Caddy reads B.caddy before a.caddy (byte order), so the snippet B defines exists
    // when a imports it; in any other order a's import comes first and fails.
    const tree = edgeTree();
    writeFileSync(join(tree.edgeDir, "snippets", "B.caddy"), "(late) {\n\thttp://[::1]:8083 {\n\t\tbind ::1\n\t}\n}\n");
    writeFileSync(join(tree.edgeDir, "snippets", "a.caddy"), "import late\n");
    expect(load(tree)().sites.map((site) => site.addresses[0])).toEqual([
      "http://[::1]:8083",
      "http://127.0.0.1:8081",
      ENV.PDS_HOST,
    ]);
  });
});

describe("edge site rules (P1.28f)", () => {
  const limits = read("snippets/ratelimit.caddy");
  const site = read("sites/pds.caddy");
  /** The site rules over the shipped tree plus each `sites/<name>` in `extra`, linked into sites/enabled. */
  const withSites = (extra: Record<string, string>, env: typeof ENV = ENV, edits: Record<string, string> = {}) => {
    const { edgeDir, sitesDir } = edgeTree({ ...edits, ...extra });
    for (const file of Object.keys(extra)) {
      symlinkSync(join(edgeDir, file), join(sitesDir, file.slice("sites/".length)));
    }
    return edgeSiteProblems(readEdgeConfig(edgeDir, sitesDir, env, FILES));
  };

  test("edge_zones_written_in_place_fail", () => {
    // Mutation pin for the via check: the same rate_limit block written straight into the route, not imported from
    // pds-ratelimit, is not the zones (amendment 8, point 3).
    const body = limits.slice(limits.indexOf("\trate_limit {"), limits.lastIndexOf("}"));
    const inline = site.replace("\t\timport pds-ratelimit\n", body.replaceAll(/^/gm, "\t").replace(/\t$/, ""));
    expect(inline).not.toBe(site);
    expect(siteProblems({ "sites/pds.caddy": inline })).toEqual([
      "{$PDS_HOST}: the route does not apply the zones first",
    ]);
  });

  test("edge_upstream_proxied_by_two_sites_fails", () => {
    // Amendment 9, point 2: the one-site rule compares placeholder names, so a second site proxying {$PDS_UPSTREAM}
    // fails however it is addressed.
    const route = "\troute {\n\t\timport pds-ratelimit\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n";
    const shared = "{$PDS_HOST}: upstream proxied by more than one site";
    expect(withSites({ "sites/other.caddy": `{$PDS_HOST} {\n${route}}\n` })).toEqual([shared]);
    expect(withSites({ "sites/other.caddy": `other.unset.test {\n${route}}\n` })).toEqual([
      "other.unset.test: a literal site address is not loopback",
      "other.unset.test: a site other than {$PDS_HOST} has an upstream",
      "other.unset.test: {$PDS_UPSTREAM} is outside its position in reverse_proxy",
      shared,
    ]);
    expect(withSites({ "sites/other.caddy": `http://127.0.0.1:8082 {\n\tbind 127.0.0.1\n${route}}\n` })).toEqual([
      "http://127.0.0.1:8082: a site other than {$PDS_HOST} has an upstream",
      "http://127.0.0.1:8082: {$PDS_UPSTREAM} is outside its position in reverse_proxy",
      shared,
    ]);
  });

  test("edge_upstream_is_one_placeholder", () => {
    // Amendment 9, point 2 (replacing #541's canonical form): after an optional matcher, a reverse_proxy names exactly
    // one upstream, and it is a placeholder, so no literal can alias the value behind {$PDS_UPSTREAM}.
    const proxy = (args: string) =>
      site.replace(
        "\t\timport upstream {$PDS_UPSTREAM}\n",
        `\t\treverse_proxy ${args} {\n\t\t\theader_up -X-Forwarded-For\n\t\t\theader_up -X-Real-IP\n\t\t\theader_up -Forwarded\n\t\t}\n`,
      );
    const pds = (args: string) => siteProblems({ "sites/pds.caddy": proxy(args) });
    const literal = "{$PDS_HOST}: a reverse_proxy does not name one placeholder upstream";
    expect(pds("{$PDS_UPSTREAM}")).toEqual([]);
    // A matcher before the upstream is allowed.
    expect(pds("* {$PDS_UPSTREAM}")).toEqual([]);
    expect(pds("/xrpc/* {$PDS_UPSTREAM}")).toEqual([]);
    // Several upstreams fail, whichever comes first, and so does a literal one in any spelling.
    for (const args of [
      "{$PDS_UPSTREAM} other:80",
      "other:80 {$PDS_UPSTREAM}",
      "* other:80 {$PDS_UPSTREAM}",
      "localhost:3000",
      "127.0.0.1:3000",
      "[::1]:3000",
      "pds:3000",
      "upstream:3000",
      "http://upstream:3000",
      "* pds:3000",
    ]) {
      expect(pds(args), args).toContain(literal);
    }
    // The site address is not an upstream.
    expect(pds("{$PDS_HOST}")).toEqual(["{$PDS_HOST}: {$PDS_HOST} is outside its position in reverse_proxy"]);
  });

  test("edge_placeholders_only_in_their_position", () => {
    // Amendment 9, point 1: each placeholder has one position; anywhere else fails and names the token.
    const extra = (text: string) => withSites({ "sites/other.caddy": text });
    expect(extra("{$ACME_EMAIL} {\n\trespond 200\n}\n")).toEqual([
      "{$ACME_EMAIL}: {$ACME_EMAIL} is not a site address",
      "{$ACME_EMAIL}: public site without rate limit",
    ]);
    expect(extra("{$PDS_UPSTREAM} {\n\trespond 200\n}\n")).toEqual([
      "{$PDS_UPSTREAM}: {$PDS_UPSTREAM} is not a site address",
      "{$PDS_UPSTREAM}: public site without rate limit",
    ]);
    expect(extra("{$PDS_HOST} http://127.0.0.1:8082 {\n\trespond 200\n}\n")).toContain(
      "{$PDS_HOST} http://127.0.0.1:8082: {$PDS_HOST} shares its site with another address",
    );
    const pds = (from: string, to: string) => {
      const text = site.replace(from, to);
      expect(text).not.toBe(site);
      return siteProblems({ "sites/pds.caddy": text });
    };
    const at = "\timport tls\n";
    // In a header value, a matcher, a response body and a route's matcher.
    expect(pds(at, `${at}\theader X-Test {$PDS_HOST}\n`)).toEqual([
      "{$PDS_HOST}: {$PDS_HOST} is outside its position in header",
    ]);
    expect(
      pds("\t\timport pds-ratelimit\n", "\t\timport pds-ratelimit\n\t\t@host header_regexp Host {$PDS_HOST}\n"),
    ).toEqual(["{$PDS_HOST}: {$PDS_HOST} is outside its position in @host"]);
    expect(pds(at, `${at}\trespond {$PDS_UPSTREAM}\n`)).toEqual([
      "{$PDS_HOST}: {$PDS_UPSTREAM} is outside its position in respond",
    ]);
    expect(pds("\troute {\n", "\troute {$ACME_EMAIL} {\n")).toEqual([
      "{$PDS_HOST}: not exactly one plain route",
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: a reverse_proxy is outside the route",
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in route",
    ]);
    // {$ACME_EMAIL} only as the email of an `issuer acme` inside tls: not tls's own email shorthand, not another
    // issuer, and not the global options.
    expect(pds(at, `${at}\ttls {$ACME_EMAIL}\n`)).toEqual([
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in tls",
    ]);
    expect(pds(at, `\ttls {\n\t\tissuer zerossl {\n\t\t\temail {$ACME_EMAIL}\n\t\t}\n\t}\n`)).toEqual([
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in email",
    ]);
    for (const email of ["email {$ACME_EMAIL} x", "email x {$ACME_EMAIL}"]) {
      const tls = read("snippets/tls.caddy").replace("email {$ACME_EMAIL}", email);
      expect(withSites({}, ENV, { "snippets/tls.caddy": tls }), email).toEqual([
        "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in email",
      ]);
    }
    // The exact issuer acme: not another issuer argument, not another directive under it.
    const tls = read("snippets/tls.caddy");
    for (const [from, to, where] of [
      ["issuer acme {", "issuer acme x {", "email"],
      ["\t\t\temail {$ACME_EMAIL}\n", "\t\t\tdir {$ACME_EMAIL}\n", "dir"],
    ] as const) {
      const edited = tls.replace(from, to);
      expect(edited).not.toBe(tls);
      expect(withSites({}, ENV, { "snippets/tls.caddy": edited }), to).toContain(
        `{$PDS_HOST}: {$ACME_EMAIL} is outside its position in ${where}`,
      );
    }
    // Why the issuer name check cannot be reached on its own: a tls block at the root takes only issuer.
    expect(() => withSites({}, ENV, { "snippets/tls.caddy": tls.replace("issuer acme {", "other acme {") })).toThrow(
      "directive other is not allowed in tls",
    );
    // An issuer opened as a header field is not inside tls.
    expect(pds(at, `${at}\theader {\n\t\tissuer acme {\n\t\t\temail {$ACME_EMAIL}\n\t\t}\n\t}\n`)).toEqual([
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in email",
    ]);
    // The whole chain from the block root: a data block (header, fields) may open a level named tls, and a tls block
    // there is not the site's tls (coordinator verification of #552, item 1).
    const nested = "tls {\n\tissuer acme {\n\t\temail {$ACME_EMAIL}\n\t}\n}\n";
    const indent = (text: string, tabs: string) => text.replaceAll(/^(?=.)/gm, tabs);
    expect(pds(at, `${at}\theader {\n${indent(nested, "\t\t")}\t}\n`)).toEqual([
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in email",
    ]);
    const health = "http://127.0.0.1:8082 {\n\tbind 127.0.0.1\n\trespond 200\n";
    expect(withSites({ "sites/other.caddy": `${health}\theader {\n${indent(nested, "\t\t")}\t}\n}\n` })).toEqual([
      "http://127.0.0.1:8082: {$ACME_EMAIL} is outside its position in email",
    ]);
    const caddyfile = read("Caddyfile");
    const fields = caddyfile.replace(
      "\t\t\t\tremote_ip delete\n",
      `\t\t\t\tremote_ip delete\n${indent(nested, "\t\t\t\t")}`,
    );
    expect(fields).not.toBe(caddyfile);
    expect(withSites({}, ENV, { Caddyfile: fields })).toEqual([
      "the global options: {$ACME_EMAIL} is outside its position in email",
    ]);
    // The zones snippet is checked on its own too, so a site that does not import it cannot hide a placeholder there.
    const limitsWith = limits.replace("events 3000", "events {$PDS_HOST}");
    expect(limitsWith).not.toBe(limits);
    expect(
      withSites({}, ENV, {
        "sites/pds.caddy": site.replace("\t\timport pds-ratelimit\n", ""),
        "snippets/ratelimit.caddy": limitsWith,
      }),
    ).toEqual([
      "the zones snippet: {$PDS_HOST} is outside its position in events",
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: 0 rate_limit blocks",
    ]);
    expect(
      withSites({}, ENV, {
        Caddyfile: read("Caddyfile").replace("\tadmin off\n", "\tadmin off\n\tlog {$ACME_EMAIL}\n"),
      }),
    ).toEqual(["the global options: {$ACME_EMAIL} is outside its position in log"]);
  });

  test("edge_messages_never_carry_env_values", () => {
    // Amendment 8, point 5 and amendment 9, point 3: every rule's failure path runs under sentinel values, and a
    // message names a site by its address token, never by a value from env.
    const env = { ...ENV, ACME_EMAIL: "acme-sentinel@unset.test", PDS_UPSTREAM: "upstream-sentinel:3000" };
    const messages: string[] = [];
    const caught = (run: () => unknown) => {
      try {
        messages.push(...((run() as string[] | undefined) ?? []));
      } catch (error) {
        messages.push((error as Error).message);
      }
    };
    const pds = (text: string) => {
      expect(text).not.toBe(site);
      caught(() => withSites({}, env, { "sites/pds.caddy": text }));
    };
    const edit = (edits: Record<string, string>) => caught(() => withSites({}, env, edits));
    const extra = (text: string) => caught(() => withSites({ "sites/other.caddy": text }, env));
    const upstream = read("snippets/upstream.caddy");
    const at = "\timport tls\n";
    const route = "\troute {\n\t\timport pds-ratelimit\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n";
    // The site rules.
    pds(site.replace("\t\timport pds-ratelimit\n", ""));
    pds(site.replace("\troute {\n", "\troute /x {\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n\troute {\n"));
    pds(site.replace("\troute {\n", "\troute {\n\t\trespond 200\n\t}\n\troute {\n"));
    pds(site.replace("import upstream {$PDS_UPSTREAM}", "import upstream {$PDS_UPSTREAM} other:80"));
    pds(site.replace("import upstream {$PDS_UPSTREAM}", "reverse_proxy other:80 {$PDS_UPSTREAM}"));
    edit({ "snippets/upstream.caddy": upstream.replace("\t\theader_up -X-Real-IP\n", "") });
    // The zones: the count, the global zone and its matcher.
    edit({ "snippets/ratelimit.caddy": limits.replace("zone global {", "zone overall {") });
    edit({ "snippets/ratelimit.caddy": limits.replace("\trate_limit {\n", "\trate_limit {\n\t}\n\trate_limit {\n") });
    edit({
      "snippets/ratelimit.caddy": limits.replace(
        "zone global {\n",
        "zone global {\n\t\t\tmatch {\n\t\t\t\tpath /x\n\t\t\t}\n",
      ),
    });
    // The placeholder positions: as a directive, a snippet, part of a word, a site address and in a value.
    for (const name of ["ACME_EMAIL", "PDS_UPSTREAM"]) {
      pds(site.replace(at, `\t{$${name}} on\n`));
      pds(site.replace(at, `\timport {$${name}}\n`));
      pds(site.replace(at, `\tlog_append x {$${name}}{args[0]}\n`));
      pds(site.replace(at, `${at}\theader X-Test {$${name}}\n`));
      pds(site.replace(at, `${at}\tbind {$${name}}\n`));
      pds(
        site.replace(
          "\t\timport pds-ratelimit\n",
          `\t\timport pds-ratelimit\n\t\t@host header_regexp Host {$${name}}\n`,
        ),
      );
      extra(`{$${name}} {\n\trespond 200\n}\n`);
      extra(`{$${name}} {\n${route}}\n`);
      edit({ Caddyfile: read("Caddyfile").replace("\tadmin off\n", `\tadmin off\n\tlog {$${name}}\n`) });
    }
    pds(site.replace(at, `${at}\ttls {$ACME_EMAIL}\n`));
    // Errors raised while parsing, before any rule runs (main's pin, restored after verification of #552, item 2).
    for (const name of ["ACME_EMAIL", "PDS_UPSTREAM"]) {
      caught(() => withSites({ "sites/other.caddy": `"{$${name}}" {\n\trespond 200\n}\n` }, env));
      pds(site.replace("\t\timport pds-ratelimit\n", `\t\timport pds-ratelimit\n\t\t@m {$${name}}\n`));
    }
    extra("other.unset.test {\n\trespond 200\n}\n");
    extra(`other.unset.test {\n${route}}\n`);
    // A snippet no site imports is read later, by snippet(); its errors are redacted too (verification of #541, F1).
    const unimported = site.replace("\t\timport pds-ratelimit\n", "");
    for (const name of ["ACME_EMAIL", "PDS_UPSTREAM"]) {
      for (const line of [`{$${name}} on`, `@m {$${name}}`]) {
        const limitsWith = limits.replace("\trate_limit {\n", `\t${line}\n\trate_limit {\n`);
        edit({ "sites/pds.caddy": unimported, "snippets/ratelimit.caddy": limitsWith });
      }
    }
    // Each rule's message came back, with placeholders named and no value.
    for (const expected of [
      "{$PDS_HOST}: the route does not apply the zones first",
      "{$PDS_HOST}: a reverse_proxy is outside the route",
      "{$PDS_HOST}: not exactly one plain route",
      "{$PDS_HOST}: a reverse_proxy does not name one placeholder upstream",
      "{$PDS_HOST}: a reverse_proxy passes X-Real-IP",
      "there is no global zone",
      "the zones snippet holds 2 rate_limit blocks",
      "the global zone has a matcher",
      "{$PDS_HOST}: {$ACME_EMAIL} is outside its position in tls",
      "other.unset.test: a literal site address is not loopback",
      "other.unset.test: {$PDS_UPSTREAM} is outside its position in reverse_proxy",
      "{$PDS_HOST}: upstream proxied by more than one site",
    ]) {
      expect(messages).toContain(expected);
    }
    for (const name of ["ACME_EMAIL", "PDS_UPSTREAM"]) {
      for (const expected of [
        `{$${name}} cannot name a directive`,
        `{$${name}} cannot name a snippet`,
        `{$PDS_HOST}: {$${name}} is outside its position in header`,
        `{$PDS_HOST}: {$${name}} is outside its position in bind`,
        `{$PDS_HOST}: {$${name}} is outside its position in @host`,
        `{$${name}}: {$${name}} is not a site address`,
        `{$${name}}: a site other than {$PDS_HOST} has an upstream`,
        `the global options: {$${name}} is outside its position in log`,
      ]) {
        expect(messages).toContainEqual(expect.stringContaining(expected));
      }
      for (const why of ["\\{\\$NAME\\} cannot name a directive", "matcher \\{\\$NAME\\} is not allowed"]) {
        const snippet = new RegExp(`^the zones snippet is unreadable: line \\d+: ${why.replace("NAME", name)}`);
        expect(messages).toContainEqual(expect.stringMatching(snippet));
      }
    }
    expect(messages).toContainEqual(expect.stringContaining("an environment placeholder must be a whole word"));
    for (const name of ["ACME_EMAIL", "PDS_UPSTREAM"]) {
      expect(messages).toContainEqual(expect.stringContaining(`quoted top-level token "{$${name}}" is not supported`));
      expect(messages).toContainEqual(expect.stringContaining(`matcher {$${name}} is not allowed`));
    }
    for (const message of messages) {
      expect(message).not.toContain(env.ACME_EMAIL);
      expect(message).not.toContain(env.PDS_UPSTREAM);
    }
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
