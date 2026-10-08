// P1.30u: what C18 reads, over real temporary trees through C18's own node:fs adapter (architecture amendment 7 and
// its 23:50Z note to 2026-10-07-p130s-networks-and-caddyfile-reader; step book 2026-10-07-p128e-edge-config-reader,
// amendment 1).
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { edgeSiteProblems, readEdgeConfig } from "../../edge/caddyfile.ts";
import { parseCompose } from "../compose-parse.ts";
import { EDGE_FILES, edgeSitesDir } from "./edge.ts";

const EDGE = join(import.meta.dirname, "..", "..", "edge");
const ENV = { PDS_HOST: "pds.unset.test", PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repository with the shipped edge config copied in and deployment/edge/sites/enabled linking to the PDS site. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), "c18-"));
  roots.push(root);
  const edgeDir = join(root, "deployment", "edge");
  mkdirSync(edgeDir, { recursive: true });
  for (const part of ["Caddyfile", "snippets", "sites"])
    cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
  const sitesDir = join(edgeDir, "sites", "enabled");
  mkdirSync(sitesDir);
  symlinkSync(join(edgeDir, "sites", "pds.caddy"), join(sitesDir, "pds.caddy"));
  return { root, edgeDir, sitesDir };
}
/** A compose file whose edge service has `volumes` (already absolute, as loadCompose resolves them). */
const compose = (volumes: string[] | null) =>
  parseCompose(
    `name: unset-dev\nservices:\n  ${volumes === null ? "web" : "edge"}:\n    image: x\n${
      volumes === null || volumes.length === 0 ? "" : `    volumes:\n${volumes.map((v) => `      - ${v}\n`).join("")}`
    }`,
    "compose.yaml",
  );
const sitesFrom = (source: string) => `${source}:/etc/caddy/sites/enabled:ro`;

