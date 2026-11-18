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
/**
 * Modules that build an image only through a process runner handed to them (P1.39c; ADR 0046 decision 4): the
 * preflight's C18 builds the edge under local and dev --source through `Inputs.run`. A unit test may reach one, since
 * it hands it a double and nothing is built. The exemption holds only while the module cannot start a process itself
 * (startsNoProcess): neither it nor anything it imports, at any depth, names child_process in any form. The
 * preflight's real runner is private to its CLI entry.
 */
const INJECTED_BUILDS: readonly string[] = ["deployment/preflight/checks/edge-adapt.ts"];
/** The module's name anywhere in a file's text: a static, dynamic or template-literal import, a require, a comment. */
const OWN_PROCESS = /child_process/;
const SKIP = /\b(?:runIf|skipIf|todo)\b|\.skip\b/;
/** Each module dependency-cruiser reaches from `root`, with its imports resolved by the repository's own resolver
 * settings (scripts/lint/.dependency-cruiser.cjs): extensionless and `.js` imports, folder indexes and `@unset/*`
 * workspace packages all resolve to their source files (dependency-cruiser 18.5.0). */
async function importGraph(root: string): Promise<Map<string, IDependency[]>> {
  const { output } = await cruise(["."], { ...config.options, baseDir: root, validate: false });
  return new Map((output as ICruiseResult).modules.map((module) => [module.source, module.dependencies]));
}

/** An import that must resolve: a relative path or a workspace package. A bare third-party package is not followed. */
const ours = (dependency: IDependency): boolean =>
  dependency.module.startsWith(".") || dependency.module.startsWith("@unset/");
const followed = (dependency: IDependency): boolean =>
  !dependency.couldNotResolve && !dependency.coreModule && !dependency.resolved.split("/").includes("node_modules");

type Walk = { graph: Map<string, IDependency[]>; injected: readonly string[] };

/** Why an unresolved import of ours fails the guard. Since P1.20k deleted the React render build, no unresolved edge
 * of ours is allowed. */
function unresolvedProblem(file: string, dependency: IDependency): string | null {
  if (!dependency.couldNotResolve) return null;
  return ours(dependency) ? `${file} imports ${dependency.module}, which does not resolve` : null;
}

/** Why `test` breaks the rule: it, or a module it reaches, builds an image, or an import on the way does not resolve. */
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

/**
 * Whether `file` and every module it reaches cannot start a process: none names child_process, as an import
 * dependency-cruiser sees or anywhere in its text, and every import of ours on the way resolves, so nothing is left
 * unread. A third-party package is not followed, as elsewhere in this walk; the listed module imports none.
 */
function startsNoProcess(root: string, walk: Walk, file: string): boolean {
  const seen = new Set<string>();
  const pending = [file];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const dependencies = walk.graph.get(next) ?? [];
    if (OWN_PROCESS.test(readFileSync(join(root, next), "utf8"))) return false;
    if (dependencies.some((dependency) => OWN_PROCESS.test(dependency.module))) return false;
    if (dependencies.some((dependency) => dependency.couldNotResolve && ours(dependency))) return false;
    pending.push(...dependencies.filter(followed).map((dependency) => dependency.resolved));
  }
  return true;
}

/** Why `file`, reached from `test`, breaks the rule on its own: it builds an image, or one of its imports does not
 * resolve. */
function moduleProblem(root: string, walk: Walk, test: string, file: string): string | null {
  const text = readFileSync(join(root, file), "utf8");
  const injected = walk.injected.includes(file) && startsNoProcess(root, walk, file);
  if (!injected && BUILD.some((pattern) => pattern.test(text))) {
    const by = file === test ? "builds an image" : `imports ${file}, which builds an image`;
    return `${test} ${by}, so it must be named *.image.test.ts`;
  }
  for (const dependency of walk.graph.get(file) ?? []) {
    const unresolved = unresolvedProblem(file, dependency);
    if (unresolved !== null) return `${test}: ${unresolved}`;
  }
  return null;
}

