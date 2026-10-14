import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hostWalk } from "./index.ts";

test("host_walk_reads_this_machine", () => {
  // hostWalk is the real file system the pin judges (verify-840 N1): lstat reports a link as itself and nothing as
  // null, readlink gives the target as written, statfs names procfs (linux/magic.h PROC_SUPER_MAGIC), uid is ours.
  const dir = mkdtempSync(join(tmpdir(), "host-pin-"));
  try {
    const file = join(dir, "file");
    const link = join(dir, "link");
    writeFileSync(file, "x");
    symlinkSync("file", link);
    expect(hostWalk.lstat(link)?.isSymbolicLink()).toBe(true);
    expect(hostWalk.lstat(file)?.isFile()).toBe(true);
    expect(hostWalk.lstat(join(dir, "missing"))).toBeNull();
    expect(hostWalk.readlink(link)).toBe("file");
    expect(hostWalk.statfs("/proc").type).toBe(0x9fa0);
    expect(hostWalk.statfs(dir).type).not.toBe(0x9fa0);
    expect(hostWalk.uid).toBe(process.getuid?.());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
