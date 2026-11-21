// The media process's door (book P2.19; ADR 0070 point 5): `GET|HEAD /o/<purpose>/<key>` for a signed draft link and
// `GET /health`; everything else is 404 and other methods 405. It reads no cookie and sets none, so the media origin
// carries no authority but the link. Every answer, errors included, carries the sandbox headers, so a crafted file
// opened in a tab cannot script; refusals all look alike. Each request is logged by route template and status only,
// never the purpose, key or query (SE-7), because a link is a bearer capability.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress inbound listener types only
import { type DraftUrlKeys, verifyDraftPath } from "@unset/domains-content";

export type MediaDeps = {
  readonly keys: DraftUrlKeys;
  /** The store's read, with its own 5 s timeout; `bytes` is null when no object has the key. */
  readonly get: (key: string) => Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false }>;
  readonly nowS: () => number;
  readonly logged: (route: string, status: number) => void;
};

type Answer =
  | { readonly status: 200; readonly bytes: Uint8Array; readonly type: string; readonly maxAgeS: number }
  | { readonly status: 404 | 405 | 503 };

const SANDBOX: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
};
/** The fixed type of each version's extension; the key pattern admits no other. */
const TYPES: Readonly<Record<string, string>> = { avif: "image/avif", webp: "image/webp", jpeg: "image/jpeg" };
/** Defence in depth: the pipeline never stores a larger version (ADR 0070 point 3; 5,000,000 bytes since ADR 0088). */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_AGE_S = 300;
const LINK_ROUTE = "/o/:purpose/*";

async function answer(deps: MediaDeps, method: string, target: string): Promise<Answer> {
  if (method !== "GET" && method !== "HEAD") return { status: 405 };
  const now = deps.nowS();
  const link = verifyDraftPath(deps.keys, target, now);
  if (!link.ok) return { status: 404 };
  const found = await deps.get(link.objectKey);
  if (!found.ok) return { status: 503 };
  if (found.bytes === null || found.bytes.byteLength > MAX_BYTES) return { status: 404 };
  const type = TYPES[link.objectKey.slice(link.objectKey.lastIndexOf(".") + 1)] ?? "";
  return { status: 200, bytes: found.bytes, type, maxAgeS: Math.min(link.exp - now, MAX_AGE_S) };
}

function send(response: ServerResponse, result: Answer, head: boolean): void {
  if (result.status !== 200) {
    const allow = result.status === 405 ? { allow: "GET, HEAD" } : {};
    response.writeHead(result.status, { ...SANDBOX, ...allow, "cache-control": "no-store", "content-length": "0" });
    response.end();
    return;
  }
  response.writeHead(200, {
    ...SANDBOX,
    "content-type": result.type,
    "content-length": String(result.bytes.byteLength),
    "content-disposition": "inline",
    "cache-control": `private, max-age=${result.maxAgeS}`,
  });
  response.end(head ? undefined : result.bytes);
}

export function mediaListener(deps: MediaDeps) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method ?? "";
    const target = request.url ?? "";
    if (method === "GET" && target === "/health") {
      response.writeHead(200, { ...SANDBOX, "cache-control": "no-store", "content-type": "application/json" });
      response.end('{"healthy":true}');
      deps.logged("/health", 200);
      return;
    }
    const route = target.startsWith("/o/") ? LINK_ROUTE : "/*";
    const done = (result: Answer) => {
      send(response, result, method === "HEAD");
      deps.logged(route, result.status);
    };
    answer(deps, method, target).then(done, () => done({ status: 503 }));
  };
}
