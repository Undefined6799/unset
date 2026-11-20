// A stand-in child for pool.test.ts that says it is ready, then answers a job with the start of a frame declaring a
// gigabyte and never sends the rest, as an exploited decoder might to make the parent buffer without bound.
import { writeSync } from "node:fs";
import { serialize } from "node:v8";
import { frame } from "../channel.ts";

setInterval(() => undefined, 60_000);
writeSync(3, frame(serialize({ ready: true })));
process.stdin.once("data", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(1_000_000_000);
  writeSync(3, header);
  writeSync(3, Buffer.alloc(1024));
});
