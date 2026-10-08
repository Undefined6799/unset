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
      "pds.unset.test: the route does not apply the zones first",
      "pds.unset.test: 0 rate_limit blocks",
    ]);
    const late = site.replace(
      "\t\timport pds-ratelimit\n\t\timport xrpc-guard\n",
      "\t\timport xrpc-guard\n\t\timport pds-ratelimit\n",
    );
    expect(late).not.toBe(site);
    expect(pds(late)).toEqual(["pds.unset.test: the route does not apply the zones first"]);
    // P1.28h (#463 verification, D2): a route behind a matcher, a second route, or a second rate_limit block.
    const matched = site.replace("\troute {\n", "\troute /never-matches {\n");
    expect(matched).not.toBe(site);
    expect(pds(matched)).toEqual([
      "pds.unset.test: not exactly one plain route",
      "pds.unset.test: the route does not apply the zones first",
      "pds.unset.test: a reverse_proxy is outside the route",
    ]);
    const second = site.replace("\troute {\n", "\troute {\n\t\trespond 200\n\t}\n\troute {\n");
    expect(pds(second)).toEqual([
      "pds.unset.test: not exactly one plain route",
      "pds.unset.test: the route does not apply the zones first",
      "pds.unset.test: a reverse_proxy is outside the route",
    ]);
    const forwarded = limits.replace(
      /\t\tdisable_metrics\n\t\}\n/,
      "\t\tdisable_metrics\n\t}\n\trate_limit {\n\t\tzone xff {\n\t\t\tkey {remote_host}\n\t\t\tevents 1\n\t\t\twindow 1m\n\t\t}\n\t}\n",
    );
    expect(forwarded).not.toBe(limits);
    expect(siteProblems({ "snippets/ratelimit.caddy": forwarded })).toEqual([
      "the zones snippet holds 2 rate_limit blocks",
      "pds.unset.test: 2 rate_limit blocks",
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
      "other.unset.test: the route does not apply the zones first",
      "other.unset.test: 0 rate_limit blocks",
    ]);
    expect(() => enable(extra("other.unset.test {\n\timport upstream other:80\n}\n"))).toThrow(
      "directive reverse_proxy is not allowed in site",
    );
    // A proxy outside the route.
    const outside = site.replace("\troute {\n", "\troute /other {\n\t\timport upstream other:80\n\t}\n\troute {\n");
    expect(outside).not.toBe(site);
    expect(siteProblems({ "sites/pds.caddy": outside })).toEqual([
      "pds.unset.test: not exactly one plain route",
      "pds.unset.test: the route does not apply the zones first",
      "pds.unset.test: a reverse_proxy is outside the route",
    ]);
    // A missing header_up, and one that sets a removed header again.
    expect(siteProblems({ "snippets/upstream.caddy": upstream.replace("\t\theader_up -X-Real-IP\n", "") })).toEqual([
      "pds.unset.test: a reverse_proxy passes X-Real-IP",
    ]);
    const reset = upstream.replace(
      "\t\theader_up -Forwarded\n",
      "\t\theader_up -Forwarded\n\t\theader_up forwarded x\n",
    );
    expect(siteProblems({ "snippets/upstream.caddy": reset })).toEqual([
      "pds.unset.test: a reverse_proxy passes Forwarded",
    ]);
    // A public site with no upstream, and one bound to loopback but named for a public host.
    expect(enable(extra("other.unset.test {\n\trespond 200\n}\n"))).toEqual([
      "other.unset.test: public site without rate limit",
    ]);
    expect(enable(extra("other.unset.test {\n\tbind 127.0.0.1\n\trespond 200\n}\n"))).toEqual([
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
      "pds.unset.test: the route does not apply the zones first",
    ]);
  });

  test("edge_upstream_proxied_by_two_sites_fails", () => {
    const second =
      "other.unset.test {\n\troute {\n\t\timport pds-ratelimit\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n}\n";
    expect(withSites({ "sites/other.caddy": second })).toEqual([
      "pds.unset.test: upstream proxied by more than one site",
    ]);
    // A different upstream is fine.
    expect(withSites({ "sites/other.caddy": second.replace("{$PDS_UPSTREAM}", "other:80") })).toEqual([]);
  });

  test("edge_messages_never_carry_env_values", () => {
    // Amendment 8, point 5: a message names a site address and nothing else from env.
    const env = { ...ENV, ACME_EMAIL: "acme-sentinel@unset.test", PDS_UPSTREAM: "upstream-sentinel:3000" };
    const messages: string[] = [];
    const caught = (run: () => unknown) => {
      try {
        messages.push(...((run() as string[] | undefined) ?? []));
      } catch (error) {
        messages.push((error as Error).message);
      }
    };
    const pds = (text: string) => withSites({}, env, { "sites/pds.caddy": text });
    const upstream = read("snippets/upstream.caddy");
    for (const text of [
      site.replace("\t\timport pds-ratelimit\n", ""),
      site.replace("\troute {\n", "\troute /x {\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n\troute {\n"),
      site.replace("\troute {\n", "\troute {\n\t\trespond 200\n\t}\n\troute {\n"),
      site.replace("\timport tls\n", "\t{$ACME_EMAIL} on\n"),
      site.replace("\timport tls\n", "\tbind {$PDS_UPSTREAM}\n"),
      site.replace("\timport tls\n", "\timport {$ACME_EMAIL}\n"),
      site.replace("\timport tls\n", "\tlog_append x {$ACME_EMAIL}{args[0]}\n"),
    ]) {
      caught(() => pds(text));
    }
    caught(() => withSites({}, env, { "snippets/ratelimit.caddy": limits.replace("zone global {", "zone overall {") }));
    caught(() => withSites({}, env, { "snippets/upstream.caddy": upstream.replace("\t\theader_up -X-Real-IP\n", "") }));
    caught(() =>
      withSites({ "sites/other.caddy": "other.unset.test {\n\ttls {$ACME_EMAIL}\n\trespond 200\n}\n" }, env),
    );
    caught(() =>
      withSites(
        {
          "sites/other.caddy":
            "other.unset.test {\n\troute {\n\t\timport pds-ratelimit\n\t\timport upstream {$PDS_UPSTREAM}\n\t}\n}\n",
        },
        env,
      ),
    );
    expect(messages.length).toBeGreaterThan(10);
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
