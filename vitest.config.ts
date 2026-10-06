// Vitest is the only test runner (decision 16). scripts/test/run.ts checks that
// every test file in the repository was selected and actually ran.
import { defineConfig } from "vitest/config";
import { SKIP_DIRS } from "./scripts/guards/files.ts";

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

// The integration project's one Postgres (P1.11t): started once per run, only when that project runs.
const GLOBAL_SETUP: Record<string, { globalSetup: string }> = {
  "tests/integration": { globalSetup: "tests/integration/setup/pg.setup.ts" },
};

export default defineConfig({
  test: {
    exclude,
    passWithNoTests: false,
    allowOnly: false,
    retry: 0,
    projects: PROJECTS.map((name) => ({
      extends: true,
      test: { name, include: [`${name}/**/*.test.{ts,tsx,mts,cts}`], ...(GLOBAL_SETUP[name] ?? {}) },
    })),
  },
});
