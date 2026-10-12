// C26 and C27 (P1.30y; architecture record 2026-10-12-p129-compose-service-keys): a build uses a Dockerfile the images
// workflow scans, from the context it builds that Dockerfile from, and the postgres socket directory is a tmpfs only on
// the postgres image.
import { readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { readLock } from "./images.ts";
import { holdsEnvFile, reachesSecretsFolder, resolveChecked, WALK_REASONS } from "./secrets.ts";
import { type Check, fail, type Inputs, missing, pass, runsImage } from "./types.ts";

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
 * 2026-10-12-p127u-bind-ancestors-and-build-context, (b)), so the secrets folder and every env file stay out of it. It
 * is walked hop by hop like a bind source (Amendment 6): whoever can swap an entry on it chooses what is sent.
 */
function contextProblem(context: string, inputs: Inputs): string | null {
  if (reachesSecretsFolder(context, inputs)) return "that reaches the secrets folder";
  if (holdsEnvFile(context, inputs)) return "that holds an env file";
  const walked = resolveChecked(context, inputs);
  return walked === null ? null : WALK_REASONS[walked];
}

/**
 * C26: every Dockerfile is one the images workflow discovers, so it ships scanned, and is built from the context that
 * workflow uses (images.yml, scan-image "Build": a file named Dockerfile from its own folder, the edge; any other from
 * the repository root, as migrate copies shared/ and infrastructure/). Another context builds other files than the
 * scanned image holds. A context that reaches the secrets folder is refused first.
 */
export const c26: Check = {
  id: "C26",
  run: (inputs) => {
    for (const { name, build } of inputs.compose.services) {
      if (build === null) continue;
      const reach = contextProblem(build.context, inputs);
      if (reach !== null) return fail(`${name} builds from a context ${reach}`);
      if (!scanned(inputs.root, build.dockerfile, inputs.stat(build.dockerfile)?.isFile() === true)) {
        return fail(`${name} builds from a Dockerfile the images workflow does not scan`);
      }
      const path = relative(inputs.root, build.dockerfile).split(sep).join("/");
      if (namesakes(inputs.root, imageName(path)) !== 1) {
        return fail(`${name} builds an image whose name another Dockerfile also takes`);
      }
      const context = basename(build.dockerfile) === "Dockerfile" ? dirname(build.dockerfile) : inputs.root;
      if (build.context !== context) return fail(`${name} builds from a context other than the images workflow's`);
    }
    return pass();
  },
};

const SOCKET_DIR = "/var/run/postgresql";

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
    const lock = readLock(inputs);
    if (lock === null) return missing(inputs.lockPath);
    const dockerfile = join(inputs.root, "deployment/images/postgres.Dockerfile");
    for (const service of mounting) {
      const runs = runsImage(service, lock.postgres?.ref, dockerfile);
      // Keys and services only: the socket path and the image's name are values a configured PGHOST or POSTGRES_USER
      // could hold, and such a reason would be withheld whole (P1.30j).
      const why = `${service.name} mounts the socket-directory tmpfs but`;
      if (runs === "mismatch") return fail(`${why} its image and build name different images`);
      if (runs === "no") return fail(`${why} does not run the lock's database image`);
    }
    return pass();
  },
};
