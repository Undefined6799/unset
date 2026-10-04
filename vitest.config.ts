// Vitest is the only test runner (decision 16). scripts/test/run.ts checks that
// every test file in the repository was selected and actually ran.
import { defineConfig } from "vitest/config";
import { SKIP_DIRS } from "./scripts/guards/files.ts";

// A bare name is skipped at any depth; a path is skipped from the repo root.
const exclude = [...SKIP_DIRS].map((dir) => (dir.includes("/") ? `${dir}/**` : `**/${dir}/**`));

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx,mts,cts}"],
    exclude,
    passWithNoTests: false,
    allowOnly: false,
    retry: 0,
  },
});
