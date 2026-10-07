// P1.28r: only image tests build images, and no image test skips itself (step book 2026-10-07
// p123d-p128i-p128r-test-timing with its amendment 1; architecture 2026-10-07 test-timing-fuzz-and-image-tests,
// amendment 1). run.ts decides once whether the images project runs, so an image build in a unit project, or a
// conditional skip inside an image test, would undo that decision.
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult, type IDependency } from "dependency-cruiser";
import { afterAll, describe, expect, test } from "vitest";
import { sourceFiles } from "../guards/files.ts";
import { config, removeFixtures, tempDir, write } from "../lint/depcruise-fixture.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TEST = /\.test\.(?:ts|tsx|mts|cts)$/;
const IMAGE_TEST = /\.image\.test\.(?:ts|tsx|mts|cts)$/;
const SOURCE = /\.(?:ts|tsx|mts|cts)$/;
// Built from parts, so this file does not match its own patterns.
const BUILD_WORD = "build";
const WRAPPER = [BUILD_WORD, "EdgeImage"].join("");
/** An image build: a command line running docker with `build` or `buildx build`, a docker(...) or spawn("docker", ...)
 * call whose arguments start with build, or the edge image's build wrapper. `docker run`, `inspect`, `logs`, `rm`,
 * `compose config` and `buildx imagetools` are not builds. */
const BUILD = [
  new RegExp(["\\bdocker\\s+(?:buildx\\s+)?", "build\\b"].join("")),
  new RegExp(
    ["\\(\\s*(?:[\"']docker[\"']\\s*,\\s*)?\\[\\s*[\"'](?:buildx[\"']\\s*,\\s*[\"'])?", "build[\"']"].join(""),
  ),
  new RegExp(`\\b${WRAPPER}\\b`),
];
const SKIP = /\b(?:runIf|skipIf|todo)\b|\.skip\b/;
/** Each module dependency-cruiser reaches from `root`, with its imports resolved by the repository's own resolver
 * settings (scripts/lint/.dependency-cruiser.cjs): extensionless and `.js` imports, folder indexes and `@unset/*`
 * workspace packages all resolve to their source files (dependency-cruiser 18.5.0). */
async function importGraph(root: string): Promise<Map<string, IDependency[]>> {
  const { output } = await cruise(["."], { ...config.options, baseDir: root, validate: false });
  return new Map((output as ICruiseResult).modules.map((module) => [module.source, module.dependencies]));
}

/** The one unresolvable edge the boundary rules already allow (Alex, 2026-10-06 21:49Z): the web render loader's
 * import of apps/web's built server bundle, generated code. It is read from the boundary config, never copied, and
 * matches only that importer with that specifier (architecture amendment 3, 2026-10-07). */
const ALLOWED_UNRESOLVED = config.RENDER_BUILD_IMPORT;
const isAllowedUnresolved = (file: string, dependency: IDependency): boolean =>
  file === ALLOWED_UNRESOLVED.from && dependency.module === ALLOWED_UNRESOLVED.module;
/** An import that must resolve: a relative path or a workspace package. A bare third-party package is not followed. */
const ours = (dependency: IDependency): boolean =>
  dependency.module.startsWith(".") || dependency.module.startsWith("@unset/");
const followed = (dependency: IDependency): boolean =>
  !dependency.couldNotResolve && !dependency.coreModule && !dependency.resolved.split("/").includes("node_modules");

type Walk = { graph: Map<string, IDependency[]>; allowed: Set<string> };

/** Why an unresolved import of ours fails the guard; the one allowed edge is recorded instead. */
function unresolvedProblem(walk: Walk, file: string, dependency: IDependency): string | null {
  if (!dependency.couldNotResolve) return null;
  if (isAllowedUnresolved(file, dependency)) {
    walk.allowed.add(`${file} -> ${dependency.module}`);
    return null;
  }
  return ours(dependency) ? `${file} imports ${dependency.module}, which does not resolve` : null;
}

/** Why `test` breaks the rule: it, or a module it reaches, builds an image, or an import on the way does not resolve.
 * The allowed unresolved edge is recorded, not followed. */
function buildProblem(root: string, walk: Walk, test: string): string | null {
  const seen = new Set<string>();
  const pending = [test];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const problem = moduleProblem(root, walk, test, file);
    if (problem !== null) return problem;
    pending.push(...(walk.graph.get(file) ?? []).filter(followed).map((dependency) => dependency.resolved));
  }
  return null;
}

