// tests/integration/deployment/edge/edge-container.ts (P1.27g, N6): a killed `docker run -d` still removes the
// container it may have created and closes the stub upstream. A stand-in docker answers the bridge lookup with
// loopback, hangs on `run`, and logs every call; no docker is needed, but it
// imports the module that builds the edge image, so it is an image test (P1.28r).
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { startEdge } from "./edge-container.ts";

const dir = mkdtempSync(join(tmpdir(), "edge-container-"));
const calls = join(dir, "calls.log");
writeFileSync(
  join(dir, "docker"),
  `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$1" in\n  network) echo 127.0.0.1 ;;\n  run) exec sleep 10 ;;\nesac\n`,
);
chmodSync(join(dir, "docker"), 0o755);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("startEdge", () => {
  test("killed_run_removes_the_container", { timeout: 5_000 }, async () => {
    const path = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${path}`;
    try {
      await expect(startEdge("unset-edge:test", 300)).rejects.toThrow("docker run killed after 300 ms");
    } finally {
      process.env.PATH = path;
    }
    const logged = readFileSync(calls, "utf8").split("\n");
    expect(logged.some((line) => /^rm -f unset-edge-\d+-\d+$/.test(line))).toBe(true);
  });
});
