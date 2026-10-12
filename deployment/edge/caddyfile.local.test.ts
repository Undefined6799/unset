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
import { type EdgeFiles, type EdgeMode, edgeSiteProblems, readEdgeConfig } from "./caddyfile.ts";

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
 * A copy of the shipped edge files plus local/ holding `local` (file name to text), and local/enabled linking to the
 * shipped PDS site and to each local site; `edits` overwrite files in the copy.
 */
function localTree(local: Record<string, string> = {}, edits: Record<string, string> = {}) {
  const edgeDir = mkdtempSync(join(tmpdir(), "edge-local-"));
  trees.push(edgeDir);
  for (const part of ["Caddyfile", "snippets", "sites"]) {
    cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
  }
  const files = { "tls.caddy": LOCAL_TLS, "app.caddy": APP_SITE, ...local };
  const sitesDir = join(edgeDir, "local", "enabled");
  mkdirSync(sitesDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(edgeDir, "local", name), text);
    if (name !== "tls.caddy") symlinkSync(join(edgeDir, "local", name), join(sitesDir, name));
  }
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
    // The default call never reads local/: not as the enabled directory, not through a link from sites/.
    expect(() => read(tree)).toThrow("the enabled sites directory is not inside sites/");
    const shipped = { edgeDir: tree.edgeDir, sitesDir: join(tree.edgeDir, "sites", "enabled") };
    mkdirSync(shipped.sitesDir);
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(shipped.sitesDir, "pds.caddy"));
    symlinkSync(join(tree.edgeDir, "local", "app.caddy"), join(shipped.sitesDir, "app.caddy"));
    expect(() => read(shipped)).toThrow("app.caddy: the link leaves sites/");
  });

  test("app_host_and_upstream_are_refused_outside_local", () => {
    // An app site in sites/ fails whichever mode reads it.
    for (const mode of [undefined, "local"] as const) {
      const tree = localTree({}, { "sites/app.caddy": APP_SITE });
      const sitesDir = join(tree.edgeDir, "sites", "enabled");
      mkdirSync(sitesDir);
      for (const name of ["app.caddy", "pds.caddy"]) {
        symlinkSync(join(tree.edgeDir, "sites", name), join(sitesDir, name));
      }
      expect(() => read({ ...tree, sitesDir }, mode), String(mode)).toThrow(
        "app.caddy: {$APP_HOST} is allowed only in local/",
      );
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
    const tree = localTree({}, { "snippets/tls.caddy": LOCAL_TLS });
    const shipped = { edgeDir: tree.edgeDir, sitesDir: join(tree.edgeDir, "sites", "enabled") };
    mkdirSync(shipped.sitesDir);
    symlinkSync(join(tree.edgeDir, "sites", "pds.caddy"), join(shipped.sitesDir, "pds.caddy"));
    expect(() => read(shipped)).toThrow("tls.caddy: /run/secrets/local_tls_cert is allowed only in local/");
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
    const tree = localTree();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    trees.push(outside);
    writeFileSync(join(outside, "app.caddy"), APP_SITE);
    rmSync(join(tree.sitesDir, "app.caddy"));
    symlinkSync(join(outside, "app.caddy"), join(tree.sitesDir, "app.caddy"));
    expect(() => read(tree, "local")).toThrow("app.caddy: the link leaves sites/ and local/");
    const moved = localTree();
    cpSync(join(moved.edgeDir, "local"), join(outside, "local"), { recursive: true, verbatimSymlinks: true });
    rmSync(join(moved.edgeDir, "local"), { recursive: true });
    symlinkSync(join(outside, "local"), join(moved.edgeDir, "local"));
    expect(() => read(moved, "local")).toThrow("local/ leaves the edge directory");
  });
});
