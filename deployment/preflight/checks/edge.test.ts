// P1.30u: what C18 reads, over real temporary trees through C18's own node:fs adapter (architecture amendment 7 and
// its 23:50Z note to 2026-10-07-p130s-networks-and-caddyfile-reader; step book 2026-10-07-p128e-edge-config-reader,
// amendment 1).
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { SecretMap } from "../secret-map.ts";
import { edgeSitesDir, edgeZones } from "./edge.ts";

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
const DIGEST = `sha256:${"a".repeat(64)}`;
const EDGE_IMAGE = `ghcr.io/undefined6799/edge@${DIGEST}`;
/** A compose file whose edge service runs `image` and has `volumes` (already absolute, as loadCompose resolves them). */
// The named volumes the fixtures mount are declared, as the compose reader requires (P1.30k).
const compose = (volumes: string[] | null, image = EDGE_IMAGE) =>
  parseCompose(
    `name: unset-dev\nservices:\n  ${volumes === null ? "web" : "edge"}:\n    image: ${image}\n${
      volumes === null || volumes.length === 0 ? "" : `    volumes:\n${volumes.map((v) => `      - ${v}\n`).join("")}`
    }volumes:\n  config: {}\n  sites: {}\n`,
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
    // A tmpfs there is refused by the parser first (P1.30y's tmpfs targets); C18 still answers for a volume.
    expect(() => compose([sitesFrom(sitesDir), "type: tmpfs\n        target: /etc/caddy/snippets"])).toThrow(
      /volume tmpfs target is not \/tmp or \/var\/run\/postgresql/,
    );
    const snippets = compose([sitesFrom(sitesDir), "config:/etc/caddy/snippets"]);
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

  // P1.30w (architecture ruling B2b): a writable sites mount lets the running edge change its own sites.
  test("c18_sites_mount_not_read_only_fails", () => {
    const { edgeDir, sitesDir } = repository();
    const notReadOnly = { pass: false, reason: "/etc/caddy/sites/enabled is not mounted read-only" };
    const long = (readOnly: string) =>
      `type: bind\n        source: ${sitesDir}\n        target: /etc/caddy/sites/enabled${readOnly}`;
    for (const volume of [`${sitesDir}:/etc/caddy/sites/enabled:rw`, `${sitesDir}:/etc/caddy/sites/enabled`]) {
      expect(edgeSitesDir(compose([volume]), edgeDir), volume).toEqual(notReadOnly);
    }
    expect(edgeSitesDir(compose([long("")]), edgeDir)).toEqual(notReadOnly);
    expect(edgeSitesDir(compose([long("\n        read_only: false")]), edgeDir)).toEqual(notReadOnly);
    expect(edgeSitesDir(compose([long("\n        read_only: true")]), edgeDir)).toEqual({ dir: sitesDir });
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

  // P1.34p Amendment 3 (verifier B3 on #700, here for C18): containment asks the kernel's realpath(3). Node's
  // JavaScript realpathSync collapses `x/..` as text (path.resolve) before following x.
  test("c18_realpath_is_the_kernels", () => {
    const { root, edgeDir } = repository();
    // x leads out of the repository's edge folder; y goes through x and back up. The kernel takes x's real parent,
    // the folder outside; as text, `x/..` is edgeDir itself, so y read as the real sites folder. (With x -> "/" both
    // agree, so the decoy needs a relative x, as on #700.)
    const outside = join(root, "outside");
    mkdirSync(join(outside, "deep"), { recursive: true });
    mkdirSync(join(outside, "sites", "enabled"), { recursive: true });
    writeFileSync(join(outside, "sites", "enabled", "x.caddy"), "");
    symlinkSync("../../outside/deep", join(edgeDir, "x"));
    const viaParent = join(edgeDir, "y");
    symlinkSync("x/../sites/enabled", viaParent);
    expect(edgeSitesDir(compose([sitesFrom(viaParent)]), edgeDir)).toEqual({
      pass: false,
      reason: "/etc/caddy/sites/enabled is not mounted from inside deployment/edge/",
    });
    // A link the JavaScript resolver loops on for ever (as text, `x/../en` is en itself) returns, judged where the
    // kernel puts it: x is d/sub, its real parent d, so d/en.
    mkdirSync(join(edgeDir, "d", "sub"), { recursive: true });
    mkdirSync(join(edgeDir, "d", "en"));
    writeFileSync(join(edgeDir, "d", "en", "x.caddy"), "");
    symlinkSync("d/sub", join(edgeDir, "dx"));
    const chased = join(edgeDir, "en");
    symlinkSync("dx/../en", chased);
    expect(edgeSitesDir(compose([sitesFrom(chased)]), edgeDir)).toEqual({ dir: join(edgeDir, "d", "en") });
    // A link loop throws ELOOP, which the runner reports as "check error", rather than hanging or reading as missing.
    const loop = join(edgeDir, "loop");
    symlinkSync("loop", loop);
    expect(() => edgeSitesDir(compose([sitesFrom(loop)]), edgeDir)).toThrow(expect.objectContaining({ code: "ELOOP" }));
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
});

describe("C18 (P1.30u)", () => {
  const edgeEnv = (env: Record<string, string> = ENV) => new SecretMap(Object.entries(env));
  /** C18 on `repo`, with its sites mount and the edge's env. */
  const zones = (repo: ReturnType<typeof repository>, env = edgeEnv()) =>
    edgeZones(compose([sitesFrom(repo.sitesDir)]), repo.edgeDir, env, EDGE_IMAGE);
  test("c18_shipped_config_passes", () => {
    expect(zones(repository())).toEqual({ pass: true, reason: "ok" });
  });

  test("c18_prod_sites_folder_is_sites_or_inside_it", () => {
    // P1.36c, held by the reader until P1.39e: sites/ itself or a folder inside it; any other folder of the edge fails.
    const repo = repository();
    const from = (dir: string) => edgeZones(compose([sitesFrom(dir)]), repo.edgeDir, edgeEnv(), EDGE_IMAGE);
    expect(from(join(repo.edgeDir, "sites"))).toEqual({ pass: true, reason: "ok" });
    expect(from(join(repo.edgeDir, "snippets"))).toEqual({
      pass: false,
      reason: "the enabled sites directory is not inside sites/",
    });
    mkdirSync(join(repo.edgeDir, "sites-evil"));
    writeFileSync(join(repo.edgeDir, "sites-evil", "x.caddy"), "");
    expect(from(join(repo.edgeDir, "sites-evil")).pass).toBe(false);
  });

  // P1.30w (record 2026-10-12-p203-session-workspace-and-c18-image, point 2a and its 04:25Z amendment): C18 vouches
  // for the repository's Caddyfile, which only the edge image carries, so the edge service must run exactly the lock's
  // `edge` ref. The names here are fixture data; the lock alone holds the published path.
  test("c18_edge_image_not_the_lock_edge_ref_fails", () => {
    const repo = repository();
    const sites = [sitesFrom(repo.sitesDir)];
    const notEdge = { pass: false, reason: "the edge service does not run the lock's edge image" };
    for (const image of [
      `ghcr.io/undefined6799/web@${DIGEST}`,
      `ghcr.io/undefined6799/edge@sha256:${"b".repeat(64)}`,
      `ghcr.io/undefined6799/edge:1.0@${DIGEST}`,
      "ghcr.io/undefined6799/edge:latest",
    ]) {
      expect(edgeZones(compose(sites, image), repo.edgeDir, edgeEnv(), EDGE_IMAGE), image).toEqual(notEdge);
    }
    // A lock with no edge entry fails too; the matching ref passes.
    expect(edgeZones(compose(sites), repo.edgeDir, edgeEnv(), undefined)).toEqual({
      pass: false,
      reason: "input missing: the lock's edge entry",
    });
    expect(edgeZones(compose(sites), repo.edgeDir, edgeEnv(), EDGE_IMAGE)).toEqual({ pass: true, reason: "ok" });
  });

  test("c18_edge_without_an_environment_fails", () => {
    // The values themselves are judged before the container runs (edge-adapt.ts; preflight.test.ts
    // c18_values_are_judged_before_any_run).
    const repo = repository();
    expect(edgeZones(compose([sitesFrom(repo.sitesDir)]), repo.edgeDir, undefined, EDGE_IMAGE)).toEqual({
      pass: false,
      reason: "input missing: the edge service's environment",
    });
  });
});
