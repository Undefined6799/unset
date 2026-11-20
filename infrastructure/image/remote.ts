// Web's side of the processing stage (ADR 0070 point 2.2): an ImageProcessor that sends the bytes to the review
// process and checks what comes back (wire.ts). It takes the transport from its composition root, which sends through
// net-guard's `review` policy, so this file opens no connection itself and imports nothing that decodes a picture.
import type { ImageProcessor, ProcessLimits, ProcessResult, VersionSpec } from "@unset/domains-content";
import { decodeFrame, encodeJob, FRAME_TYPE, JOB_HEADER, parseRefusal } from "./wire.ts";

export type ReviewAnswer = { readonly status: number; readonly contentType: string; readonly body: Uint8Array };
/** POSTs the body to review's process path with these headers; rejects on any transport failure or deadline. */
export type ReviewTransport = (body: Uint8Array, headers: Record<string, string>) => Promise<ReviewAnswer>;

export function createRemoteImageProcessor(send: ReviewTransport): ImageProcessor {
  return {
    async process(bytes: Uint8Array, limits: ProcessLimits, versions: readonly VersionSpec[]): Promise<ProcessResult> {
      if (bytes.length > limits.maxBytes) return { kind: "refused", code: "image.too_large" };
      const job = { limits, versions };
      let answer: ReviewAnswer;
      try {
        answer = await send(bytes, { "content-type": "application/octet-stream", [JOB_HEADER]: encodeJob(job) });
      } catch {
        // Down, unreachable or past the deadline: the member can try again, and nothing was stored.
        return { kind: "refused", code: "image.busy" };
      }
      if (answer.status === 200 && answer.contentType === FRAME_TYPE) {
        return decodeFrame(answer.body, job) ?? { kind: "refused", code: "image.cannot_use" };
      }
      if (answer.status === 422 || answer.status === 503) {
        return { kind: "refused", code: parseRefusal(Buffer.from(answer.body).toString("utf8")) };
      }
      return { kind: "refused", code: "image.cannot_use" };
    },
  };
}
