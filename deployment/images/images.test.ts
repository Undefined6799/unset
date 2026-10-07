// P1.27: the image's bases are pinned and the Dockerfile ships only what production runs (step book P1.27; architecture
// ruling 2026-10-06 23:15Z, book edit 2026-10-06-p127-upstream-base-by-digest). Every FROM, the build stages included,
// names its base by the multi-arch index digest recorded in deployment/images/bases.lock.json, from a host on a fixed
// allowlist: Docker's official library images, each named (interim, until P1.27s mirrors them and flips the host; book edit
// 2026-10-07-p128-edge-bases-and-ratelimit-adr widened it from Node alone for the edge's Caddy bases) and our GHCR
// namespace. The build itself (hadolint, Trivy, non-root, no dev dependencies, healthy) runs in the images workflow.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const DOCKERFILE = "images/node-app.Dockerfile";

/**
 * What an image is built FROM; the deploy contract (images.lock.json, verify-images) arrives with P1.27s. `stage` says
 * whether the base may become a shipped image (`runtime`) or only builds one (`build`); it is required (P1.28d, book
 * edit 2026-10-07-p128v-mirror-scan-stage), so the mirror scan can tell them apart (P1.28v).
 */
type Base = { ref: string; tag: string; digest: string; source: "upstream" | "mirror"; stage: Stage };
type Stage = "build" | "runtime";
type MirrorEntry = { source: string; mirror: string; stage: Stage };
type Lock = Record<string, Base>;

/** Where a base may come from: each official library image by name (interim; never a wildcard) and our GHCR namespace. */
const LIBRARY_IMAGES = new Set(["docker.io/library/node", "docker.io/library/caddy"]);
const OWN_NAMESPACE = /^ghcr\.io\/undefined6799\/[a-z0-9._/-]+$/;
const allowed = (ref: string): boolean => LIBRARY_IMAGES.has(ref) || OWN_NAMESPACE.test(ref);
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
    if (!allowed(ref)) return [`FROM ${image} is not from an allowed host`];
    const locked = Object.values(lock).find((base) => base.ref === ref);
    if (locked === undefined) return [`FROM ${image} has no lock entry`];
    return locked.digest === digest ? [] : [`FROM ${image} differs from the lock digest ${locked.digest}`];
  });
}

const STAGES: readonly unknown[] = ["build", "runtime"];

/** Every lock or mirror-list entry without a known stage, and every mirror entry whose stage differs from its lock's. */
function stageProblems(lock: Lock, list: MirrorEntry[]): string[] {
  const locked = Object.entries(lock).flatMap(([name, base]) =>
    STAGES.includes(base.stage) ? [] : [`lock entry ${name} has no stage`],
  );
  const listed = list.flatMap((entry) => {
    if (!STAGES.includes(entry.stage)) return [`mirror entry ${entry.source} has no stage`];
    const base = Object.values(lock).find((b) => entry.source === `${b.ref}:${b.tag}@${b.digest}`);
    return base === undefined || base.stage === entry.stage ? [] : [`mirror entry ${entry.source} differs in stage`];
  });
  return [...locked, ...listed];
}

/**
 * What the final stage is built FROM, following stage names back to their base: a `build` base may only feed earlier
 * stages, so the shipped image is a `runtime` base or `scratch`.
 */
function finalStageProblems(dockerfile: string, lock: Lock): string[] {
  const stageBase = new Map<string, string>();
  let last: string | undefined;
  for (const line of dockerfile.split("\n")) {
    const match = FROM.exec(line.trim());
    if (match === null) continue;
    const [, image = "", stage] = match;
    last = stageBase.get(image) ?? image;
    if (stage !== undefined) stageBase.set(stage, last);
  }
  if (last === undefined) return ["the Dockerfile has no FROM"];
  if (last === "scratch") return [];
  const ref = PINNED.exec(last)?.[1];
  const base = Object.values(lock).find((b) => b.ref === ref && last?.endsWith(`@${b.digest}`));
  if (base === undefined) return [`final FROM ${last} has no lock entry`];
  return base.stage === "runtime" ? [] : [`final FROM ${last} is a ${base.stage} base`];
}

