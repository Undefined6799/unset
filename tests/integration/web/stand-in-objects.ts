// The draft store web's sweeps ask (P2.19b, image-orphans.ts): an empty bucket on a loopback port, for every built
// server this folder starts, so a healthy stack's sweeps log no error. It answers a ListObjectsV2 with no keys and any
// other request with 404; the store is an unmanaged dependency here (rule TE-1), and
// tests/integration/storage/object-store.test.ts covers the real one.
import { createServer } from "node:http"; // guard-allow: egress serves loopback answers to the test server only

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><Name>unset-private</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>`;

export type StandInObjects = { readonly url: string; readonly close: () => Promise<void> };

export async function startStandInObjects(): Promise<StandInObjects> {
  const server = createServer((request, response) => {
    const listing = request.method === "GET" && new URL(request.url ?? "/", "http://x").searchParams.has("list-type");
    response.writeHead(listing ? 200 : 404, { "content-type": "application/xml" });
    response.end(listing ? EMPTY : "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
