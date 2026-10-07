// P1.27: the image's bases are pinned and the Dockerfile ships only what production runs (step book P1.27; architecture
// ruling 2026-10-06 23:15Z, book edit 2026-10-06-p127-upstream-base-by-digest). Every FROM, the build stages included,
// names its base by the multi-arch index digest recorded in deployment/images/bases.lock.json, from a host on a fixed
// allowlist: the one official upstream image (interim, until P1.27s mirrors it and flips the host) and our GHCR
// namespace. The build itself (hadolint, Trivy, non-root, no dev dependencies, healthy) runs in the images workflow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const DOCKERFILE = "images/node-app.Dockerfile";

/** What an image is built FROM; the deploy contract (images.lock.json, verify-images) arrives with P1.27s. */
type Base = { ref: string; tag: string; digest: string; source: "upstream" | "mirror" };
type Lock = Record<string, Base>;

/** Where a base may come from: the official Node image upstream (interim) and our own GHCR namespace. */
const ALLOWED = [/^docker\.io\/library\/node$/, /^ghcr\.io\/undefined6799\/[a-z0-9._/-]+$/];
const FROM = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
const PINNED = /^([a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+)(?::([\w][\w.-]{0,127}))?@(sha256:[0-9a-f]{64})$/;

/** The image each FROM names, with stage names left out (a FROM may build on an earlier stage). */
function fromImages(dockerfile: string): string[] {
  const stages = new Set<string>();
  const images: string[] = [];
  for (const line of dockerfile.split("\n")) {
    const match = FROM.exec(line.trim());
    if (match === null) continue;
    const [, image = "", stage] = match;
    if (!stages.has(image)) images.push(image);
    if (stage !== undefined) stages.add(stage);
  }
  return images;
}

/** Every problem with the Dockerfile's bases against the lock, empty when each FROM is pinned, allowed and locked. */
function baseProblems(dockerfile: string, lock: Lock): string[] {
  const images = fromImages(dockerfile);
  if (images.length === 0) return ["the Dockerfile has no FROM"];
  return images.flatMap((image) => {
    const pinned = PINNED.exec(image);
    if (pinned === null) return [`FROM ${image} is not pinned by digest`];
    const [, ref = "", , digest = ""] = pinned;
    if (!ALLOWED.some((host) => host.test(ref))) return [`FROM ${image} is not from an allowed host`];
    const locked = Object.values(lock).find((base) => base.ref === ref);
    if (locked === undefined) return [`FROM ${image} has no lock entry`];
    return locked.digest === digest ? [] : [`FROM ${image} differs from the lock digest ${locked.digest}`];
  });
}

const dockerfile = read(DOCKERFILE);
const lock = JSON.parse(read("images/bases.lock.json")) as Lock;
const NODE = lock.node as Base;
const pinnedNode = `docker.io/library/node:${NODE.tag}@${NODE.digest}`;

describe("base images", () => {
  test("base_digest_matches_lock", () => {
    expect(baseProblems(dockerfile, lock)).toEqual([]);
    expect(fromImages(dockerfile).length).toBeGreaterThanOrEqual(2);
    const other = `sha256:${"1".repeat(64)}`;
    expect(baseProblems(`FROM docker.io/library/node:${NODE.tag}@${other} AS build`, lock)).toEqual([
      `FROM docker.io/library/node:${NODE.tag}@${other} differs from the lock digest ${NODE.digest}`,
    ]);
    // A later stage may build on an earlier one by name; only real images are checked.
    expect(baseProblems(`FROM ${pinnedNode} AS build\nFROM build AS test`, lock)).toEqual([]);
  });

  test("from_without_digest_refused", () => {
    for (const image of [`docker.io/library/node:${NODE.tag}`, "node:26", "docker.io/library/node@sha256:abc"]) {
      expect(baseProblems(`FROM ${image}`, lock)).toEqual([`FROM ${image} is not pinned by digest`]);
    }
    expect(baseProblems("RUN true", lock)).toEqual(["the Dockerfile has no FROM"]);
  });

  test("from_host_not_allowlisted_refused", () => {
    for (const ref of ["quay.io/library/node", "docker.io/library/nodejs", "ghcr.io/someone-else/node"]) {
      const image = `${ref}:${NODE.tag}@${NODE.digest}`;
      expect(baseProblems(`FROM --platform=linux/amd64 ${image}`, lock)).toEqual([
        `FROM ${image} is not from an allowed host`,
      ]);
    }
  });

  test("lock_records_the_index_digest", () => {
    expect(Object.keys(lock)).toEqual(["node"]);
    // Exact keys only: toStrictEqual refuses any key the record does not name.
    expect(NODE).toStrictEqual({
      ref: "docker.io/library/node",
      tag: expect.stringMatching(/^26-alpine/),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      source: "upstream",
    });
  });

  test("runtime_base_is_alpine", () => {
    // Alex, 2026-10-07 00:09Z: the containers run on Alpine Linux. Every stage uses the one locked base.
    expect(NODE.tag.startsWith("26-alpine"), NODE.tag).toBe(true);
    for (const image of fromImages(dockerfile)) expect(image, image).toBe(pinnedNode);
  });

  test("dl3026_ignore_only_on_upstream_base", () => {
    const lines = dockerfile.split("\n").map((line) => line.trim());
    const ignores = lines.flatMap((line, at) => (/hadolint\b.*ignore/i.test(line) ? [at] : []));
    const upstream = Object.values(lock).filter((base) => base.source === "upstream");
    const upstreamFroms = fromImages(dockerfile).filter((image) =>
      upstream.some((base) => PINNED.exec(image)?.[1] === base.ref),
    );
    expect(ignores.length).toBe(upstreamFroms.length);
    for (const at of ignores) {
      // hadolint applies an inline ignore to the next line only (src/Hadolint/Pragma.hs, `line + 1`, v2.15.1), so the
      // FROM follows the ignore directly and the reason sits in the comment line above it.
      expect(lines[at]).toBe("# hadolint ignore=DL3026");
      expect(lines[at - 1]).toMatch(/^# .*2026-10-06-p127-upstream-base-by-digest.*removed by P1\.27s/);
      const from = lines[at + 1] ?? "";
      const ref = PINNED.exec(FROM.exec(from)?.[1] ?? "")?.[1];
      expect(
        upstream.map((base) => base.ref),
        from,
      ).toContain(ref);
    }
  });

  test("mirror_list_digest_only", () => {
    const list = JSON.parse(read("mirror.list.json")) as { source: string; mirror: string }[];
    expect(list.map((entry) => entry.source)).toContain(pinnedNode);
    for (const entry of list) {
      expect(entry.source, entry.source).toMatch(PINNED);
      expect(entry.mirror, entry.source).toMatch(/^ghcr\.io\/undefined6799\/mirror\/[a-z0-9._-]+$/);
    }
  });
});

/** The instructions of the last stage, the one that becomes the image, with continuation lines joined. */
const runtimeStage = (text: string): string[] =>
  (text.split(/^FROM .*$/m).at(-1) ?? "")
    .replaceAll(/\\\n\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

describe("runtime stage", () => {
  const runtime = runtimeStage(dockerfile);

  test("runtime_runs_as_65532", () => {
    expect(runtime.filter((line) => line.startsWith("USER "))).toEqual(["USER 65532:65532"]);
    // Nothing runs as root once the user is set: no RUN follows it.
    expect(runtime.slice(runtime.indexOf("USER 65532:65532")).filter((line) => line.startsWith("RUN "))).toEqual([]);
  });

  test("prod_image_has_ssr_build_only", () => {
    expect(dockerfile).toMatch(/^RUN npm run build -w @unset\/apps-web$/m);
    const web = runtime.filter((line) => line.includes("apps/web"));
    expect(web).toEqual([
      "COPY --from=build /app/apps/web/package.json apps/web/package.json",
      "COPY --from=build /app/apps/web/dist apps/web/dist",
    ]);
  });

  test("image_has_no_dev_deps", () => {
    expect(dockerfile).toMatch(/^RUN npm ci --ignore-scripts --omit=dev$/m);
    expect(runtime.filter((line) => line.startsWith("COPY ") && line.includes("node_modules"))).toEqual([
      "COPY --from=deps /app/node_modules node_modules",
    ]);
  });

  test("runtime_has_no_npm", () => {
    expect(runtime).toContain("RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx");
    expect(
      runtime.indexOf("RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx"),
    ).toBeLessThan(runtime.indexOf("USER 65532:65532"));
  });

  test("runtime_entry_is_the_web_server", () => {
    expect(runtime).toContain('ENTRYPOINT ["node", "interfaces/http/main.ts"]');
    expect(runtime.some((line) => line.startsWith("HEALTHCHECK ") && line.includes("/health"))).toBe(true);
  });
});
