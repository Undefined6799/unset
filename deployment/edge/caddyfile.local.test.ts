// P1.34a: the edge reader and the local app site (architecture record 2026-10-12-refocus-local-signin-rulings,
// Amendments 2 and 3; step book record 2026-10-12-p134a-edge-reader-local-app-site). The local stack serves the app
// host from local/app.caddy and both hosts with the dev leaf from local/tls.caddy (P1.34c). The reader reads them only
// when its caller opts in with the "local" mode, which only C18 under --env local passes (P1.27l); everywhere else
// APP_HOST, APP_UPSTREAM and the leaf's two secret paths are refused.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { CaddyfileError, type EdgeFiles, type EdgeMode, edgeSiteProblems, readEdgeConfig } from "./caddyfile.ts";

const EDGE = import.meta.dirname;
const ENV = {
  PDS_HOST: "pds.unset.test",
  PDS_UPSTREAM: "pds:3000",
  ACME_EMAIL: "edge@unset.test",
  APP_HOST: "app.unset.test",
  APP_UPSTREAM: "web:8080",
};
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

/** P1.34c's two local files, as shipped in local/. */
const LOCAL_TLS = readFileSync(join(EDGE, "local", "tls.caddy"), "utf8");
const APP_SITE = readFileSync(join(EDGE, "local", "app.caddy"), "utf8");

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

/**
 * A copy of the shipped edge files with sites/enabled linking to the shipped PDS site, as every stack enables it, and
 * local/ holding `local` (file name to text) beside the two local files; `edits` overwrite files in the copy. The local
 * stack mounts local/app.caddy into the enabled sites and local/tls.caddy over the shipped snippet (P1.34o).
 */
function localTree(local: Record<string, string> = {}, edits: Record<string, string> = {}) {
  const edgeDir = mkdtempSync(join(tmpdir(), "edge-local-"));
  trees.push(edgeDir);
  for (const part of ["Caddyfile", "snippets", "sites"]) {
    cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
  }
  mkdirSync(join(edgeDir, "local"));
  for (const [name, text] of Object.entries({ "tls.caddy": LOCAL_TLS, "app.caddy": APP_SITE, ...local })) {
    writeFileSync(join(edgeDir, "local", name), text);
  }
  const sitesDir = join(edgeDir, "sites", "enabled");
  mkdirSync(sitesDir);
  symlinkSync(join(edgeDir, "sites", "pds.caddy"), join(sitesDir, "pds.caddy"));
  for (const [file, text] of Object.entries(edits)) writeFileSync(join(edgeDir, file), text);
  return { edgeDir, sitesDir };
}

const read = (tree: { edgeDir: string; sitesDir: string }, mode?: EdgeMode, env: Record<string, string> = ENV) =>
  readEdgeConfig(tree.edgeDir, tree.sitesDir, env, FILES, mode);
const problems = (tree: { edgeDir: string; sitesDir: string }, env: Record<string, string> = ENV) =>
  edgeSiteProblems(read(tree, "local", env));

