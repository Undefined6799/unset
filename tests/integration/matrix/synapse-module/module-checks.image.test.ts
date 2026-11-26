// P6.10a: the Python carve-out's static rules (PLAN §5.6; book P6.10a "module-stdlib-only", "module-line-budget"),
// checked inside the pinned Synapse image so mypy sees the Synapse module API the module runs against. The checkers
// come from infrastructure/matrix/synapse-module/check-requirements.txt, hash-pinned, into a test image only; the
// checks themselves run with no network.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { docker, killBefore } from "../../../support/docker.ts";
import { buildTestImage, removeTestImage } from "../../../support/image-build.ts";
import { MODULE_DIR, SYNAPSE_IMAGE } from "../../../support/synapse.ts";

const BUILD_MS = 400_000;
const CHECK_MS = 120_000;
const dir = mkdtempSync(join(tmpdir(), "unset-synapse-module-"));
let image = "";

const DOCKERFILE = [
  `FROM ${SYNAPSE_IMAGE}`,
  "COPY check-requirements.txt /check/",
  "RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /check/check-requirements.txt",
  "COPY pyproject.toml /check/",
  "COPY unset_chat_policy /check/unset_chat_policy",
  "WORKDIR /check",
  "",
].join("\n");

/**
 * Prints each import that is neither the standard library (sys.stdlib_module_names, Python 3.10+) nor Synapse's
 * stable module API (`synapse.module_api`, docs/modules/writing_a_module.md at v1.162.0) nor the package itself, then
 * the folder's Python line count.
 */
const IMPORT_AUDIT = `
import ast, pathlib, sys
lines = 0
for path in sorted(pathlib.Path("unset_chat_policy").rglob("*.py")):
    text = path.read_text()
    lines += len(text.splitlines())
    for node in ast.walk(ast.parse(text)):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else []
        if isinstance(node, ast.ImportFrom):
            names = ["." if node.level else node.module or ""]
        for name in names:
            root = name.split(".")[0]
            ok = root in sys.stdlib_module_names or root == "unset_chat_policy"
            ok = ok or name == "synapse.module_api" or name.startswith("synapse.module_api.")
            if not ok:
                print(f"{path}: {name}")
print(f"lines {lines}")
`;

function check(command: readonly string[]): { code: number; output: string } {
  const ran = docker(
    ["run", "--rm", "--network", "none", "--entrypoint", command[0] ?? "", image, ...command.slice(1)],
    {
      timeoutMs: killBefore(CHECK_MS),
    },
  );
  return { code: ran.code, output: `${ran.out}${ran.err}`.trim() };
}

beforeAll(() => {
  writeFileSync(join(dir, "Dockerfile"), DOCKERFILE);
  image = buildTestImage(join(dir, "Dockerfile"), MODULE_DIR, { timeoutMs: killBefore(BUILD_MS) });
}, BUILD_MS);
afterAll(() => {
  if (image !== "") removeTestImage(image, { timeoutMs: killBefore(CHECK_MS) });
  rmSync(dir, { recursive: true, force: true });
}, CHECK_MS);

describe("the synapse module's carve-out rules", () => {
  test(
    "module_passes_mypy_strict",
    () => {
      expect(check(["mypy", "--strict", "unset_chat_policy"])).toEqual({
        code: 0,
        output: "Success: no issues found in 2 source files",
      });
    },
    CHECK_MS,
  );

  test(
    "module_passes_ruff_lint_and_format",
    () => {
      expect(check(["ruff", "check", "--no-cache", "."]).code).toBe(0);
      expect(check(["ruff", "format", "--no-cache", "--check", "."]).code).toBe(0);
    },
    CHECK_MS,
  );

  test(
    "module_imports_only_stdlib_and_the_module_api_within_400_lines",
    () => {
      const audit = check(["python", "-I", "-c", IMPORT_AUDIT]);
      expect(audit.code).toBe(0);
      const [count, ...offending] = audit.output.split("\n").reverse();
      expect(offending).toEqual([]);
      expect(Number(count?.replace("lines ", ""))).toBeLessThanOrEqual(400);
    },
    CHECK_MS,
  );
});
