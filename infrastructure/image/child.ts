// The child process entry (ADR 0070 point 2.2): one job at a time over IPC, then the next. It is started by pool.ts
// with an empty environment, no inherited descriptors besides IPC and an address-space limit, so a decoder exploit
// finds nothing here but the bytes it was sent.
import type { ProcessLimits, SourceFormat, VersionSpec } from "@unset/domains-content";
import { lockDownLoaders, runJob } from "./encode.ts";

export type JobMessage = {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly format: SourceFormat;
  readonly limits: ProcessLimits;
  readonly versions: readonly VersionSpec[];
};

lockDownLoaders();
process.on("message", async (job: JobMessage) => {
  const result = await runJob(job.bytes, job.format, job.limits, job.versions).catch(() => ({
    kind: "refused" as const,
    code: "image.cannot_use" as const,
  }));
  process.send?.({ id: job.id, result });
});