describe("edge reader, local app site (P1.34a)", () => {
  test("local_app_site_reads_only_with_the_local_opt_in", () => {
    const tree = localTree();
    expect(problems(tree)).toEqual([]);
    // The local tls snippet stands in for the shipped one, as its mount does in the container.
    expect(read(tree, "local").snippet("tls")).toMatchObject([
      { name: "tls", args: ["/run/secrets/local_tls_cert", "/run/secrets/local_tls_key"] },
    ]);
    // The default call never reads local/: not the app site, and not through a link from sites/.
    expect(addresses(read(tree))).toEqual([["{$PDS_HOST}"]]);
    symlinkSync(join(tree.edgeDir, "local", "app.caddy"), join(tree.sitesDir, "web.caddy"));
    expect(() => read(tree)).toThrow("web.caddy: the link leaves sites/");
  });

  test("app_host_and_upstream_are_refused_outside_local", () => {
    // An app site in sites/ fails whichever mode reads it.
    for (const mode of [undefined, "local"] as const) {
      const tree = localTree({}, { "sites/web.caddy": APP_SITE });
      symlinkSync(join(tree.edgeDir, "sites", "web.caddy"), join(tree.sitesDir, "web.caddy"));
      expect(() => read(tree, mode), String(mode)).toThrow("web.caddy: {$APP_HOST} is allowed only in local/");
    }
    const upstream = localTree({}, { "sites/pds.caddy": APP_SITE.replace("{$APP_HOST}", "{$PDS_HOST}") });
    expect(() => read(upstream, "local")).toThrow("pds.caddy: {$APP_UPSTREAM} is allowed only in local/");
  });

  test("local_tls_arguments_are_refused_outside_local", () => {
    const leaf = "\ttls /run/secrets/local_tls_cert /run/secrets/local_tls_key\n";
    const pds = readFileSync(join(EDGE, "sites", "pds.caddy"), "utf8").replace("\timport tls\n", leaf);
    expect(() => read(localTree({}, { "sites/pds.caddy": pds }), "local")).toThrow(
      "pds.caddy: /run/secrets/local_tls_cert is allowed only in local/",
    );
    // In a shipped snippet, read by every default call.
    expect(() => read(localTree({}, { "snippets/tls.caddy": LOCAL_TLS }))).toThrow(
      "tls.caddy: /run/secrets/local_tls_cert is allowed only in local/",
    );
  });

  test("app_host_and_upstream_differ_from_the_pds_ones", () => {
    const tree = localTree();
    expect(() => problems(tree, { ...ENV, APP_HOST: ENV.PDS_HOST })).toThrow("{$APP_HOST} equals {$PDS_HOST}");
    expect(() => problems(tree, { ...ENV, APP_UPSTREAM: ENV.PDS_UPSTREAM })).toThrow(
      "{$APP_UPSTREAM} equals {$PDS_UPSTREAM}",
    );
    expect(() => problems(tree, { ...ENV, APP_UPSTREAM: "web:8080;rm" })).toThrow(
      "environment value for {$APP_UPSTREAM} has the wrong shape",
    );
  });

  test("the_app_site_keeps_the_pds_site_rules", () => {
    const site = (text: string) => problems(localTree({ "app.caddy": text }));
    expect(site(APP_SITE.replace("{$APP_HOST} {", "{$APP_HOST} other.unset.test {"))).toContain(
      "{$APP_HOST} other.unset.test: {$APP_HOST} shares its site with another address",
    );
    expect(site(APP_SITE.replace("upstream {$APP_UPSTREAM}", "upstream web:8080"))).toContain(
      "{$APP_HOST}: a reverse_proxy does not name one placeholder upstream",
    );
    expect(site(APP_SITE.replace("upstream {$APP_UPSTREAM}", "upstream {$PDS_UPSTREAM}"))).toContain(
      "{$APP_HOST}: {$PDS_UPSTREAM} is outside its position in reverse_proxy",
    );
    expect(site(APP_SITE.replace("\t\timport pds-ratelimit\n", ""))).toContain(
      "{$APP_HOST}: the route does not apply the zones first",
    );
    expect(site(APP_SITE.replace("import upstream {$APP_UPSTREAM}", "reverse_proxy {$APP_UPSTREAM}"))).toContain(
      "{$APP_HOST}: a reverse_proxy passes X-Forwarded-For",
    );
    // APP_UPSTREAM on a PDS site read from local/ is out of position too.
    const pds = APP_SITE.replace("{$APP_HOST}", "{$PDS_HOST}");
    const tree = localTree({ "app.caddy": pds });
    rmSync(join(tree.sitesDir, "pds.caddy"));
    expect(problems(tree)).toContain("{$PDS_HOST}: {$APP_UPSTREAM} is outside its position in reverse_proxy");
  });

  test("local_dir_is_contained_like_sites", () => {
    // local/app.caddy is read as the one regular file its mount names, never through a link, inside local/ or out.
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    trees.push(outside);
    writeFileSync(join(outside, "app.caddy"), APP_SITE);
    for (const target of [join(outside, "app.caddy"), "web.caddy"]) {
      const tree = localTree({ "web.caddy": APP_SITE });
      rmSync(join(tree.edgeDir, "local", "app.caddy"));
      symlinkSync(target, join(tree.edgeDir, "local", "app.caddy"));
      expect(() => read(tree, "local"), target).toThrow("app.caddy: not a regular file");
    }
    const moved = localTree();
    cpSync(join(moved.edgeDir, "local"), join(outside, "local"), { recursive: true, verbatimSymlinks: true });
    rmSync(join(moved.edgeDir, "local"), { recursive: true });
    symlinkSync(join(outside, "local"), join(moved.edgeDir, "local"));
    expect(() => read(moved, "local")).toThrow("local/ leaves the edge directory");
  });
});

/** The same tree, read the shipped way: its sites/enabled links only to the shipped PDS site. */
const shippedOf = (tree: { edgeDir: string; sitesDir: string }) => tree;

