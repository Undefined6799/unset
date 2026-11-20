// The child process entry (ADR 0070 point 2.2): it says it is ready once sharp has loaded, then takes one job at a
// time: jobs arrive as frames on stdin and answers leave as frames on fd 3 (channel.ts). pool.ts starts it with an
// empty environment, no inherited descriptors besides those two pipes and an
// address-space limit, so a decoder exploit finds nothing here but the bytes it was sent and what its container
// holds; review's container holds no secret and no network (ADR 0070 point 2.2).

import { Socket } from "node:net"; // guard-allow: egress wraps the inherited answer pipe on fd 3, connects nowhere
import { serialize } from "node:v8";
import type { ProcessLimits, SourceFormat, VersionSpec } from "@unset/domains-content";
import { createFrameReader, frame } from "./channel.ts";
import { lockDownLoaders, runJob } from "./encode.ts";

export type JobMessage = {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly format: SourceFormat;
  readonly limits: ProcessLimits;
  readonly versions: readonly VersionSpec[];
};

/** The parent is trusted, so a job frame is bounded only loosely: a 64 MiB upload (JOB_CEILING) and its job fit inside. */
const JOB_FRAME_MAX = 72 * 1024 * 1024;
const answers = new Socket({ fd: 3, readable: false, writable: true });
const send = (value: unknown) => answers.write(frame(serialize(value)));

lockDownLoaders();
send({ ready: true });
const jobs = createFrameReader(
  () => JOB_FRAME_MAX,
  (value) => void answer(value as JobMessage),
  () => process.exit(1),
);
process.stdin.on("data", (chunk: Buffer) => jobs.push(chunk));

async function answer(job: JobMessage): Promise<void> {
  const result = await runJob(job.bytes, job.format, job.limits, job.versions).catch(() => ({
    kind: "refused" as const,
    code: "image.cannot_use" as const,
  }));
  send({ id: job.id, result });
}
