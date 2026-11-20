// The child side of channel.ts for the stand-in children of pool.test.ts: `say` writes one frame on fd 3, `onJob`
// hands over each job frame read from stdin.
import { Socket } from "node:net"; // guard-allow: egress wraps the inherited answer pipe on fd 3, connects nowhere
import { serialize } from "node:v8";
import { createFrameReader, frame } from "../channel.ts";

const out = new Socket({ fd: 3, readable: false, writable: true });
export const say = (value: unknown): void => void out.write(frame(serialize(value)));

export function onJob(handle: (job: { id: number }) => void): void {
  const reader = createFrameReader(
    () => 64 * 1024 * 1024,
    (value) => handle(value as { id: number }),
    () => process.exit(1),
  );
  process.stdin.on("data", (chunk: Buffer) => reader.push(chunk));
}