/** Why `file`, reached from `test`, breaks the rule on its own: it builds an image, or one of its imports does not
 * resolve. */
function moduleProblem(root: string, walk: Walk, test: string, file: string): string | null {
  if (BUILD.some((pattern) => pattern.test(readFileSync(join(root, file), "utf8")))) {
    const by = file === test ? "builds an image" : `imports ${file}, which builds an image`;
    return `${test} ${by}, so it must be named *.image.test.ts`;
  }
  for (const dependency of walk.graph.get(file) ?? []) {
    const unresolved = unresolvedProblem(walk, file, dependency);
    if (unresolved !== null) return `${test}: ${unresolved}`;
  }
  return null;
}

/** Every unit test that builds an image itself or through a module it reaches, and the allowed unresolved edges the
 * walk met. */
async function imageBuildProblems(root: string): Promise<{ problems: string[]; allowed: string[] }> {
  const walk: Walk = { graph: await importGraph(root), allowed: new Set() };
  const problems = [...walk.graph.keys()]
    .filter((file) => TEST.test(file) && !IMAGE_TEST.test(file))
    .flatMap((file) => buildProblem(root, walk, file) ?? [])
    .sort();
  return { problems, allowed: [...walk.allowed] };
}

/** Every image test that can skip itself. */
function conditionalSkipProblems(sources: Map<string, string>): string[] {
  return [...sources]
    .filter(([file]) => IMAGE_TEST.test(file))
    .flatMap(([file, text]) => {
      const found = SKIP.exec(text);
      return found === null ? [] : [`${file}: ${found[0]}`];
    })
    .sort();
}

const repository = (): Map<string, string> =>
  new Map(
    sourceFiles(ROOT, ["."])
      .filter((file) => SOURCE.test(file))
      .map((file) => [file, readFileSync(join(ROOT, file), "utf8")]),
  );

const DOCKER_BUILD = `docker(${JSON.stringify([BUILD_WORD, "-q", "."])});\n`;
const DOCKER_RUN = `docker(${JSON.stringify(["run", "--rm", "x"])});\n`;

const MAKE = `export function make() {\n  return ${DOCKER_BUILD}}\n`;
const using = (spec: string) => `import { make } from "${spec}";\nmake();\n`;
const named = (file: string, by: string) => `${file} ${by}, so it must be named *.image.test.ts`;
const RENDER_EDGE = `${ALLOWED_UNRESOLVED.from} -> ${ALLOWED_UNRESOLVED.module}`;

/** A fixture tree with a package.json and one workspace package, @unset/shared-pkg, whose index builds an image. */
function tree(files: Record<string, string>): string {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true, type: "module" }));
  write(root, "shared/pkg/package.json", JSON.stringify({ name: "@unset/shared-pkg", exports: { ".": "./index.ts" } }));
  write(root, "shared/pkg/index.ts", MAKE);
  write(root, "node_modules/@unset/.keep", "");
  symlinkSync("../../shared/pkg", join(root, "node_modules/@unset/shared-pkg"), "dir");
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  return root;
}

afterAll(removeFixtures);

