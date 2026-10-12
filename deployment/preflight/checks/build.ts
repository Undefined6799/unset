// C26 and C27 (P1.30y; architecture record 2026-10-12-p129-compose-service-keys): a build uses a Dockerfile the images
// workflow scans, from the context it builds that Dockerfile from, and the postgres socket directory is a tmpfs only on
// the postgres image.
import { basename, dirname, join, relative, sep } from "node:path";
import { readLock } from "./images.ts";
import { type Check, fail, missing, pass, runsImage } from "./types.ts";

/** images.test.ts's discovery rule, as scripts/ci/list-dockerfiles.ts copies it; deployment/ imports no script. */
const DOCKERFILE = /(^|\/)([\w.-]+\.)?Dockerfile$/;

/**
 * C26: every Dockerfile is one the images workflow discovers, so it ships scanned, and is built from the context that
 * workflow uses (images.yml, scan-image "Build": a file named Dockerfile from its own folder, the edge; any other from
 * the repository root, as migrate copies shared/ and infrastructure/). Another context builds other files than the
 * scanned image holds.
 */
export const c26: Check = {
  id: "C26",
  run: (inputs) => {
    for (const { name, build } of inputs.compose.services) {
      if (build === null) continue;
      const path = relative(inputs.root, build.dockerfile).split(sep).join("/");
      const scanned =
        path.startsWith("deployment/") &&
        DOCKERFILE.test(path) &&
        !path.includes("node_modules") &&
        inputs.stat(build.dockerfile)?.isFile() === true;
      if (!scanned) return fail(`${name} builds from a Dockerfile the images workflow does not scan`);
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
      const why = `${service.name} mounts a tmpfs on ${SOCKET_DIR} but`;
      if (runs === "mismatch") return fail(`${why} its image and build name different images`);
      if (runs === "no") return fail(`${why} does not run the postgres image`);
    }
    return pass();
  },
};
