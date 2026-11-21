// P2.19b: a picture's main version sent to the member's PDS (com.atproto.repo.uploadBlob), over pdsCall. The XRPC
// client is the real @atproto/api Agent over a fake fetchHandler, as in card-records.test.ts.
import type { Did } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { uploadImageBlob } from "./blob-upload.ts";
import { createPdsCall } from "./pds-call.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

type Call = { path: string; method: string; type: string | null; bytes: Uint8Array };
function pds(answer: () => Response) {
  const calls: Call[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string, init: RequestInit) {
          const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
          const type = new Headers(init.headers).get("content-type");
          calls.push({
            path: new URL(url, "https://pds.example").pathname,
            method: (init.method ?? "GET").toUpperCase(),
            type,
            bytes,
          });
          return answer();
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: performance.now() + 60_000 };
  return { pdsCall, ctx, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("uploadImageBlob", () => {
  test("blob.upload: posts the WebP bytes and answers the blob ref in its JSON form (ADR 0088)", async () => {
    const blob = { $type: "blob", ref: { $link: CID }, mimeType: "image/webp", size: BYTES.length };
    const { pdsCall, ctx, calls } = pds(() => json({ blob }));
    expect(await uploadImageBlob(pdsCall, ctx, DID, BYTES)).toEqual({ kind: "ok", value: blob });
    expect(calls).toEqual([
      { path: "/xrpc/com.atproto.repo.uploadBlob", method: "POST", type: "image/webp", bytes: BYTES },
    ]);
  });

  test.each([
    ["another type", { mimeType: "image/jpeg", size: BYTES.length }],
    ["another size", { mimeType: "image/webp", size: BYTES.length + 1 }],
  ])("blob.upload_mismatch: a PDS that answers %s is unavailable, never written", async (_name, answered) => {
    const { pdsCall, ctx } = pds(() => json({ blob: { $type: "blob", ref: { $link: CID }, ...answered } }));
    expect(await uploadImageBlob(pdsCall, ctx, DID, BYTES)).toEqual({ kind: "transient", code: "pds_unavailable" });
  });

  test("blob.upload_too_large: a PDS refusing the size (PDS 0.5.51 PayloadTooLarge, 413) is a 413 rejection", async () => {
    const { pdsCall, ctx } = pds(() => json({ error: "PayloadTooLarge", message: "request entity too large" }, 413));
    expect(await uploadImageBlob(pdsCall, ctx, DID, BYTES)).toEqual({
      kind: "rejected",
      xrpcError: "PayloadTooLarge",
      status: 413,
    });
  });

  test("blob.upload_refused: a PDS error is its result, not a throw", async () => {
    const { pdsCall, ctx } = pds(() => json({ error: "InternalServerError", message: "x" }, 500));
    expect((await uploadImageBlob(pdsCall, ctx, DID, BYTES)).kind).not.toBe("ok");
  });
});
