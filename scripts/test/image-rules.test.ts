// P1.28r: only image tests build images, and no image test skips itself (step book 2026-10-07
// p123d-p128i-p128r-test-timing with its amendment 1; architecture 2026-10-07 test-timing-fuzz-and-image-tests,
// amendment 1). run.ts decides once whether the images project runs, so an image build in a unit project, or a
// conditional skip inside an image test, would undo that decision.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, test } from "vitest";
import { sourceFiles } from "../guards/files.ts";

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
const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The file that builds an image, `file` itself or a relative import it reaches; null when none does. */
function builder(file: string, sources: Map<string, string>, seen: Set<string>): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const text = sources.get(file);
  if (text === undefined) return null;
  if (BUILD.some((pattern) => pattern.test(text))) return file;
  for (const [, spec] of text.matchAll(RELATIVE_IMPORT)) {
    const found = builder(posix.normalize(posix.join(posix.dirname(file), spec ?? "")), sources, seen);
    if (found !== null) return found;
  }
  return null;
}

/** Every unit test that builds an image itself or through a helper it imports. */
function imageBuildProblems(sources: Map<string, string>): string[] {
  return [...sources.keys()]
    .filter((file) => TEST.test(file) && !IMAGE_TEST.test(file))
    .flatMap((file) => {
      const by = builder(file, sources, new Set());
      if (by === null) return [];
      if (by === file) return [`${file} builds an image, so it must be named *.image.test.ts`];
      return [`${file} imports ${by}, which builds an image, so it must be named *.image.test.ts`];
    })
    .sort();
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

describe("image tests", () => {
  test("image_builds_only_in_image_tests", () => {
    expect(imageBuildProblems(repository())).toEqual([]);
    const planted = new Map([
      ["a/spawn.test.ts", `spawnSync("docker", ${JSON.stringify(["buildx", BUILD_WORD, "."])});\n`],
      ["a/shell.test.ts", `run("${["docker", BUILD_WORD].join(" ")} -t x .");\n`],
      ["b/uses.test.ts", 'import { makeImage } from "./helper.ts";\n'],
      ["b/helper.ts", `export function makeImage() {\n  return ${DOCKER_BUILD}}\n`],
      ["b/wrapper.test.ts", `${WRAPPER}();\n`],
      ["c/edge.image.test.ts", `import { ${WRAPPER} } from "../b/helper.ts";\n${DOCKER_BUILD}`],
      ["d/run.test.ts", `${DOCKER_RUN}docker(${JSON.stringify(["buildx", "imagetools", "inspect"])});\n`],
    ]);
    expect(imageBuildProblems(planted)).toEqual([
      "a/shell.test.ts builds an image, so it must be named *.image.test.ts",
      "a/spawn.test.ts builds an image, so it must be named *.image.test.ts",
      "b/uses.test.ts imports b/helper.ts, which builds an image, so it must be named *.image.test.ts",
      "b/wrapper.test.ts builds an image, so it must be named *.image.test.ts",
    ]);
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
