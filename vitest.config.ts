// Vitest is the only test runner (decision 16). scripts/test/run.ts checks that
// every test file in the repository was selected and actually ran.
import { defineConfig } from "vitest/config";
import { SKIP_DIRS } from "./scripts/guards/files.ts";
import { scopedName } from "./scripts/ui/css-scope.ts";

// A bare name is skipped at any depth; a path is skipped from the repo root.
const exclude = [...SKIP_DIRS].map((dir) => (dir.includes("/") ? `${dir}/**` : `**/${dir}/**`));

// One project per decision-34 code folder (P1.01); integration and end-to-end tests are projects of
// their own (guideline §5). A folder that does not exist yet selects no files, which is not an error.
const PROJECTS = [
  "apps",
  "interfaces",
  "domains",
  "infrastructure",
  "shared",
  "deployment",
  "scripts",
  "tests/integration",
  "tests/e2e",
];

// Image tests build or run container images; they form their own project, which scripts/test/run.ts starts after
// the unit projects in CI and leaves out locally (P1.28r). No other project selects them.
const IMAGE_TESTS = "**/*.image.test.{ts,tsx,mts,cts}";

// The integration project's one Postgres (P1.11t): started once per run, only when that project runs.
const GLOBAL_SETUP: Record<string, { globalSetup: string }> = {
  "tests/integration": { globalSetup: "tests/integration/setup/pg.setup.ts" },
};

// CSS Modules (P1.23v): tests render the same class names as both production builds. Vitest replaces
// css.modules.generateScopedName with its own unless classNameStrategy is "scoped", and turns a .module.css import
// into a proxy unless test.css includes it (vitest 5.0.2, dist/chunks/index.C-uw7tH9.js:7946-7952 and 8040).
export default defineConfig({
  css: { modules: { generateScopedName: scopedName } },
  test: {
    css: { include: [/\.module\.css$/], modules: { classNameStrategy: "scoped" } },
    exclude,
    passWithNoTests: false,
    allowOnly: false,
    retry: 0,
    projects: [
      ...PROJECTS.map((name) => ({
        extends: true,
        test: {
          name,
          include: [`${name}/**/*.test.{ts,tsx,mts,cts}`],
          exclude: [...exclude, IMAGE_TESTS],
          ...(GLOBAL_SETUP[name] ?? {}),
        },
      })),
      { extends: true, test: { name: "images", include: [IMAGE_TESTS], exclude } },
    ],
  },
});