describe("image tests", () => {
  test("image_builds_only_in_image_tests", async () => {
    const repository = await imageBuildProblems(ROOT);
    // The allowed edge is printed once, from the repository walk only, so it is visible in the check log.
    for (const edge of repository.allowed) console.log(`unresolved, allowed: ${edge}`);
    expect(repository).toEqual({ problems: [], allowed: [RENDER_EDGE] });
    const root = tree({
      "a/spawn.test.ts": `spawnSync("docker", ${JSON.stringify(["buildx", BUILD_WORD, "."])});\n`,
      "a/shell.test.ts": `run("${["docker", BUILD_WORD].join(" ")} -t x .");\n`,
      "a/wrapper.test.ts": `${WRAPPER}();\n`,
      "b/helper.ts": MAKE,
      "b/lib/index.ts": MAKE,
      "b/explicit.test.ts": using("./helper.ts"),
      "b/extensionless.test.ts": using("./helper"),
      "b/js.test.ts": using("./helper.js"),
      "b/index.test.ts": using("./lib"),
      "b/workspace.test.ts": using("@unset/shared-pkg"),
      "c/edge.image.test.ts": `${using("../b/helper.ts")}${DOCKER_BUILD}`,
      "d/run.test.ts": `${DOCKER_RUN}docker(${JSON.stringify(["buildx", "imagetools", "inspect"])});\n`,
      "d/third-party.test.ts": 'import { test } from "vitest";\ntest("x", () => {});\n',
    });
    expect((await imageBuildProblems(root)).problems).toEqual([
      named("a/shell.test.ts", "builds an image"),
      named("a/spawn.test.ts", "builds an image"),
      named("a/wrapper.test.ts", "builds an image"),
      named("b/explicit.test.ts", "imports b/helper.ts, which builds an image"),
      named("b/extensionless.test.ts", "imports b/helper.ts, which builds an image"),
      named("b/index.test.ts", "imports b/lib/index.ts, which builds an image"),
      named("b/js.test.ts", "imports b/helper.ts, which builds an image"),
      named("b/workspace.test.ts", "imports shared/pkg/index.ts, which builds an image"),
    ]);
  });

  test("unresolved_import_fails", async () => {
    const root = tree({ "b/missing.test.ts": using("./gone.ts"), "b/missing-workspace.test.ts": using("@unset/gone") });
    expect((await imageBuildProblems(root)).problems).toEqual([
      "b/missing-workspace.test.ts: b/missing-workspace.test.ts imports @unset/gone, which does not resolve",
      "b/missing.test.ts: b/missing.test.ts imports ./gone.ts, which does not resolve",
    ]);
  });

  test("render_build_specifier_from_other_importer_fails", async () => {
    const other = "interfaces/http/web/other.ts";
    const root = tree({
      [ALLOWED_UNRESOLVED.from]: using(ALLOWED_UNRESOLVED.module),
      [other]: using(ALLOWED_UNRESOLVED.module),
      "interfaces/http/web/entry.test.ts": using("./render-entry.ts"),
      "interfaces/http/web/other.test.ts": using("./other.ts"),
    });
    expect(await imageBuildProblems(root)).toEqual({
      problems: [
        `interfaces/http/web/other.test.ts: ${other} imports ${ALLOWED_UNRESOLVED.module}, which does not resolve`,
      ],
      allowed: [RENDER_EDGE],
    });
  });

  test("other_unresolved_specifier_from_render_entry_fails", async () => {
    const root = tree({
      [ALLOWED_UNRESOLVED.from]: using("@unset/apps-web/client"),
      "interfaces/http/web/entry.test.ts": using("./render-entry.ts"),
    });
    expect(await imageBuildProblems(root)).toEqual({
      problems: [
        `interfaces/http/web/entry.test.ts: ${ALLOWED_UNRESOLVED.from} imports @unset/apps-web/client, which does not resolve`,
      ],
      allowed: [],
    });
  });

  test("render_build_import_exemption_matches_boundary_config", () => {
    // The guard reads the boundary config's own pair; the boundary rule that allows the edge uses the same pair.
    expect(ALLOWED_UNRESOLVED).toEqual({
      from: "interfaces/http/web/render-entry.ts",
      module: "@unset/apps-web/server",
    });
    type Target = { path: string; couldNotResolve?: boolean };
    const row = config.MATRIX.find((r) => r.name === "interface-http-render-build");
    const to = row?.to as Target[] | undefined;
    expect(to).toHaveLength(1);
    expect(new RegExp((row?.from as Target | undefined)?.path ?? "$^").test(ALLOWED_UNRESOLVED.from)).toBe(true);
    expect(new RegExp(to?.[0]?.path ?? "$^").test(ALLOWED_UNRESOLVED.module)).toBe(true);
    expect(to?.[0]?.couldNotResolve).toBe(true);
  });

  test("image_tests_have_no_conditional_skip", () => {
    expect(conditionalSkipProblems(repository())).toEqual([]);
    const planted = new Map([
      ["a.image.test.ts", 'test.runIf(process.env.CI)("x", () => {});\n'],
      ["b.image.test.ts", 'test.skipIf(!process.env.CI)("x", () => {});\n'],
      ["c.image.test.ts", 'test.skip("x", () => {});\n'],
      ["d.image.test.ts", 'test.todo("x");\n'],
      ["e.image.test.ts", 'describe.skip("x", () => {});\n'],
      ["f.image.test.ts", 'test("x", () => {});\n'],
      ["g.test.ts", 'test.runIf(process.env.CI)("x", () => {});\n'],
    ]);
    expect(conditionalSkipProblems(planted)).toEqual([
      "a.image.test.ts: runIf",
      "b.image.test.ts: skipIf",
      "c.image.test.ts: .skip",
      "d.image.test.ts: todo",
      "e.image.test.ts: .skip",
    ]);
  });
});