/** Every unit test that builds an image itself or through a module it reaches. */
async function imageBuildProblems(
  root: string,
  injected: readonly string[] = INJECTED_BUILDS,
): Promise<{ problems: string[] }> {
  const walk: Walk = { graph: await importGraph(root), injected };
  const problems = [...walk.graph.keys()]
    .filter((file) => TEST.test(file) && !IMAGE_TEST.test(file))
    .flatMap((file) => buildProblem(root, walk, file) ?? [])
    .sort();
  return { problems };
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
    expect((await imageBuildProblems(ROOT)).problems).toEqual([]);
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

  test("injected_build_is_exempt_only_when_nothing_it_reaches_can_spawn", async () => {
    // P1.39c: a module that builds through a runner it is handed is exempt only when listed, and only while neither
    // it nor anything it imports, at any depth, names child_process: statically, dynamically, by a template literal,
    // or through an import that does not resolve.
    const handed = `export const make = (run) => run("docker", ${JSON.stringify([BUILD_WORD, "-q", "."])});\n`;
    const name = ["child", "process"].join("_");
    const viaHelper = (helper: string) => `import "./${helper}";\n${handed}`;
    const cases: Record<string, Record<string, string>> = {
      handed: { "handed.ts": handed },
      unlisted: { "unlisted.ts": handed },
      static: { "static.ts": `import { execFile } from "node:${name}";\n${handed}` },
      dynamic: { "dynamic.ts": `const start = () => import("node:${name}");\n${handed}` },
      template: { "template.ts": `const start = () => import(\`node:${name}\`);\n${handed}` },
      required: { "required.ts": `const start = () => require("${name}");\n${handed}` },
      deep: {
        "deep.ts": viaHelper("deep-a.ts"),
        "deep-a.ts": 'import "./deep-b.ts";\n',
        "deep-b.ts": `export const start = () => import("node:${name}");\n`,
      },
      missing: { "missing.ts": viaHelper("gone.ts") },
      clean: { "clean.ts": viaHelper("clean-a.ts"), "clean-a.ts": "export const one = 1;\n" },
    };
    const files: Record<string, string> = {};
    for (const [each, sources] of Object.entries(cases)) {
      for (const [file, text] of Object.entries(sources)) files[`e/${file}`] = text;
      files[`e/${each}.test.ts`] = using(`./${each}.ts`);
    }
    const listed = Object.keys(cases)
      .filter((each) => each !== "unlisted")
      .map((each) => `e/${each}.ts`);
    const { problems } = await imageBuildProblems(tree(files), listed);
    const refused = ["deep", "dynamic", "missing", "required", "static", "template", "unlisted"];
    expect(problems.filter((problem) => problem.includes("builds an image"))).toEqual(
      refused.map((each) => named(`e/${each}.test.ts`, `imports e/${each}.ts, which builds an image`)),
    );
    // The list is one file.
    expect(INJECTED_BUILDS).toEqual(["deployment/preflight/checks/edge-adapt.ts"]);
  });

  test("unresolved_import_fails", async () => {
    const root = tree({ "b/missing.test.ts": using("./gone.ts"), "b/missing-workspace.test.ts": using("@unset/gone") });
    expect((await imageBuildProblems(root)).problems).toEqual([
      "b/missing-workspace.test.ts: b/missing-workspace.test.ts imports @unset/gone, which does not resolve",
      "b/missing.test.ts: b/missing.test.ts imports ./gone.ts, which does not resolve",
    ]);
  });

  test("former_render_build_import_fails_like_any_other", async () => {
    // P1.20k: the React render build and its one allowed unresolved edge are gone, so its old importer is refused too.
    const root = tree({
      "interfaces/http/web/render-entry.ts": using("@unset/apps-web/server"),
      "interfaces/http/web/entry.test.ts": using("./render-entry.ts"),
    });
    expect(await imageBuildProblems(root)).toEqual({
      problems: [
        "interfaces/http/web/entry.test.ts: interfaces/http/web/render-entry.ts imports @unset/apps-web/server, which does not resolve",
      ],
    });
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