describe("C18 inputs (P1.30u)", () => {
  test("c18_sites_mount_read", () => {
    const { edgeDir, sitesDir } = repository();
    expect(edgeSitesDir(compose([sitesFrom(sitesDir)]), edgeDir)).toEqual({ dir: sitesDir });
    // A trailing slash on the target is the same target.
    expect(edgeSitesDir(compose([`${sitesDir}:/etc/caddy/sites/enabled/:ro`]), edgeDir)).toEqual({ dir: sitesDir });
  });

  test("c18_mount_over_caddyfile_fails", () => {
    const { edgeDir, sitesDir } = repository();
    const over = compose([sitesFrom(sitesDir), `${edgeDir}/Caddyfile:/etc/caddy/Caddyfile:ro`]);
    expect(edgeSitesDir(over, edgeDir)).toEqual({ pass: false, reason: "the edge mounts over /etc/caddy/Caddyfile" });
    const snippets = compose([sitesFrom(sitesDir), "type: tmpfs\n        target: /etc/caddy/snippets"]);
    expect(edgeSitesDir(snippets, edgeDir)).toEqual({
      pass: false,
      reason: "the edge mounts over /etc/caddy/snippets",
    });
  });

  test("c18_mount_over_etc_caddy_parent_fails", () => {
    const { edgeDir, sitesDir } = repository();
    for (const target of ["/etc/caddy", "/etc", "/", "/etc/caddy/sites", "/etc/./caddy"]) {
      const result = edgeSitesDir(compose([sitesFrom(sitesDir), `config:${target}`]), edgeDir);
      expect(result, target).toMatchObject({ pass: false });
      expect((result as { reason: string }).reason, target).toMatch(/^the edge mounts over \//);
    }
    // Two mounts at the sites target, or a volume there instead of a bind, fail too.
    expect(edgeSitesDir(compose([sitesFrom(sitesDir), sitesFrom(sitesDir)]), edgeDir)).toMatchObject({ pass: false });
    expect(edgeSitesDir(compose([sitesFrom("sites")]), edgeDir)).toEqual({
      pass: false,
      reason: "/etc/caddy/sites/enabled is not a bind mount",
    });
  });

  test("c18_sites_symlink_out_of_repo_fails", () => {
    const { root, edgeDir } = repository();
    const outside = join(root, "elsewhere");
    mkdirSync(outside);
    writeFileSync(join(outside, "x.caddy"), "");
    const notInside = { pass: false, reason: "/etc/caddy/sites/enabled is not mounted from inside deployment/edge/" };
    // A source outside deployment/edge/, a link inside it that leads out, and an edge-evil sibling all fail.
    expect(edgeSitesDir(compose([sitesFrom(outside)]), edgeDir)).toEqual(notInside);
    symlinkSync(outside, join(edgeDir, "linked"));
    expect(edgeSitesDir(compose([sitesFrom(join(edgeDir, "linked"))]), edgeDir)).toEqual(notInside);
    const sibling = join(root, "deployment", "edge-evil");
    mkdirSync(sibling);
    writeFileSync(join(sibling, "x.caddy"), "");
    expect(edgeSitesDir(compose([sitesFrom(sibling)]), edgeDir)).toEqual(notInside);
    // A file, not a directory.
    expect(edgeSitesDir(compose([sitesFrom(join(edgeDir, "Caddyfile"))]), edgeDir)).toEqual({
      pass: false,
      reason: "/etc/caddy/sites/enabled is not mounted from a directory",
    });
  });

  test("c18_input_missing_fails", () => {
    const { edgeDir } = repository();
    expect(edgeSitesDir(compose(null), edgeDir)).toEqual({ pass: false, reason: "input missing: the edge service" });
    expect(edgeSitesDir(compose([]), edgeDir)).toEqual({
      pass: false,
      reason: "input missing: the edge mount at /etc/caddy/sites/enabled",
    });
    const absent = join(edgeDir, "sites", "none");
    expect(edgeSitesDir(compose([sitesFrom(absent)]), edgeDir)).toEqual({
      pass: false,
      reason: `input missing: ${absent}`,
    });
    const empty = join(edgeDir, "sites", "empty");
    mkdirSync(empty);
    expect(edgeSitesDir(compose([sitesFrom(empty)]), edgeDir)).toEqual({
      pass: false,
      reason: `input missing: ${empty}`,
    });
  });

  test("c18_real_tree_symlink_containment", () => {
    // readEdgeConfig through C18's own adapter (amendment 7 note, condition 3): an escaping link, an edge/sites-evil
    // sibling, an outward chain and a dangling link fail; the legitimate link passes.
    const read = (edgeDir: string, sitesDir: string) => () => readEdgeConfig(edgeDir, sitesDir, ENV, EDGE_FILES);
    const good = repository();
    expect(edgeSiteProblems(read(good.edgeDir, good.sitesDir)())).toEqual([]);
    const escaping = repository();
    writeFileSync(join(escaping.root, "x.caddy"), "");
    symlinkSync(join(escaping.root, "x.caddy"), join(escaping.sitesDir, "x.caddy"));
    expect(read(escaping.edgeDir, escaping.sitesDir)).toThrow("x.caddy: the link leaves sites/");
    const sibling = repository();
    mkdirSync(join(sibling.edgeDir, "sites-evil"));
    writeFileSync(join(sibling.edgeDir, "sites-evil", "x.caddy"), "");
    symlinkSync(join(sibling.edgeDir, "sites-evil", "x.caddy"), join(sibling.sitesDir, "x.caddy"));
    expect(read(sibling.edgeDir, sibling.sitesDir)).toThrow("x.caddy: the link leaves sites/");
    const chain = repository();
    writeFileSync(join(chain.root, "x.caddy"), "");
    symlinkSync(join(chain.root, "x.caddy"), join(chain.edgeDir, "sites", "hop.caddy"));
    symlinkSync(join(chain.edgeDir, "sites", "hop.caddy"), join(chain.sitesDir, "hop.caddy"));
    expect(read(chain.edgeDir, chain.sitesDir)).toThrow("hop.caddy: the link leaves sites/");
    const dangling = repository();
    symlinkSync(join(dangling.edgeDir, "sites", "gone.caddy"), join(dangling.sitesDir, "gone.caddy"));
    expect(read(dangling.edgeDir, dangling.sitesDir)).toThrow("gone.caddy: dangling link");
  });
});