/** The placeholder addresses of each site that has one, in order: the Caddyfile's own loopback site is left out. */
const addresses = (config: { sites: { placeholders: (string | null)[] }[] }) =>
  config.sites
    .map((site) => site.placeholders.flatMap((name) => (name === null ? [] : [`{$${name}}`])))
    .filter((names) => names.length > 0);

// P1.34b (record 2026-10-12-p134b-edge-local-follow-ups; findings from the verify of #755 on main, and Amendment 6 of
// the refocus rulings): every file read from outside local/, the Caddyfile included, is checked, a leaf path is caught
// however it is spelled, and an entry's containment respects the path separator.
describe("edge reader, local-only words everywhere else (P1.34b)", () => {
  const caddyfile = readFileSync(join(EDGE, "Caddyfile"), "utf8");

  test("caddyfile_holds_no_local_only_word", () => {
    const uses = {
      "{$APP_HOST}": `${APP_SITE}`,
      "{$APP_UPSTREAM}": "localhost:9 {\n\treverse_proxy {$APP_UPSTREAM}\n}\n",
      "/run/secrets/local_tls_cert": "(leaf) {\n\ttls /run/secrets/local_tls_cert /etc/caddy/key.pem\n}\n",
      "/run/secrets/local_tls_key": "(leaf) {\n\ttls /etc/caddy/cert.pem /run/secrets/local_tls_key\n}\n",
    };
    for (const [word, text] of Object.entries(uses)) {
      const tree = localTree({}, { Caddyfile: `${caddyfile}\n${text}` });
      expect(() => read(tree, "local"), word).toThrow(`Caddyfile: ${word} is allowed only in local/`);
      expect(() => read(shippedOf(tree)), word).toThrow(`Caddyfile: ${word} is allowed only in local/`);
    }
  });

  test("leaf_paths_are_refused_however_spelled", () => {
    const pds = readFileSync(join(EDGE, "sites", "pds.caddy"), "utf8");
    for (const spelling of [
      "/etc/caddy/cert.pem /run/secrets/local_tls_key",
      "/run/secrets//local_tls_cert /etc/caddy/key.pem",
      "/run/./secrets/local_tls_cert /etc/caddy/key.pem",
      "/run//secrets/local_tls_key /etc/caddy/cert.pem",
      "/run/secrets/../secrets/local_tls_cert /etc/caddy/key.pem",
    ]) {
      const tree = localTree({}, { "sites/pds.caddy": pds.replace("\timport tls\n", `\ttls ${spelling}\n`) });
      expect(() => read(tree, "local"), spelling).toThrow(/^pds\.caddy: \S*local_tls_\S* is allowed only in local\/$/);
    }
  });

  test("a_snippet_argument_cannot_build_a_leaf_path", () => {
    // Caddy substitutes {args[N]} inside a word (v2.11.7 caddyconfig/caddyfile/parse.go:580), so a snippet argument
    // could assemble a leaf path that no raw token holds; the reader takes an argument only as a whole word.
    const pds = readFileSync(join(EDGE, "sites", "pds.caddy"), "utf8");
    const leaf = "(zleaf) {\n\ttls /run/secrets/{args[0]}_cert /run/secrets/{args[0]}_key\n}\n";
    const split = "(zleaf) {\n\ttls /run/secrets/{args[0]}{args[1]}_cert /run/secrets/{args[0]}{args[1]}_key\n}\n";
    for (const [name, files] of [
      [
        "a snippet file",
        { "snippets/zleaf.caddy": leaf, "sites/pds.caddy": pds.replace("import tls\n", "import zleaf local_tls\n") },
      ],
      [
        "a split argument",
        { "snippets/zleaf.caddy": split, "sites/pds.caddy": pds.replace("import tls\n", "import zleaf loc al_tls\n") },
      ],
      [
        "the Caddyfile",
        {
          Caddyfile: caddyfile.replace("import snippets/*.caddy\n", `import snippets/*.caddy\n${leaf}`),
          "sites/pds.caddy": pds.replace("import tls\n", "import zleaf local_tls\n"),
        },
      ],
    ] as const) {
      const tree = localTree({}, files);
      expect(() => read(tree, "local"), name).toThrow("a snippet argument must be a whole word");
      expect(() => read(shippedOf(tree)), name).toThrow("a snippet argument must be a whole word");
    }
  });

  test("app_host_is_a_site_address_only", () => {
    const site = APP_SITE.replace("\timport tls\n", "\timport tls\n\theader X-App {$APP_HOST}\n");
    expect(problems(localTree({ "app.caddy": site }))).toContain(
      "{$APP_HOST}: {$APP_HOST} is outside its position in header",
    );
  });

  test("local_tls_must_be_a_regular_file", () => {
    const tree = localTree();
    const elsewhere = join(tree.edgeDir, "local", "leaf.caddy");
    writeFileSync(elsewhere, LOCAL_TLS);
    rmSync(join(tree.edgeDir, "local", "tls.caddy"));
    symlinkSync(elsewhere, join(tree.edgeDir, "local", "tls.caddy"));
    expect(() => read(tree, "local")).toThrow("tls.caddy: not a regular file");
  });

  test("a_sibling_of_sites_or_local_is_outside_both", () => {
    // `local-x/` and `sites-x/` start with the bound's name but are other folders (Amendment 6).
    for (const sibling of ["local-x", "sites-x"]) {
      const tree = localTree();
      mkdirSync(join(tree.edgeDir, sibling));
      writeFileSync(join(tree.edgeDir, sibling, "web.caddy"), APP_SITE);
      symlinkSync(join(tree.edgeDir, sibling, "web.caddy"), join(tree.sitesDir, "web.caddy"));
      expect(() => read(tree, "local"), sibling).toThrow("web.caddy: the link leaves sites/");
    }
  });
});

