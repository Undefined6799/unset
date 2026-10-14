import { expect, test } from "vitest";
import * as hostPin from "./index.ts";

test("exports_only_what_its_callers_import", () => {
  // P1.33h is a move: the stack wrapper, C9 and C26 (deployment/preflight) and, from P1.33j, the token reader import
  // these, and nothing else is exported (book edit 2026-10-13-host-pin-steps, Amendment 2). The walk and socket tests
  // themselves stay in deployment/preflight, unchanged apart from their imports.
  expect(Object.keys(hostPin).sort()).toEqual([
    "DEFAULT_DOCKER_HOST",
    "FILESYSTEM_NAMES",
    "UsageError",
    "WALK_REASONS",
    "foreignFilesystem",
    "hostWalk",
    "localDockerHost",
    "resolveChecked",
    "within",
  ]);
});
