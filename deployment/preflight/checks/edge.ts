// C18, the edge's rate-limit zones (P1.30u; architecture amendment 7, points 1 to 3, and its 23:50Z note, in
// 2026-10-07-p130s-networks-and-caddyfile-reader): which sites/enabled directory the compose edge service mounts, the
// node:fs reads the shared edge reader takes, and the reader's verdict. The reader and the site rules are
// deployment/edge/caddyfile.ts (P1.28e, P1.28f, P1.28l), imported here and nowhere duplicated; C18 reads the Caddyfile
// and snippets from the repository, which the edge image carries byte for byte (caddyfile.image.test.ts).
//
// Under --env local (P1.27l) the edge is built from deployment/edge/Dockerfile rather than run from the lock, and it
// mounts two files from deployment/edge/local/ beside its sites: the dev leaf's TLS snippet and the app site
// (architecture records 2026-10-12-refocus-local-signin-rulings, Amendment 2, and 2026-10-13-p127l-local-gaps, items
// 1 and 2). Every config rule still applies to what it serves; only where the image's identity comes from changes.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import {
  type Caddyfile,
  CaddyfileError,
  type Directive,
  type EdgeMode,
  ENV_NAMES,
  type EnvName,
  edgeSiteProblems,
  readCaddyfile,
  readEdgeConfig,
  type Site,
  type SiteMount,
} from "../../edge/caddyfile.ts";
import type { Compose, Mount, Service } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";
import { runsBuilt } from "./build.ts";
import { appHostProblem, localLeafProblem } from "./local-leaf.ts";
import { readLock } from "./lock.ts";
import { type Check, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

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
  // realpath(3), never the JavaScript realpathSync, which collapses `x/..` as text before following x (Node v26.10.0
  // doc/api/fs.md, fs.realpathSync.native; P1.34p Amendment 3, verifier B3 on #700). Only ENOENT reads as missing;
  // ELOOP and every other error throw, which the runner reports as "check error".
  realpath: (path: string): string | null => {
    try {
      return realpathSync.native(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  read: (path: string): string => readFileSync(path, "utf8"),
};

const mountTarget = (mount: Mount): string => posix.normalize(mount.target).replace(/(.)\/+$/, "$1");

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
    const target = mountTarget(mount);
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
 * value (P1.28l); a reader error is a failure, never a crash. The runner withholds a reason that still holds any
 * configured value and prints a fixed marker instead (P1.30m, P1.30v).
 */
export function edgeZones(
  compose: Compose,
  edgeDir: string,
  env: SecretMap | undefined,
  edgeRef: string | undefined,
): Outcome {
  const image = edgeImage(compose, edgeRef);
  if (image !== null) return image;
  const sites = edgeSitesDir(compose, edgeDir);
  if (!("dir" in sites)) return sites;
  if (env === undefined) return missing("the edge service's environment");
  return readZones(edgeDir, sites.dir, env);
}

/**
 * Why the edge service is not running the lock's `edge` ref exactly, or null when it is. Only the edge image carries
 * the repository's Caddyfile and snippets, so C18's verdict describes nothing else; the published path lives only in
 * the lock (P1.30w; record 2026-10-12-p203-session-workspace-and-c18-image, point 2a and its 04:25Z amendment).
 */
function edgeImage(compose: Compose, edgeRef: string | undefined): Outcome | null {
  const edge = compose.services.find((service) => service.name === "edge");
  if (edge === undefined) return missing("the edge service");
  if (edgeRef === undefined) return missing("the lock's edge entry");
  return edge.image === edgeRef ? null : fail("the edge service does not run the lock's edge image");
}

function readZones(
  edgeDir: string,
  sitesDir: string | readonly SiteMount[],
  env: SecretMap,
  mode: EdgeMode = "shipped",
): Outcome {
  const values: Partial<Record<EnvName, string>> = {};
  for (const name of Object.keys(ENV_NAMES) as EnvName[]) {
    const value = env.use(name, (v) => v);
    if (value !== undefined) values[name] = value;
  }
  let problems: string[];
  try {
    const config = readEdgeConfig(edgeDir, sitesDir, values, EDGE_FILES, mode);
    problems = [...edgeSiteProblems(config), ...certificateProblems(config, edgeDir, values, mode)];
  } catch (error) {
    if (error instanceof CaddyfileError) return fail(`the edge config is unreadable: ${error.message}`);
    throw error;
  }
  return problems.length === 0 ? pass() : fail(problems.join("; "));
}

/**
 * The image's own health site, deployment/edge/Caddyfile:48-53 on main 79b3582, as the reader reads it: the one site
 * that goes without `import tls` (architecture's Amendment 5 to unset-plan/book-edits/2026-10-13-p127l-local-gaps.md).
 * Plain HTTP on loopback, so Caddy chooses no certificate for it (caddyserver/website
 * src/docs/markdown/automatic-https.md, "Activation", read 2026-10-13).
 */
const HEALTH_SITE = JSON.stringify([
  ["http://127.0.0.1:8081"],
  [null],
  [
    ["bind", ["127.0.0.1"], [null], null, null],
    ["respond", ["/health", "200"], [null, null], null, null],
    ["respond", ["404"], [null], null, null],
  ],
]);
const healthShaped = (site: Site): boolean =>
  JSON.stringify([site.addresses, site.placeholders, shape(site.directives)]) === HEALTH_SITE;

/**
 * The health site, when it is exempt: exactly one site in the served config has its shape, and the image's Caddyfile,
 * read alone without its two file imports, holds exactly that one site and nothing else. So the same block in a sites
 * or local file, beside the Caddyfile's or in its place, is never exempt.
 */
function exemptHealthSite(config: Caddyfile, edgeDir: string, env: Partial<Record<EnvName, string>>): Site | null {
  const shaped = config.sites.filter(healthShaped);
  if (shaped.length !== 1) return null;
  const own = EDGE_FILES.read(join(edgeDir, "Caddyfile"))
    .split("\n")
    .filter((line) => !FILE_IMPORT_LINES.includes(line))
    .join("\n");
  const sites = readCaddyfile(own, env).sites;
  return sites.length === 1 && healthShaped(sites[0] as Site) ? (shaped[0] as Site) : null;
}
/** The Caddyfile's two file imports (deployment/edge/caddyfile.ts FILE_IMPORTS), each a whole line. */
const FILE_IMPORT_LINES = ["import snippets/*.caddy", "import sites/enabled/*.caddy"];

const flatten = (directives: Directive[]): Directive[] =>
  directives.flatMap((directive) => [directive, ...flatten(directive.block ?? [])]);

/**
 * Why some site could get a certificate other than the env's own (tls) snippet gives it (P1.33t; architecture's
 * Amendment 3, S3, to unset-plan/book-edits/2026-10-13-p127l-local-gaps.md). Every site but the image's health site
 * imports tls, and no tls directive in it comes from anywhere else; the (tls) served reads the same as the one the
 * env's own file defines (snippets/tls.caddy, or local/tls.caddy under local); a (tls) from any other file fails. This
 * closes Caddy's internal CA, which refocus Amendment 1 forbids. The global options that would change the issuer
 * (local_certs, skip_install_trust, pki, auto_https) are already outside the reader's global allowlist.
 */
function certificateProblems(
  config: Caddyfile,
  edgeDir: string,
  env: Partial<Record<EnvName, string>>,
  mode: EdgeMode,
): string[] {
  const found: string[] = [];
  const health = exemptHealthSite(config, edgeDir, env);
  for (const site of config.sites) {
    if (site === health) continue;
    // Named as written, `{$NAME}` for a placeholder, never its value (P1.28l).
    const name = site.addresses
      .map((address, at) => (site.placeholders[at] ? `{$${site.placeholders[at]}}` : address))
      .join(" ");
    if (!site.directives.some((directive) => directive.name === "tls" && directive.via === "tls")) {
      found.push(`${name}: does not import tls`);
    }
    const tls = flatten(site.directives).filter((directive) => directive.name === "tls");
    if (tls.some((directive) => directive.via !== "tls")) found.push(`${name}: has its own tls directive`);
  }
  const own = mode === "local" ? "local/tls.caddy" : "snippets/tls.caddy";
  if (!sameDirectives(config.snippet("tls"), ownTls(join(edgeDir, own), env))) {
    found.push(`the (tls) snippet served is not ${own}`);
  }
  return found;
}

/** The (tls) snippet the env's own file defines, or null when the file is missing or defines none. */
function ownTls(path: string, env: Partial<Record<EnvName, string>>): Directive[] | null {
  if (EDGE_FILES.realpath(path) === null) return null;
  try {
    return readCaddyfile(EDGE_FILES.read(path), env).snippet("tls");
  } catch (error) {
    if (error instanceof CaddyfileError) return null;
    throw error;
  }
}

/** Whether two directive lists read the same, wherever in their files they were written. */
function sameDirectives(served: Directive[], own: Directive[] | null): boolean {
  return own !== null && JSON.stringify(shape(served)) === JSON.stringify(shape(own));
}

/** A directive list as data, without the line numbers that say where it was written. */
const shape = (directives: Directive[]): unknown =>
  directives.map(({ name, args, placeholders, block, via }) => [name, args, placeholders, block && shape(block), via]);

/**
 * The files a local edge mounts from deployment/edge/local/ outside the sites, by target: each at most once,
 * read-only, by that name. The app site, local/app.caddy at sites/enabled/app.caddy, is one of the site mounts, which
 * the reader judges with the enabled sites (localSiteMounts, P1.33y).
 */
const LOCAL_MOUNTS: Record<string, { file: string; what: string }> = {
  [`${CADDY_ROOT}/snippets/tls.caddy`]: { file: "tls.caddy", what: "the TLS snippet" },
};
const EDGE_DOCKERFILE = "deployment/edge/Dockerfile";
/** The dev leaf's certificate and key (P1.34c), the only secrets a local edge reads. */
const LOCAL_EDGE_SECRETS = ["local_tls_cert", "local_tls_key"];

/** C18 under --env local: a built edge whose mounts and secrets are the local stack's, then the same config rules. */
function localEdgeZones(inputs: Inputs): Outcome {
  const edge = inputs.compose.services.find((service) => service.name === "edge");
  if (edge === undefined) return missing("the edge service");
  // The one definition C25 uses too: exactly that Dockerfile, a build C26 passes, and no image beside it (the #789
  // verify, N2: the path's text alone let a build C26 refuses through).
  if (runsBuilt(edge, inputs, undefined, EDGE_DOCKERFILE) !== "yes") {
    return fail(`the edge is not built from ${EDGE_DOCKERFILE}`);
  }
  if (edge.secrets.some((name) => !LOCAL_EDGE_SECRETS.includes(name))) {
    return fail("the edge reads a secret other than the dev leaf's");
  }
  const sites = localSiteMounts(edge);
  if (!Array.isArray(sites)) return sites;
  const files = localFileMounts(edge, inputs.edgeDir);
  if (files !== null) return files;
  const env = inputs.serviceEnv.get("edge");
  if (env === undefined) return missing("the edge service's environment");
  const appHost = env.use("APP_HOST", (value) => value);
  const host = appHostProblem(inputs, appHost);
  if (host !== null) return host;
  const leaf = localLeafProblem(inputs, appHost ?? "", env.use("PDS_HOST", (value) => value) ?? "");
  if (leaf !== null) return leaf;
  return readZones(inputs.edgeDir, sites, env, "local");
}

/** A target that names one file directly in the enabled sites directory. */
const siteFileTarget = (target: string): boolean => posix.dirname(target) === SITES_TARGET;

/**
 * The enabled sites a local edge mounts, one read-only bind per file at /etc/caddy/sites/enabled/<name>, never the
 * directory (P1.33y; book edit 2026-10-13-p134o-after-791, Amendment 1; local-gaps Amendment 3 S2). The reader's
 * mountedSites then requires exactly every sites/*.caddy and local/app.caddy, each from where it belongs. Any other
 * mount at, under or above /etc/caddy than these and LOCAL_MOUNTS fails.
 */
function localSiteMounts(edge: Service): SiteMount[] | Outcome {
  const sites: SiteMount[] = [];
  for (const mount of edge.mounts) {
    const target = mountTarget(mount);
    if (target === SITES_TARGET) return fail(`the local edge mounts a directory at ${SITES_TARGET}`);
    if (siteFileTarget(target)) {
      const site = siteMount(mount, posix.basename(target));
      if (!("source" in site)) return site;
      sites.push(site);
    } else if (overCaddyConfig(target) && LOCAL_MOUNTS[target] === undefined) {
      return fail(`the edge mounts over ${target}`);
    }
  }
  return sites.length > 0 ? sites : missing(`the edge's site mounts in ${SITES_TARGET}`);
}

/** One enabled site's mount: a read-only bind of its file, named `name` in the enabled sites directory. */
function siteMount(mount: Mount, name: string): SiteMount | Outcome {
  if (mount.type !== "bind" || mount.source === null) return fail(`the site ${name} is not a bind mount`);
  if (!mount.readOnly) return fail(`the site ${name} is not mounted read-only`);
  return { source: mount.source, name };
}

/**
 * Why the local edge's binds are not exactly its site files plus every one of LOCAL_MOUNTS, each a read-only bind of
 * that one regular file in deployment/edge/local/, or null. A link is refused even when it points inside, so the
 * mount names the file.
 */
function localFileMounts(edge: Service, edgeDir: string): Outcome | null {
  const local = EDGE_FILES.realpath(join(edgeDir, "local"));
  const seen = new Set<string>();
  for (const mount of edge.mounts) {
    const target = mountTarget(mount);
    if (siteFileTarget(target)) continue;
    const allowed = LOCAL_MOUNTS[target];
    if (allowed === undefined) {
      if (mount.type === "bind") return fail("the edge binds more than its sites and the local files");
      continue;
    }
    if (seen.has(target)) return fail(`the edge mounts ${target} more than once`);
    seen.add(target);
    const problem = localFileMount(mount, allowed, local);
    if (problem !== null) return problem;
  }
  // Each is required, not only allowed: without the TLS snippet's mount Caddy serves snippets/tls.caddy, while C18
  // read local/tls.caddy in its place (P1.33t).
  const absent = Object.keys(LOCAL_MOUNTS).find((target) => !seen.has(target));
  return absent === undefined ? null : fail(`${LOCAL_MOUNTS[absent]?.what} is not mounted`);
}

/** Why one LOCAL_MOUNTS entry is not a read-only bind of exactly its file in `local`, the realpathed local/. */
function localFileMount(mount: Mount, allowed: { file: string; what: string }, local: string | null): Outcome | null {
  if (mount.type !== "bind" || mount.source === null) return fail(`${allowed.what} is not a bind mount`);
  if (!mount.readOnly) return fail(`${allowed.what} is not mounted read-only`);
  const named = `deployment/edge/local/${allowed.file}`;
  if (local === null || EDGE_FILES.realpath(mount.source) !== join(local, allowed.file)) {
    return fail(`${allowed.what} is not ${named}`);
  }
  if (EDGE_FILES.kind(mount.source).type !== "file") return fail(`${allowed.what} is not a regular file: ${named}`);
  return null;
}

export const c18: Check = {
  id: "C18",
  run: (inputs) => {
    if (inputs.env === "local") return localEdgeZones(inputs);
    const lock = readLock(inputs);
    if (lock === null) return missing(inputs.lockPath);
    const ref = lock.edge?.ref;
    return edgeZones(
      inputs.compose,
      inputs.edgeDir,
      inputs.serviceEnv.get("edge"),
      typeof ref === "string" ? ref : undefined,
    );
  },
};