/** Every Dockerfile under deployment/ (the web image's and, from P1.28, the edge's), so a new image is covered too. */
const dockerfiles = (readdirSync(DEPLOYMENT, { recursive: true }) as string[])
  .filter((file) => /(^|\/)([\w.-]+\.)?Dockerfile$/.test(file) && !file.includes("node_modules"))
  .sort();

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
    for (const ref of [
      "quay.io/library/node",
      "docker.io/someone/node",
      "docker.io/library/a/node",
      "docker.io/library/nginx",
      "ghcr.io/someone-else/node",
    ]) {
      const image = `${ref}:${NODE.tag}@${NODE.digest}`;
      expect(baseProblems(`FROM --platform=linux/amd64 ${image}`, lock)).toEqual([
        `FROM ${image} is not from an allowed host`,
      ]);
    }
  });

  test("lock_records_the_index_digest", () => {
    expect(Object.keys(lock)).toEqual(["node", "caddy-builder", "caddy"]);
    // Exact keys only: toStrictEqual refuses any key the record does not name.
    expect(NODE).toStrictEqual({
      ref: "docker.io/library/node",
      tag: expect.stringMatching(/^26(?:\.\d+){0,2}-[a-z]+-slim$/),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      source: "upstream",
      stage: "runtime",
    });
    // The edge's bases (P1.28): Caddy's builder and runtime images, both Alpine, both by index digest.
    // The builder only builds the edge binary; the runtime image is what ships.
    for (const [name, tag, stage] of [
      ["caddy-builder", /^2\.11\.7-builder-alpine$/, "build"],
      ["caddy", /^2\.11\.7-alpine$/, "runtime"],
    ] as const) {
      expect(lock[name], name).toStrictEqual({
        ref: "docker.io/library/caddy",
        tag: expect.stringMatching(tag),
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        source: "upstream",
        stage,
      });
    }
  });

  test("runtime_base_is_debian_slim", () => {
    // Alex, 2026-10-07 01:29:53Z, "Debian slim" (P1.27d): the web image runs on Debian trixie slim. Every stage uses the
    // one locked base.
    expect(NODE.ref).toBe("docker.io/library/node");
    expect(NODE.tag).toMatch(/^26(?:\.\d+){0,2}-[a-z]+-slim$/);
    for (const image of fromImages(dockerfile)) expect(image, image).toBe(pinnedNode);
  });

  test("runtime_stage_installs_no_os_packages", () => {
    // No stage installs OS packages, so no apt or apk line needs version pins (DL3008, DL3018) and the runtime holds
    // only what the base ships.
    for (const line of dockerfile.split("\n")) {
      expect(line, line).not.toMatch(/^\s*RUN\b.*\b(?:apt-get|apt|apk|dpkg)\b/);
    }
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
    const list = JSON.parse(read("mirror.list.json")) as MirrorEntry[];
    // Every upstream base in the lock is scanned weekly by the mirror workflow, and nothing else is listed.
    const upstream = Object.values(lock)
      .filter((base) => base.source === "upstream")
      .map((base) => `${base.ref}:${base.tag}@${base.digest}`);
    expect(list.map((entry) => entry.source)).toEqual(upstream);
    expect(upstream).toContain(pinnedNode);
    for (const entry of list) {
      expect(entry.source, entry.source).toMatch(PINNED);
      expect(entry.mirror, entry.source).toMatch(/^ghcr\.io\/undefined6799\/mirror\/[a-z0-9._-]+$/);
    }
  });

  test("every_lock_entry_has_stage", () => {
    const list = JSON.parse(read("mirror.list.json")) as MirrorEntry[];
    expect(stageProblems(lock, list)).toEqual([]);
    expect(list.map((entry) => entry.stage)).toEqual(Object.values(lock).map((base) => base.stage));
    const { stage: _, ...unlabelled } = NODE;
    const source = pinnedNode;
    expect(stageProblems({ node: unlabelled as Base }, [])).toEqual(["lock entry node has no stage"]);
    expect(stageProblems({ node: { ...NODE, stage: "test" as Stage } }, [])).toEqual(["lock entry node has no stage"]);
    expect(stageProblems(lock, [{ source, mirror: "m" } as MirrorEntry])).toEqual([
      `mirror entry ${source} has no stage`,
    ]);
    expect(stageProblems(lock, [{ source, mirror: "m", stage: "build" }])).toEqual([
      `mirror entry ${source} differs in stage`,
    ]);
  });

  test("build_stage_bases_never_in_final_stage", () => {
    expect(dockerfiles).toContain(DOCKERFILE);
    for (const file of dockerfiles) expect(finalStageProblems(read(file), lock), file).toEqual([]);
    const builder = lock["caddy-builder"] as Base;
    const runtime = lock.caddy as Base;
    const build = `${builder.ref}:${builder.tag}@${builder.digest}`;
    const ship = `${runtime.ref}:${runtime.tag}@${runtime.digest}`;
    // The edge's shape: the builder feeds a stage the runtime image copies from.
    expect(finalStageProblems(`FROM ${build} AS b\nFROM ${ship}\nCOPY --from=b /out /app`, lock)).toEqual([]);
    expect(finalStageProblems(`FROM ${ship} AS b\nFROM ${build}`, lock)).toEqual([
      `final FROM ${build} is a build base`,
    ]);
    expect(finalStageProblems(`FROM ${build} AS b\nFROM b AS c\nFROM c`, lock)).toEqual([
      `final FROM ${build} is a build base`,
    ]);
    expect(finalStageProblems(`FROM ${build} AS b\nFROM scratch`, lock)).toEqual([]);
    expect(finalStageProblems(`FROM ${ship.replace(runtime.digest, `sha256:${"1".repeat(64)}`)}`, lock)).toEqual([
      `final FROM ${ship.replace(runtime.digest, `sha256:${"1".repeat(64)}`)} has no lock entry`,
    ]);
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

  test("runtime_has_no_package_manager", () => {
    const removal = runtime.find((line) => line.startsWith("RUN rm -rf ")) ?? "";
    for (const path of [
      "/usr/local/lib/node_modules/npm",
      "/usr/local/lib/node_modules/corepack",
      "/opt/yarn-*",
      ...["npm", "npx", "corepack", "yarn", "yarnpkg", "pnpm", "pnpx"].map((tool) => `/usr/local/bin/${tool}`),
    ]) {
      expect(removal.split(" "), path).toContain(path);
    }
    expect(runtime.indexOf(removal)).toBeLessThan(runtime.indexOf("USER 65532:65532"));
    // The build and deps stages keep npm: they run npm ci.
    expect(
      dockerfile
        .split(/^FROM .*$/m)
        .slice(1, -1)
        .join(""),
    ).not.toContain("rm -rf");
  });

  test("runtime_entry_is_the_web_server", () => {
    expect(runtime).toContain('ENTRYPOINT ["node", "interfaces/http/main.ts"]');
    expect(runtime.some((line) => line.startsWith("HEALTHCHECK ") && line.includes("/health"))).toBe(true);
  });
});
