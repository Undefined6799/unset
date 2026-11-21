// C18, the edge (P1.30u; ADR 0046): first the rules about the compose file itself, which image the edge service
// runs, which sites, files and secrets it mounts and from where, and which hosts it serves; then Caddy's own reading
// of those files. edge-adapt.ts runs `caddy adapt` in the edge image on the same mounts and values and holds the
// output to the reviewed adapted config (deployment/edge/adapted.ts) and the rules on it
// (deployment/edge/adapted-rules.ts). C18 reads the Caddyfile format nowhere itself: since P1.39e it no longer
// calls the reader (ADR 0046 decision 5).
//
// Under --env local (P1.27l) the edge is built from deployment/edge/Dockerfile rather than run from the lock, and it
// mounts two files from deployment/edge/local/ beside its sites: the dev leaf's TLS snippet and the app site
// (architecture records 2026-10-12-refocus-local-signin-rulings, Amendment 2, and 2026-10-13-p127l-local-gaps, items
// 1 and 2). Every config rule still applies to what it serves; only where the image's identity comes from changes.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { DEV_APP, DOCS_ROOT, ENV_NAMES } from "../../edge/adapted-rules.ts";
import type { Compose, Mount, Service } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";
import { runsBuilt } from "./build.ts";
import { ADAPT_TIMEOUT_MS, adaptedEdge, type CaddyBind, type EdgeImage } from "./edge-adapt.ts";
import { appHostProblem, localLeafProblem } from "./local-leaf.ts";
import { readLock } from "./lock.ts";
import { pdsHostProblem } from "./pds-host.ts";
import { type Check, type Earlier, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** Where the edge image reads its enabled sites (deployment/edge/Caddyfile, `import sites/enabled/*.caddy`). */
export const SITES_TARGET = "/etc/caddy/sites/enabled";
const CADDY_ROOT = "/etc/caddy";

/**
 * The file-system reads C18's mount rules take, each one direct node:fs call with no filtering and no path logic.
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
 * The dev edge's site mounts, or why its binds are not exactly ADR 0032 Decision 3's three and the docs site's two:
 * dev/app.caddy, dev/pds.caddy and dev/docs.caddy, each one read-only file bind at /etc/caddy/sites/enabled/<its
 * name>, dev/tls.caddy at /etc/caddy/snippets/tls.caddy (P1.38e), and the built docs at DOCS_ROOT (P1.21w; ADR 0075).
 * No directory is mounted at the enabled sites, and the edge binds nothing else; siteMountsProblem then requires each
 * site from dev/ by its own name.
 */
export function devSiteMounts(compose: Compose, edgeDir: string): SiteMount[] | Outcome {
  const edge = compose.services.find((service) => service.name === "edge");
  if (edge === undefined) return missing("the edge service");
  const sites: SiteMount[] = [];
  const tls: Mount[] = [];
  const docs: Mount[] = [];
  for (const mount of edge.mounts) {
    const target = mountTarget(mount);
    if (target === SITES_TARGET) return fail(`the dev edge mounts a directory at ${SITES_TARGET}`);
    if (target === DOCS_ROOT) {
      docs.push(mount);
      continue;
    }
    if (siteFileTarget(target)) {
      const site = siteMount(mount, posix.basename(target));
      if (!("source" in site)) return site;
      sites.push(site);
    } else if (DEV_MOUNTS[target] !== undefined) tls.push(mount);
    else if (overCaddyConfig(target)) return fail(`the edge mounts over ${target}`);
    else if (mount.type === "bind") return fail("the edge binds more than the dev sites and the dev (tls)");
  }
  // ADR 0032 Decision 1: the dev (tls) over the shipped one, exactly once, from deployment/edge/dev/tls.caddy.
  const [snippet, ...again] = tls;
  const allowed = DEV_MOUNTS[`${CADDY_ROOT}/snippets/tls.caddy`] as { file: string; what: string };
  if (snippet === undefined) return fail(`${allowed.what} is not mounted`);
  if (again.length > 0) return fail(`the edge mounts ${CADDY_ROOT}/snippets/tls.caddy more than once`);
  const problem = editFileMount(snippet, allowed, EDGE_FILES.realpath(join(edgeDir, "dev")), "dev");
  if (problem !== null) return problem;
  const built = docsMountProblem(docs, edgeDir);
  if (built !== null) return built;
  const absent = sites.find((site) => !sourceExists(site.source));
  if (absent !== undefined) return missing(absent.source);
  if (sites.length === 0) return missing(`the edge's site mounts in ${SITES_TARGET}`);
  const chat = sites.some((site) => site.name === CHAT_SITE);
  if (chat && !CHAT_EDGE_NETWORKS.every((network) => edge.networks.includes(network))) {
    return fail(`the chat site is mounted on an edge outside ${CHAT_EDGE_NETWORKS.join(" and ")}`);
  }
  return siteMountsProblem(sites, edgeDir, chat ? "dev-chat" : "dev") ?? sites;
}

/** The built docs, relative to the repository root: the Hugo site's output folder (docs/site/README.md). */
const DOCS_BUILD = "docs/site/public";

/**
 * Why the dev edge's docs mount is not exactly one read-only bind of the repository's own DOCS_BUILD folder at
 * DOCS_ROOT, or null (P1.21w; ADR 0075). The folder is git-ignored but for its .gitkeep, so it exists on every
 * checkout; realpath follows any link, so the bind cannot name a folder outside the checkout under another name.
 */
function docsMountProblem(docs: readonly Mount[], edgeDir: string): Outcome | null {
  const [mount, ...again] = docs;
  if (mount === undefined) return fail(`the built docs are not mounted at ${DOCS_ROOT}`);
  if (again.length > 0) return fail(`the edge mounts ${DOCS_ROOT} more than once`);
  if (mount.type !== "bind" || mount.source === null) return fail(`${DOCS_ROOT} is not a bind mount`);
  if (!mount.readOnly) return fail(`${DOCS_ROOT} is not mounted read-only`);
  const root = EDGE_FILES.realpath(join(edgeDir, "..", ".."));
  const source = EDGE_FILES.realpath(mount.source);
  if (source === null) return missing(mount.source);
  if (root === null || source !== join(root, DOCS_BUILD)) return fail(`${DOCS_ROOT} is not mounted from ${DOCS_BUILD}`);
  return EDGE_FILES.kind(source).type === "dir" ? null : fail(`${DOCS_ROOT} is not mounted from a directory`);
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
 * C18's rules about the compose file under dev and prod: the edge runs the lock's image (or a judged build), mounts
 * its sites as the env's shape allows, and has an environment. Under prod the enabled sites folder is sites/ itself
 * or inside it, so a dev/ or local/ folder is refused (P1.36c). What the files mean is Caddy's to say: c18 then
 * holds `caddy adapt`'s output to the reviewed config and its rules (edge-adapt.ts; P1.39e, ADR 0046 decision 5).
 */
export function edgeZones(
  compose: Compose,
  edgeDir: string,
  env: SecretMap | undefined,
  edgeRef: string | undefined,
  mode: "shipped" | "dev" = "shipped",
  built = false,
): Outcome {
  // A built edge (dev --source, P1.37y) was already judged by its Dockerfile in deployedEdgeZones; the lock's ref
  // names nothing it runs.
  const image = built ? null : edgeImage(compose, edgeRef);
  if (image !== null) return image;
  const sites = mode === "dev" ? devSiteMounts(compose, edgeDir) : edgeSitesDir(compose, edgeDir);
  if (!Array.isArray(sites) && !("dir" in sites)) return sites;
  if (mode === "dev") {
    const problem = devEdgeProblem(compose);
    if (problem !== null) return problem;
  } else if (!Array.isArray(sites) && !insideSites(sites.dir, edgeDir)) {
    return fail("the enabled sites directory is not inside sites/");
  }
  if (env === undefined) return missing("the edge service's environment");
  return pass();
}

/** Whether the realpathed `dir` is deployment/edge/sites/ or lies inside it. */
function insideSites(dir: string, edgeDir: string): boolean {
  const root = EDGE_FILES.realpath(edgeDir);
  return root !== null && (dir === join(root, "sites") || dir.startsWith(`${join(root, "sites")}/`));
}

/** The dev leaf's certificate and key (P1.36c; ADR 0032), both required. */
const DEV_EDGE_SECRETS = ["dev_tls_cert", "dev_tls_key"];
/**
 * Web's PDS key (P1.21j; Proposed ADR 0071), the one other secret an edge may read. It is not required here: without
 * it web's calls stay in the tight PDS zones (fail closed), and C9 judges the file of every secret that is mounted.
 */
const WEB_KEY_SECRET = "pds_web_key";

/**
 * Why the dev edge is not the shape ADR 0032 Decisions 3 and 4 allow, or null: it publishes no port, since Pangolin
 * reaches it only through Newt (ADR 0030 Decision 2), and it reads exactly the dev leaf's two secrets.
 */
function devEdgeProblem(compose: Compose): Outcome | null {
  const edge = compose.services.find((service) => service.name === "edge");
  if (edge === undefined) return missing("the edge service");
  if (edge.ports.length > 0) return fail("the edge publishes a port under dev");
  if (edge.secrets.some((name) => !DEV_EDGE_SECRETS.includes(name) && name !== WEB_KEY_SECRET)) {
    return fail("the edge reads a secret other than the dev leaf's");
  }
  if (DEV_EDGE_SECRETS.some((name) => !edge.secrets.includes(name))) return fail("the edge does not read the dev leaf");
  return leafReaders(compose).some((service) => service !== "edge")
    ? fail("a service other than the edge reads the dev leaf")
    : null;
}

/**
 * Every service that can read the dev leaf's files: by a secret whose file resolves to one of them, under any name, or
 * by a bind of that file or a folder above it. The leaf's key signs for both staging names (ADR 0032 Decision 3).
 */
function leafReaders(compose: Compose): string[] {
  const leaf = DEV_EDGE_SECRETS.flatMap((name) => compose.secretFileByName.get(name) ?? []);
  const isLeaf = (path: string) =>
    leaf.some((file) => file === path || file.startsWith(`${path.replace(/\/+$/, "")}/`));
  return compose.services
    .filter(
      (service) =>
        service.secrets.some((name) => isLeaf(compose.secretFileByName.get(name) ?? "")) ||
        service.mounts.some((mount) => mount.type === "bind" && mount.source !== null && isLeaf(mount.source)),
    )
    .map((service) => service.name);
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

/**
 * The files a local edge mounts from deployment/edge/local/ outside the sites, by target: each at most once,
 * read-only, by that name. The app site, local/app.caddy at sites/enabled/app.caddy, is one of the site mounts, which
 * siteMountsProblem judges with the enabled sites (localSiteMounts, P1.33y).
 */
const LOCAL_MOUNTS: Record<string, { file: string; what: string }> = {
  [`${CADDY_ROOT}/snippets/tls.caddy`]: { file: "tls.caddy", what: "the TLS snippet" },
};
/** The one file a dev edge mounts from deployment/edge/dev/ beside its two sites (P1.36c, P1.38e; ADR 0032). */
const DEV_MOUNTS: Record<string, { file: string; what: string }> = {
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
  if (edge.secrets.some((name) => !LOCAL_EDGE_SECRETS.includes(name) && name !== WEB_KEY_SECRET)) {
    return fail("the edge reads a secret other than the dev leaf's");
  }
  const sites = localSiteMounts(edge);
  if (!Array.isArray(sites)) return sites;
  const absent = sites.find((site) => !sourceExists(site.source));
  if (absent !== undefined) return missing(absent.source);
  const foreign = siteMountsProblem(sites, inputs.edgeDir, "local");
  if (foreign !== null) return foreign;
  const files = localFileMounts(edge, inputs.edgeDir);
  if (files !== null) return files;
  const env = inputs.serviceEnv.get("edge");
  if (env === undefined) return missing("the edge service's environment");
  const appHost = env.use("APP_HOST", (value) => value);
  const pdsHost = env.use("PDS_HOST", (value) => value);
  const host = appHostProblem(inputs, appHost, pdsHost);
  if (host !== null) return host;
  const pds = pdsHostProblem(inputs, pdsHost);
  if (pds !== null) return pds;
  const leaf = localLeafProblem(inputs, appHost ?? "", pdsHost ?? "");
  if (leaf !== null) return leaf;
  return pass();
}

/** A target that names one file directly in the enabled sites directory. */
const siteFileTarget = (target: string): boolean => posix.dirname(target) === SITES_TARGET;

/**
 * The enabled sites a local edge mounts, one read-only bind per file at /etc/caddy/sites/enabled/<name>, never the
 * directory (P1.33y; book edit 2026-10-13-p134o-after-791, Amendment 1; local-gaps Amendment 3 S2).
 * siteMountsProblem then requires exactly every sites/*.caddy and local/app.caddy, each from where it belongs. Any other
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

/** Whether `path` names anything at all, a dangling link included; siteMountsProblem then judges what it is (verify-876 N5). */
function sourceExists(path: string): boolean {
  try {
    EDGE_FILES.kind(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** One read-only file mount at /etc/caddy/sites/enabled/`name`: the host file it binds and its name there (P1.34q). */
type SiteMount = { source: string; name: string };

/** The dev edge's three sites, each from deployment/edge/dev/ under its own name (ADR 0032 Decision 3; P1.21w). */
const DEV_SITES = ["app.caddy", "docs.caddy", "pds.caddy"];
/**
 * The chat site (P6.02), a fourth from dev/ on the source stack alone, whose edge joins the two networks its upstreams
 * sit on (compose.dev.source.yaml; ADR 0093 decision 6). An edge on neither would dial the door's and Synapse's fixed
 * addresses through its one outside network.
 */
const CHAT_SITE = "chat.caddy";
const CHAT_EDGE_NETWORKS = ["chat_edge", "chat_edge_synapse"];
/** The app site a local edge mounts from deployment/edge/local/ beside the shipped sites (P1.34a). */
const LOCAL_APP_SITE = "app.caddy";
/** Which sites a non-shipped edge mounts: local's, dev's three, or dev's with the chat site. */
type SiteMode = "local" | "dev" | "dev-chat";

/**
 * The folder under deployment/edge/ each site a local or dev edge mounts comes from, by the site's name, or why it
 * cannot be said: under dev exactly DEV_SITES from dev/, with CHAT_SITE on the source stack; under local every
 * sites/*.caddy from sites/ and the app site from local/ (P1.34q; local-gaps Amendment 3 S2).
 */
function expectedSites(root: string, mode: SiteMode): Map<string, string> | Outcome {
  if (mode === "dev") return new Map(DEV_SITES.map((name) => [name, "dev"]));
  if (mode === "dev-chat") return new Map([...DEV_SITES, CHAT_SITE].map((name) => [name, "dev"]));
  const expected = new Map<string, string>();
  for (const name of EDGE_FILES.list(join(root, "sites")).filter((n) => n.endsWith(".caddy"))) {
    expected.set(name, "sites");
  }
  if (expected.has(LOCAL_APP_SITE)) return fail(`${LOCAL_APP_SITE}: an enabled site has the mounted app site's name`);
  return expected.set(LOCAL_APP_SITE, "local");
}

/**
 * Why a local or dev edge's site mounts are not exactly the repository's own files, or null: each mount is one
 * regular file, never a link or a folder, that resolves to the file of its name in the folder expectedSites gives;
 * no name is mounted twice, and none is left out. The reader's mountedSites held this until P1.39e; it is a rule
 * about the compose file, so it stays C18's when the reader goes (ADR 0046, "C18's mount-source rules stay").
 */
function siteMountsProblem(sites: readonly SiteMount[], edgeDir: string, mode: SiteMode): Outcome | null {
  const root = EDGE_FILES.realpath(edgeDir);
  if (root === null) return missing(edgeDir);
  const expected = expectedSites(root, mode);
  if (!(expected instanceof Map)) return expected;
  const seen = new Set<string>();
  for (const { source, name } of sites) {
    if (EDGE_FILES.kind(source).type !== "file") return fail(`${name}: the mount is not one regular file`);
    const folder = expected.get(name);
    if (folder === undefined) return fail(`${name}: not a site the ${mode === "local" ? "local" : "dev"} stack mounts`);
    if (EDGE_FILES.realpath(source) !== join(root, folder, name)) {
      return fail(`${name}: not mounted from ${folder}/${name}`);
    }
    if (seen.has(name)) return fail(`${name}: mounted more than once`);
    seen.add(name);
  }
  const absent = [...expected.keys()].sort().find((name) => !seen.has(name));
  return absent === undefined ? null : fail(`${absent}: not mounted`);
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
    const problem = editFileMount(mount, allowed, local, "local");
    if (problem !== null) return problem;
  }
  // Each is required, not only allowed: without the TLS snippet's mount Caddy serves snippets/tls.caddy (P1.33t).
  const absent = Object.keys(LOCAL_MOUNTS).find((target) => !seen.has(target));
  return absent === undefined ? null : fail(`${LOCAL_MOUNTS[absent]?.what} is not mounted`);
}

/**
 * Why one LOCAL_MOUNTS or DEV_MOUNTS entry is not a read-only bind of exactly its file in `dir`, the realpathed
 * deployment/edge/`folder`/.
 */
function editFileMount(
  mount: Mount,
  allowed: { file: string; what: string },
  dir: string | null,
  folder: "local" | "dev",
): Outcome | null {
  if (mount.type !== "bind" || mount.source === null) return fail(`${allowed.what} is not a bind mount`);
  if (!mount.readOnly) return fail(`${allowed.what} is not mounted read-only`);
  const named = `deployment/edge/${folder}/${allowed.file}`;
  if (dir === null || EDGE_FILES.realpath(mount.source) !== join(dir, allowed.file)) {
    return fail(`${allowed.what} is not ${named}`);
  }
  if (EDGE_FILES.kind(mount.source).type !== "file") return fail(`${allowed.what} is not a regular file: ${named}`);
  return null;
}

/** C18 under dev and prod: the edge serves the PDS's own name (P1.35l), then runs the lock's edge with its sites. */
function deployedEdgeZones(inputs: Inputs): Outcome {
  const lock = readLock(inputs);
  if (lock === null) return missing(inputs.lockPath);
  const env = inputs.serviceEnv.get("edge");
  const pds = pdsHostProblem(
    inputs,
    env?.use("PDS_HOST", (value) => value),
  );
  if (pds !== null) return pds;
  if (inputs.env === "dev") {
    const staging = devHostsProblem(inputs, env?.use("PDS_HOST", (value) => value) ?? "");
    if (staging !== null) return staging;
  }
  const ref = lock.edge?.ref;
  // Under dev with --source the edge is built from the checkout (P1.37y; ADR 0036 Decision 2), judged as C25 and the
  // local rule judge it: exactly EDGE_DOCKERFILE, a build C26 passes, no image beside it (Codex on #1309).
  const edge = inputs.compose.services.find((service) => service.name === "edge");
  const built = inputs.source && edge !== undefined && edge.build !== null;
  if (built && runsBuilt(edge, inputs, undefined, EDGE_DOCKERFILE) !== "yes") {
    return fail(`the edge is not built from ${EDGE_DOCKERFILE}`);
  }
  // Under dev the edge serves the dev sites with the self-signed leaf (P1.38e; ADR 0032 Decision 3); prod is unchanged.
  const mode = inputs.env === "dev" ? "dev" : "shipped";
  return edgeZones(inputs.compose, inputs.edgeDir, env, typeof ref === "string" ? ref : undefined, mode, built);
}

/**
 * The dev stack's PDS host, exactly (ADR 0025's staging PDS name, P1.37 follow-up): the name the dev leaf's SAN and
 * Pangolin's resource carry (ADR 0032), so a dev PDS under any other name could not complete TLS or routing.
 */
const DEV_PDS_HOST = "staging.unset.ac";

/**
 * Under dev both hosts are the ruled staging names (P1.37 follow-up): the PDS is DEV_PDS_HOST, and web's PUBLIC_ORIGIN
 * names DEV_APP's host, the one the dev app site serves, so its OAuth metadata, redirects and CSRF origin match it.
 * Whether that origin is https is C29's. Reasons are fixed words.
 */
function devHostsProblem(inputs: Inputs, pdsHost: string): Outcome | null {
  if (pdsHost.toLowerCase() !== DEV_PDS_HOST) {
    return fail("PDS_HOST is not the staging PDS name");
  }
  const origin = inputs.serviceEnv.get("web")?.use("PUBLIC_ORIGIN", (value) => value);
  if (origin === undefined) return fail("web's PUBLIC_ORIGIN is missing");
  // Exactly the bare origin, as shared/config's origin() parser takes it, so web starts with the value C18 passed. A
  // value that is not an https URL at all is C29's to name.
  if (URL.canParse(origin) && new URL(origin).protocol === "https:" && origin !== `https://${DEV_APP.APP_HOST}`) {
    return fail("web's PUBLIC_ORIGIN is not the dev app origin");
  }
  return null;
}

/** The checks that say the lock's images are the signed, verified ones: C18 runs the lock's edge only after them. */
const IMAGE_CHECKS = ["C2", "C3", "C4", "C5"];

/**
 * The image `caddy adapt` may run in (P1.39c), or why none. Under local and dev --source it is the edge's own build,
 * which the compose rules above held to EDGE_DOCKERFILE, and it is built only when the whole of C26 passed in this
 * run (C26 comes before C18 in the list): its context rule and its dev CA and dev trust folder rules, so no second
 * name for a CA file is ever sent to the daemon (Codex on #1609). Otherwise it is the lock's edge reference, and only
 * when C2 to C5 each passed in this run, as a verified image and not a local stack's unsigned one.
 */
function adaptImage(inputs: Inputs, edge: Service, earlier: Earlier): EdgeImage | Outcome {
  if (edge.build !== null && (inputs.env === "local" || inputs.source)) {
    if (earlier.get("C26")?.pass !== true) return fail("the edge image was not built: C26 does not pass");
    return { dockerfile: edge.build.dockerfile, context: edge.build.context };
  }
  const verified = IMAGE_CHECKS.every((id) => earlier.get(id)?.pass === true && earlier.get(id)?.unsigned !== true);
  if (!verified) return fail("the edge image was not run: C2 to C5 did not all pass");
  const ref = readLock(inputs)?.edge?.ref;
  return typeof ref === "string" && ref === edge.image
    ? { ref }
    : fail("the edge image was not run: it is not the lock's");
}

/** The edge's binds at or under /etc/caddy, each one the compose rules above required to be a read-only bind. */
function caddyBinds(edge: Service): CaddyBind[] | Outcome {
  const binds: CaddyBind[] = [];
  for (const mount of edge.mounts) {
    const target = mountTarget(mount);
    if (target !== CADDY_ROOT && !target.startsWith(`${CADDY_ROOT}/`)) continue;
    if (mount.type !== "bind" || mount.source === null || !mount.readOnly) {
      return fail("an edge mount cannot be given to caddy adapt");
    }
    binds.push({ source: mount.source, target });
  }
  return binds;
}

/** C18's rules about the compose file, for the env. */
function composeRules(inputs: Inputs): Outcome {
  switch (inputs.env) {
    case "local":
      return localEdgeZones(inputs);
    case "dev":
    case "prod":
      return deployedEdgeZones(inputs);
    default: {
      const unknown: never = inputs.env;
      return fail(`no C18 rule for the env ${String(unknown)}`);
    }
  }
}

/**
 * The edge's environment, from `environment` and env files alike, holds no name beside the five its config reads
 * (P1.39e). Caddy replaces `{$NAME}` from its process environment before it lexes, and an unset name with no default
 * becomes nothing (v2.11.7 caddyconfig/caddyfile/parse.go:63-64, replaceEnvVars :67-108). `caddy adapt` below is
 * handed the five names only, so a placeholder for any other name adapts to the same config whatever the running
 * edge would put there. With no other name on the service, the running edge reads what adapt read. The reader
 * refused the placeholder; this refuses the name. Fixed words: the name comes from a file.
 */
const FOREIGN_NAME = "the edge's environment sets a name other than its five placeholders";

/**
 * C18: the compose rules first, then Caddy's own reading of the edge's files in the edge image
 * (edge-adapt.ts). It pulls or builds that image, so it is a network check with its own deadline.
 */
export const c18: Check = {
  id: "C18",
  network: true,
  timeoutMs: ADAPT_TIMEOUT_MS,
  run: async (inputs, signal, earlier) => {
    const rules = composeRules(inputs);
    if (!rules.pass) return rules;
    const edge = inputs.compose.services.find((service) => service.name === "edge");
    const env = inputs.serviceEnv.get("edge");
    if (edge === undefined || env === undefined) return missing("the edge service");
    if (env.names().some((name) => !Object.hasOwn(ENV_NAMES, name))) return fail(FOREIGN_NAME);
    const image = adaptImage(inputs, edge, earlier ?? new Map());
    if ("pass" in image) return image;
    const binds = caddyBinds(edge);
    if (!Array.isArray(binds)) return binds;
    const mode = inputs.env === "local" ? "local" : inputs.env === "dev" ? "dev" : "shipped";
    return adaptedEdge(inputs, image, binds, env, mode, signal);
  },
};
