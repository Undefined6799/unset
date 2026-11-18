// The indexer's health endpoint (book P3.05s PR 3): GET /health answers JSON with the process's counts, on its
// internal network only (no port is published). It carries counts, sequence numbers and pass names, never a DID,
// handle, record or error text (SE-7). A read that fails answers 503 with no body detail; a read that says the process
// is not healthy (its stream has been down too long) answers 503 with the counts, so the image's HEALTHCHECK fails.
//
// The read touches the database, and the endpoint answers anyone on the internal network, so its answer is shared for
// HEALTH_CACHE_MS: however often it is asked, it costs at most one read in that window and cannot starve the stream
// and the passes of pool clients.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out

export type HealthBody = { readonly healthy: boolean } & Readonly<Record<string, unknown>>;
export type HealthRead = () => Promise<HealthBody>;

/** How long one answer is shared. The image's HEALTHCHECK asks every 10 s, so 5 s keeps its answer current. */
export const HEALTH_CACHE_MS = 5000;

export function healthListener(read: HealthRead): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-length": "0" }).end();
      return;
    }
    read().then(
      (body) => {
        const json = JSON.stringify(body);
        response
          .writeHead(body.healthy ? 200 : 503, {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(json),
          })
          .end(json);
      },
      () => response.writeHead(503, { "content-length": "0" }).end(),
    );
  };
}

/** Shares one read, its failure included, for `ttlMs`; callers inside the window wait on the same promise. */
export function sharedRead(read: HealthRead, ttlMs: number, now: () => number = performance.now.bind(performance)) {
  let last: { readonly at: number; readonly answer: Promise<HealthBody> } | null = null;
  return (): Promise<HealthBody> => {
    if (last === null || now() - last.at >= ttlMs) last = { at: now(), answer: read() };
    return last.answer;
  };
}
