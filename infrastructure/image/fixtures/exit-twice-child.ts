// A stand-in child for pool.test.ts that fails to start three times, then starts: it counts its own starts in a file
// under the system temporary folder, named by its parent's process id (the pool; prlimit execs node in its place).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const counter = join(tmpdir(), `pool-exit-twice-${process.ppid}`);
const starts = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;
writeFileSync(counter, String(starts));
if (starts <= 3) process.exit(1);
process.send?.({ ready: true });
process.on("message", () => undefined);
