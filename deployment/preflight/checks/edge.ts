// C18, the edge's rate-limit zones (P1.30u; architecture amendment 7, points 1 to 3, and its 23:50Z note, in
// 2026-10-07-p130s-networks-and-caddyfile-reader): which sites/enabled directory the compose edge service mounts, the
// node:fs reads the shared edge reader takes, and the reader's verdict. The reader and the site rules are
// deployment/edge/caddyfile.ts (P1.28e, P1.28f, P1.28l), imported here and nowhere duplicated; C18 reads the Caddyfile
// and snippets from the repository, which the edge image carries byte for byte (caddyfile.image.test.ts).
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { CaddyfileError, ENV_NAMES, type EnvName, edgeSiteProblems, readEdgeConfig } from "../../edge/caddyfile.ts";
import type { Compose, Mount } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";
import { type Check, fail, missing, type Outcome, pass, scrubbed } from "./types.ts";

/** Where the edge image reads its enabled sites (deployment/edge/Caddyfile, `import sites/enabled/*.caddy`). */
export const SITES_TARGET = "/etc/caddy/sites/enabled";
const CADDY_ROOT = "/etc/caddy";

/**
 * The file-system reads readEdgeConfig takes (its EdgeFiles), each one direct node:fs call with no filtering and no
 * path logic; containment is the reader's (amendment 7 note, condition 2).
 */
export const EDGE_FILES = {
  list: (dir: string): string[] => readdirSync(dir),
  kind: (path: string) => {
    const stat = lstatSync(path);
    const type = stat.isSymbolicLink() ? "link" : stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other";
    return { type, links: stat.nlink } as const;
  },
  realpath: (path: string): string | null => {
    try {
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  read: (path: string): string => readFileSync(path, "utf8"),
};

/** A mount target at, under or above /etc/caddy, other than the sites directory itself. */
const overCaddyConfig = (target: string): boolean =>
  target === "/" || target === CADDY_ROOT || target.startsWith(`${CADDY_ROOT}/`) || CADDY_ROOT.startsWith(`${target}/`);

/**
 * The directory the edge service bind-mounts at /etc/caddy/sites/enabled, realpathed, or why C18 cannot trust it. The
 * edge must mount nothing else at, under or above /etc/caddy, or the image's Caddyfile is not what runs; the source
 * must be a directory inside the repository's deployment/edge/, so which sites run stays a reviewed repository fact.
 */
export function edgeSitesDir(compose: Compose, edgeDir: string): { dir: string } | Outcome {
  const edge = compose.services.find((service) => service.name === "edge");
  if (edge === undefined) return missing("the edge service");
  const sites: Mount[] = [];
  for (const mount of edge.mounts) {
    const target = posix.normalize(mount.target).replace(/(.)\/+$/, "$1");
    if (target === SITES_TARGET) sites.push(mount);
    else if (overCaddyConfig(target)) return fail(`the edge mounts over ${target}`);
  }
  const [mount, ...others] = sites;
  if (mount === undefined) return missing(`the edge mount at ${SITES_TARGET}`);
  if (others.length > 0) return fail(`the edge mounts ${SITES_TARGET} more than once`);
  return sitesSource(mount, edgeDir);
}

/**
 * The sites mount's source: a read-only bind of a non-empty directory inside the repository's deployment/edge/. A
 * writable mount would let the running edge change which sites it serves (P1.30w, architecture ruling B2b).
 */
function sitesSource(mount: Mount, edgeDir: string): { dir: string } | Outcome {
  if (mount.type !== "bind" || mount.source === null) return fail(`${SITES_TARGET} is not a bind mount`);
  if (!mount.readOnly) return fail(`${SITES_TARGET} is not mounted read-only`);
  const dir = EDGE_FILES.realpath(mount.source);
  if (dir === null) return missing(mount.source);
  const root = EDGE_FILES.realpath(edgeDir);
  if (root === null || !dir.startsWith(`${root}/`)) {
    return fail(`${SITES_TARGET} is not mounted from inside deployment/edge/`);
  }
  if (EDGE_FILES.kind(dir).type !== "dir") return fail(`${SITES_TARGET} is not mounted from a directory`);
  if (EDGE_FILES.list(dir).length === 0) return missing(mount.source);
  return { dir };
}

/**
 * C18's verdict: the sites the edge mounts, read with the shipped Caddyfile and snippets and the edge's env, break
 * none of edgeSiteProblems' rules. The env values go only to the reader, whose messages name a placeholder, never its
 * value (P1.28l); a reader error is a failure, never a crash. Whatever the reader says, the reason leaves with each
 * value turned back into its name (P1.30w).
 */
export function edgeZones(compose: Compose, edgeDir: string, env: SecretMap | undefined): Outcome {
  const sites = edgeSitesDir(compose, edgeDir);
  if (!("dir" in sites)) return sites;
  if (env === undefined) return missing("the edge service's environment");
  return scrubbed(readZones(edgeDir, sites.dir, env), env, Object.keys(ENV_NAMES));
}

function readZones(edgeDir: string, sitesDir: string, env: SecretMap): Outcome {
  const values: Partial<Record<EnvName, string>> = {};
  for (const name of Object.keys(ENV_NAMES) as EnvName[]) {
    const value = env.use(name, (v) => v);
    if (value !== undefined) values[name] = value;
  }
  let problems: string[];
  try {
    problems = edgeSiteProblems(readEdgeConfig(edgeDir, sitesDir, values, EDGE_FILES));
  } catch (error) {
    if (error instanceof CaddyfileError) return fail(`the edge config is unreadable: ${error.message}`);
    throw error;
  }
  return problems.length === 0 ? pass() : fail(problems.join("; "));
}

export const c18: Check = {
  id: "C18",
  run: ({ compose, edgeDir, serviceEnv }) => edgeZones(compose, edgeDir, serviceEnv.get("edge")),
};
