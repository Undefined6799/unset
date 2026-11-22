// The review process's one door (ADR 0070 point 2.2), beside the client that speaks to it (remote.ts): web posts a picture and its job, and gets the versions back.
// Only web can reach it (the `review_web` network), so there is no session or CSRF gate; what it guards against is
// the bytes, so each request is bounded before a byte is read: a declared length, a job inside JOB_CEILING, then a
// body read that stops at that length. GET /health answers for the image's HEALTHCHECK.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out
import type { ImageProcessor, ImageRefusal } from "@unset/domains-content";
import { encodeFrame, FRAME_TYPE, JOB_CEILING, type Job, PROCESS_PATH, parseJob } from "./wire.ts";

export type Outcome = "ok" | ImageRefusal | "bad_request";

/** Told each answer's outcome and, once a job has run, how long it took in whole milliseconds. */
export type Counted = (outcome: Outcome, ms?: number) => void;

export function reviewListener(processor: ImageProcessor, counted: Counted) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { healthy: true });
      return;
    }
    if (request.method !== "POST" || request.url !== PROCESS_PATH) {
      json(response, 404, {});
      return;
    }
    const job = parseJob(header(request, "x-unset-job"));
    const length = Number(header(request, "content-length"));
    if (job === null || !Number.isInteger(length) || length < 1) {
      refuse(response, counted, "bad_request");
      return;
    }
    if (length > Math.min(job.limits.maxBytes, JOB_CEILING.maxBytes)) {
      refuse(response, counted, "image.too_large");
      return;
    }
    readBody(request, length).then(
      async (bytes) => {
        try {
          await run(processor, bytes, job, response, counted);
        } catch {
          refuse(response, counted, "image.cannot_use");
        }
      },
      () => refuse(response, counted, "bad_request"),
    );
  };
}

async function run(processor: ImageProcessor, bytes: Uint8Array, job: Job, response: ServerResponse, counted: Counted) {
  const started = performance.now();
  const result = await processor.process(bytes, job.limits, job.versions);
  const ms = Math.round(performance.now() - started);
  if (result.kind === "refused") {
    refuse(response, counted, result.code, ms);
    return;
  }
  const frame = encodeFrame(result);
  counted("ok", ms);
  response.writeHead(200, { "content-type": FRAME_TYPE, "content-length": frame.length }).end(frame);
}

/** Exactly `length` bytes, or a rejection when the body is longer, shorter or broken off. */
function readBody(request: IncomingMessage, length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const body = Buffer.allocUnsafe(length);
    let received = 0;
    request.on("data", (chunk: Buffer) => {
      if (received + chunk.length > length) {
        request.destroy();
        reject(new RangeError("body longer than declared"));
        return;
      }
      chunk.copy(body, received);
      received += chunk.length;
    });
    request.on("end", () => (received === length ? resolve(body) : reject(new RangeError("body shorter"))));
    request.on("error", reject);
  });
}

function refuse(response: ServerResponse, counted: Counted, outcome: Exclude<Outcome, "ok">, ms?: number): void {
  counted(outcome, ms);
  if (outcome === "bad_request") {
    json(response, 400, {});
    return;
  }
  json(response, outcome === "image.busy" ? 503 : 422, { code: outcome });
}

function json(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent || response.destroyed) return;
  const text = JSON.stringify(body);
  response
    .writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
      connection: "close",
    })
    .end(text);
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
};
