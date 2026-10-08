// C18's inputs (P1.30u; architecture amendment 7, point 1, and its 23:50Z note, in
// 2026-10-07-p130s-networks-and-caddyfile-reader): which sites/enabled directory the compose edge service mounts, and
// the node:fs reads the shared edge reader takes. The reader and the site rules are deployment/edge/caddyfile.ts
// (P1.28e); C18 reads the Caddyfile and snippets from the repository, which the edge image carries byte for byte.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import type { Compose, Mount } from "../compose-parse.ts";
import { fail, missing, type Outcome } from "./types.ts";

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

/** The sites mount's source: a bind of a non-empty directory inside the repository's deployment/edge/. */
function sitesSource(mount: Mount, edgeDir: string): { dir: string } | Outcome {
  if (mount.type !== "bind" || mount.source === null) return fail(`${SITES_TARGET} is not a bind mount`);
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
