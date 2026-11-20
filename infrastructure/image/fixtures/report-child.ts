// A stand-in child for pool.test.ts: it answers every job with what it can see of its own sandbox, so the test can
// check what the pool hands a real child: the number of environment variables, and how many of its open descriptors
// point at the parent's marker file.
import { readdirSync, readlinkSync } from "node:fs";

process.send?.({ ready: true });
process.on("message", (job: { id: number }) => {
  const links = readdirSync("/proc/self/fd").map((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      return "";
    }
  });
  const inherited = links.filter((link) => link.includes("pool-fd-marker")).length;
  process.send?.({
    id: job.id,
    // Plus one each, since the parent accepts only sizes of at least 1.
    result: { kind: "ok", width: Object.keys(process.env).length + 1, height: inherited + 1, versions: [] },
  });
});