// P1.34o (architecture record 2026-10-13-p127l-local-gaps, item 1, option (c)): under the local mode the reader takes
// sites/ plus exactly one more file, local/app.caddy, where its read-only mount places it in sites/enabled. Nothing
// else in local/ is a site, the enabled directory is inside sites/ only, and the shipped mode reads no local file.
describe("edge reader, app.caddy as one local file mount (P1.34o)", () => {
  const BROKEN = "this is { not caddy\n";

  test("local_mode_adds_app_caddy_to_the_enabled_sites", () => {
    // In byte order with the enabled sites, as Caddy's glob over the mounted directory reads them.
    expect(addresses(read(localTree(), "local"))).toEqual([["{$APP_HOST}"], ["{$PDS_HOST}"]]);
    const later = localTree();
    symlinkSync(join(later.edgeDir, "sites", "pds.caddy"), join(later.sitesDir, "0first.caddy"));
    expect(addresses(read(later, "local", { ...ENV }))).toHaveLength(3);
  });

  test("no_other_local_file_is_a_site", () => {
    // Another file in local/ is never read, whatever it holds.
    const tree = localTree({ "other.caddy": BROKEN, "enabled.caddy": BROKEN });
    mkdirSync(join(tree.edgeDir, "local", "enabled"));
    writeFileSync(join(tree.edgeDir, "local", "enabled", "x.caddy"), BROKEN);
    expect(problems(tree)).toEqual([]);
    // Nor reached through a link from the enabled sites, nor as the enabled directory itself.
    symlinkSync(join(tree.edgeDir, "local", "other.caddy"), join(tree.sitesDir, "other.caddy"));
    expect(() => read(tree, "local")).toThrow("other.caddy: the link leaves sites/");
    const inLocal = localTree();
    expect(() => read({ ...inLocal, sitesDir: join(inLocal.edgeDir, "local") }, "local")).toThrow(
      "the enabled sites directory is not inside sites/",
    );
  });

  test("app_caddy_is_mounted_once", () => {
    // An enabled site named app.caddy would sit under the mount: Caddy would read the mounted file, the reader both.
    const tree = localTree();
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(tree.sitesDir, "app.caddy"));
    expect(() => read(tree, "local")).toThrow("app.caddy: an enabled site has the mounted app site's name");
    // The shipped mode reads it as any other enabled site.
    expect(addresses(read(tree))).toEqual([["{$PDS_HOST}"], ["{$PDS_HOST}"]]);
  });

  test("shipped_mode_reads_no_local_file", () => {
    // local/app.caddy unreadable as a site and local/tls.caddy broken: the shipped mode opens neither.
    const tree = localTree({ "app.caddy": BROKEN, "tls.caddy": BROKEN });
    expect(addresses(read(tree))).toEqual([["{$PDS_HOST}"]]);
    expect(() => read(tree, "local")).toThrow(CaddyfileError);
  });

  test("app_caddy_must_be_a_regular_file", () => {
    // A link would point the mount at a file outside local/, and in the container it would dangle.
    const tree = localTree();
    const app = join(tree.edgeDir, "local", "app.caddy");
    rmSync(app);
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), app);
    expect(() => read(tree, "local")).toThrow("app.caddy: not a regular file");
  });

  test("a_missing_app_caddy_fails_closed", () => {
    const tree = localTree();
    rmSync(join(tree.edgeDir, "local", "app.caddy"));
    expect(() => read(tree, "local")).toThrow(CaddyfileError);
  });
});
