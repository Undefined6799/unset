// C26 and C27 (P1.30y; architecture record 2026-10-12-p129-compose-service-keys): a build uses a Dockerfile the images
// workflow scans, from the context it builds that Dockerfile from, and the postgres socket directory is a tmpfs only on
// the postgres image.
import { readdirSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { resolveChecked, WALK_REASONS } from "../../../shared/host-pin/index.ts";
import type { Service } from "../compose-parse.ts";
import { lockOrNone } from "./lock.ts";
import { devCaFolder, holdsEnvFile, reachesDevCaFolder, reachesSecretsFolder } from "./secrets.ts";
import { type Check, fail, type Inputs, missing, type Outcome, pass, runsImage } from "./types.ts";

/** images.test.ts's discovery rule and list-dockerfiles.ts's name rule, copied: deployment/ imports no script. */
const DOCKERFILE = /(^|\/)([\w.-]+\.)?Dockerfile$/;
const NAME = /^[a-z0-9-]+$/;

/** The image name the workflow gives a Dockerfile: its folder for a file named Dockerfile, else its stem. */
const imageName = (path: string): string =>
  basename(path) === "Dockerfile" ? basename(dirname(path)) : basename(path).replace(/\.Dockerfile$/, "");

/**
 * realpath(3), so a link through `x/..` is judged where the kernel puts it (verifier B3 on #700). Unlike index.ts's,
 * every error reads as null, so a Dockerfile whose real path cannot be found counts as not scanned (fails closed).
 */
const realpathOrNull = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

/**
 * Whether the images workflow scans this Dockerfile, refusing what scripts/ci/list-dockerfiles.ts refuses: a path
 * outside deployment/ or under node_modules, a name it would not list, a missing file, and any symlink on the way (the
 * real path must be the path as written, from the repository's real root).
 */
function scanned(root: string, dockerfile: string, isFile: boolean): boolean {
  const path = relative(root, dockerfile).split(sep).join("/");
  const realRoot = realpathOrNull(root);
  return (
    path.startsWith("deployment/") &&
    DOCKERFILE.test(path) &&
    !path.includes("node_modules") &&
    NAME.test(imageName(path)) &&
    isFile &&
    realRoot !== null &&
    realpathOrNull(dockerfile) === join(realRoot, path)
  );
}

/**
 * How many Dockerfiles under deployment/ give this image name, by list-dockerfiles.ts's discovery and duplicate rule
 * (readdirSync recursive, Node v26.10.0 fs docs, as that script cites). Two would share one scan-matrix entry.
 */
function namesakes(root: string, name: string): number {
  return readdirSync(join(root, "deployment"), { recursive: true, encoding: "utf8" })
    .map((entry) => `deployment/${entry.split(sep).join("/")}`)
    .filter((path) => DOCKERFILE.test(path) && !path.includes("node_modules") && imageName(path) === name).length;
}

/**
 * The whole context goes to the daemon, whatever .dockerignore says (P1.27u, architecture record
 * 2026-10-12-p127u-bind-ancestors-and-build-context, (b)), so the secrets folder, the dev CA folder (P1.33w) and every
 * env file stay out of it. It is walked hop by hop like a bind source (Amendment 6): whoever can swap an entry on it
 * chooses what is sent.
 */
function contextProblem(context: string, inputs: Inputs): string | null {
  if (reachesSecretsFolder(context, inputs)) return "that reaches the secrets folder";
  if (reachesDevCaFolder(context, inputs)) return "that reaches the dev CA folder";
  if (holdsEnvFile(context, inputs)) return "that holds an env file";
  const walked = resolveChecked(context, inputs);
  return walked === null ? null : WALK_REASONS[walked];
}

/**
 * C26: every Dockerfile is one the images workflow discovers, so it ships scanned, and is built from the context it
 * builds that Dockerfile from (images.yml, scan-image "Build": a file named Dockerfile from its own folder, the edge; any
 * other from the repository root, as migrate copies shared/ and infrastructure/). Another context builds other files
 * than the scanned image holds. A context that reaches the secrets folder or the dev CA folder is refused first. Then
 * the dev CA folder itself: a second name for a CA file, in the checkout above all, is where a context or a bind would
 * carry the key, and neither the path nor the identity tests can see it (P1.33w, P1.35a).
 */
export const c26: Check = {
  id: "C26",
  run: (inputs) => {
    let built: Outcome | null;
    try {
      built = buildsProblem(inputs);
    } catch (error) {
      // A context test that throws on the dev CA folder (a self-loop link: realpath ELOOP) refuses by the folder's own
      // message (architecture 2026-10-15 02:08Z, N1). Anything else stays a check error.
      const folder = devCaFolderProblem(inputs);
      if (folder === null) throw error;
      return folder;
    }
    return built ?? devCaFolderProblem(inputs) ?? devTrustFolderProblem(inputs) ?? pass();
  },
};

function buildsProblem(inputs: Inputs): Outcome | null {
  for (const { name, build } of inputs.compose.services) {
    if (build === null) continue;
    const problem = buildProblem(build, inputs);
    if (problem !== null) return fail(`${name} ${problem}`);
  }
  return null;
}

/** Why C26 refuses this build, after the service's name, or null. */
export function buildProblem(build: NonNullable<Service["build"]>, inputs: Inputs): string | null {
  const reach = contextProblem(build.context, inputs);
  if (reach !== null) return `builds from a context ${reach}`;
  if (!scanned(inputs.root, build.dockerfile, inputs.stat(build.dockerfile)?.isFile() === true)) {
    return "builds from a Dockerfile the images workflow does not scan";
  }
  const path = relative(inputs.root, build.dockerfile).split(sep).join("/");
  if (namesakes(inputs.root, imageName(path)) !== 1) return "builds an image whose name another Dockerfile also takes";
  const context = basename(build.dockerfile) === "Dockerfile" ? dirname(build.dockerfile) : inputs.root;
  return build.context === context ? null : "builds from a context other than the images workflow's";
}

/**
 * Whether `service` runs the image built from `dockerfile` (repository-relative). Under dev and prod the lock's `ref`
 * or the build names it (runsImage). Under --env local there is no lock, so only the build can (P1.27l; record
 * 2026-10-13-p127l-local-gaps, Amendment 1): a build of exactly that Dockerfile, which C26 passes, with no image beside
 * it to disagree with. No name, tag or label stands in for it.
 */
export function runsBuilt(
  service: Service,
  inputs: Inputs,
  ref: unknown,
  dockerfile: string,
): "yes" | "no" | "mismatch" {
  const path = join(inputs.root, dockerfile);
  if (inputs.env !== "local") return runsImage(service, ref, path);
  if (service.build === null) return "no";
  if (service.image !== null) return "mismatch";
  return service.build.dockerfile === path && buildProblem(service.build, inputs) === null ? "yes" : "no";
}

/** What a reason says a service does not run: the lock's image, or under --env local the Dockerfile it must build. */
export const notRunning = (inputs: Inputs, image: string, dockerfile: string): string =>
  inputs.env === "local" ? `is not built from ${dockerfile}` : `does not run the lock's ${image}`;

const SOCKET_DIR = "/var/run/postgresql";
const POSTGRES_DOCKERFILE = "deployment/images/postgres.Dockerfile";

/** C27: only the postgres image gets a tmpfs over its socket directory, in either tmpfs form. */
export const c27: Check = {
  id: "C27",
  run: (inputs) => {
    const mounting = inputs.compose.services.filter(
      (service) =>
        service.tmpfs.some((entry) => entry.target === SOCKET_DIR) ||
        service.mounts.some((mount) => mount.type === "tmpfs" && mount.target === SOCKET_DIR),
    );
    if (mounting.length === 0) return pass();
    const lock = lockOrNone(inputs);
    if (lock === null) return missing(inputs.lockPath);
    for (const service of mounting) {
      const runs = runsBuilt(service, inputs, lock.postgres?.ref, POSTGRES_DOCKERFILE);
      // Keys and services only: the socket path and the image's name are values a configured PGHOST or POSTGRES_USER
      // could hold, and such a reason would be withheld whole (P1.30j).
      const why = `${service.name} mounts the socket-directory tmpfs but`;
      if (runs === "mismatch") return fail(`${why} its image and build name different images`);
      if (runs === "no") return fail(`${why} ${notRunning(inputs, "database image", POSTGRES_DOCKERFILE)}`);
    }
    return pass();
  },
};

/**
 * Why the dev CA folder fails C26, or null (architecture on verify-861-9ae3539, record
 * 2026-10-12-p134c-p134d-local-dev-root-ca, last sections). It is judged by lstat and must be a real directory. Local
 * needs it, dev judges it when it is there, and a prod host never has it. Every error refuses, naming the path.
 */
function devCaFolderProblem(inputs: Inputs): Outcome | null {
  const folder = devCaFolder(inputs);
  const info = inputs.lstat(folder);
  if (info === null) {
    if (!isAbsent(folder, inputs)) return fail(`dev CA folder cannot be read: ${folder}`);
    return inputs.env === "local" ? missing("unset-dev-ca") : null;
  }
  if (inputs.env === "prod") return fail("dev CA folder present on a prod host");
  if (!info.isDirectory()) return fail(`dev CA folder is not a real directory: ${folder}`);
  const problem = devCaEntryProblem(folder, inputs, "dev CA folder");
  if (problem !== null) return fail(problem);
  // A folder swapped while it was walked: the race stays a residual, but a swap left in place is caught (02:08Z).
  const after = inputs.lstat(folder);
  if (after === null || after.dev !== info.dev || after.ino !== info.ino) {
    return fail(`dev CA folder changed while it was checked: ${folder}`);
  }
  return null;
}

/** True only when nothing is there: realpath answers null for a missing path and throws on any other error. */
function isAbsent(path: string, inputs: Inputs): boolean {
  try {
    return inputs.realpath(path) === null;
  } catch {
    return false;
  }
}

/**
 * Why an entry under the dev CA folder is refused, or null. Our own recursion by lstat follows no link (a recursive
 * readdir follows linked folders, Node v26.10.0 doc/api/fs.md, fs.readdirSync `recursive`): the folder holds only
 * regular files with one link each and real folders. `what` names `dir` when its listing fails.
 */
function devCaEntryProblem(dir: string, inputs: Inputs, what = "dev CA folder entry"): string | null {
  let names: string[] | null;
  try {
    names = utf8Names(inputs.readdir(dir));
  } catch {
    return `${what} cannot be read: ${dir}`;
  }
  if (names === null) return `dev CA folder holds a name that is not UTF-8, in: ${dir}`;
  for (const name of names) {
    const path = join(dir, name);
    const info = inputs.lstat(path);
    if (info === null) return `dev CA folder entry cannot be read: ${path}`;
    if (info.isSymbolicLink()) return `dev CA folder holds a link: ${path}`;
    const problem = info.isDirectory() ? devCaEntryProblem(path, inputs) : fileProblem(path, info);
    if (problem !== null) return problem;
  }
  return null;
}

const fileProblem = (path: string, info: Stats): string | null => {
  if (!info.isFile()) return `dev CA folder holds something other than files and folders: ${path}`;
  return info.nlink === 1 ? null : `dev CA file has extra hard links: ${path}`;
};

/**
 * Why the folder of the dev root pds and web trust fails C26 under local, or null (P1.33g; record
 * 2026-10-12-p134c-p134d-local-dev-root-ca, "Architecture confirmation", condition 1). It is a real directory holding
 * exactly root.pem: a regular file by lstat, with one link, that no group or other user can write. Every error refuses,
 * naming the path. C18 judges what root.pem holds.
 */
function devTrustFolderProblem(inputs: Inputs): Outcome | null {
  if (inputs.env !== "local") return null;
  const folder = join(dirname(inputs.root), "unset-dev-trust");
  const info = inputs.lstat(folder);
  if (info === null) {
    return isAbsent(folder, inputs) ? missing("unset-dev-trust") : fail(`dev trust folder cannot be read: ${folder}`);
  }
  if (!info.isDirectory()) return fail(`dev trust folder is not a real directory: ${folder}`);
  let names: string[] | null;
  try {
    names = utf8Names(inputs.readdir(folder));
  } catch {
    return fail(`dev trust folder cannot be read: ${folder}`);
  }
  if (names === null) return fail(`dev trust folder holds something other than root.pem: ${folder}`);
  const other = names.find((name) => name !== "root.pem");
  if (other !== undefined) return fail(`dev trust folder holds something other than root.pem: ${join(folder, other)}`);
  const path = join(folder, "root.pem");
  const root = inputs.lstat(path);
  if (root === null)
    return names.length === 0 ? missing("unset-dev-trust/root.pem") : fail(`dev trust root cannot be read: ${path}`);
  if (!root.isFile()) return fail(`dev trust root is not a regular file: ${path}`);
  if (root.nlink !== 1) return fail(`dev trust root has extra hard links: ${path}`);
  if ((root.mode & 0o022) !== 0) return fail(`dev trust root is writable by group or other: ${path}`);
  return null;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The names, sorted, or null when one is not UTF-8 (architecture 2026-10-15 02:08Z, S2). readdir hands over each name
 * as its bytes (`encoding: "buffer"`, Node v26.10.0 doc/api/fs.md, fs.readdirSync). A lossy decode turns every invalid
 * byte into U+FFFD, so an entry could be judged by a clean neighbour's name; `fatal` throws instead, and `ignoreBOM`
 * keeps a leading BOM (doc/api/util.md, new TextDecoder). Valid UTF-8 decoded that way encodes back to the same bytes,
 * so each path built from these names is the entry's own (the U+FFFD and 0xff cases in preflight.test.ts pin it).
 */
function utf8Names(names: Buffer[]): string[] | null {
  const decoded: string[] = [];
  for (const name of names) {
    try {
      decoded.push(UTF8.decode(name));
    } catch {
      return null;
    }
  }
  return decoded.sort();
}
