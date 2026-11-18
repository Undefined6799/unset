// The indexer's health endpoint (book P3.05s PR 3): GET /health answers JSON with the process's counts, on its
// internal network only (no port is published). It carries counts, sequence numbers and pass names, never a DID,
// handle, record or error text (SE-7). A read that fails answers 503 with no body detail.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out

export type HealthRead = () => Promise<Readonly<Record<string, unknown>>>;

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
          .writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(json) })
          .end(json);
      },
      () => response.writeHead(503, { "content-length": "0" }).end(),
    );
  };
}
