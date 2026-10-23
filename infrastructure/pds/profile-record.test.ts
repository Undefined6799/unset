// The member's sh.unset.profile record, read over pdsCall. The XRPC client is the real @atproto/api Agent over a fake
// fetchHandler, so the request it sends and the error it parses are the library's own.
import type { Did } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { createPdsCall } from "./pds-call.ts";
import { loadProfileRecord } from "./profile-record.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };

function load(answer: (url: URL) => Response) {
  const urls: URL[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string) {
          const parsed = new URL(url, "https://pds.example");
          urls.push(parsed);
          return answer(parsed);
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: Date.now() + 60_000 };
  return { result: loadProfileRecord(pdsCall, ctx, DID), urls };
}

test("reads the self record of the member's own repo", async () => {
  const value = { $type: "sh.unset.profile", displayName: "Alice", createdAt: "2026-10-23T03:00:00.000Z" };
  const { result, urls } = load(() => Response.json({ uri: `at://${DID}/sh.unset.profile/self`, cid: CID, value }));
  expect(await result).toEqual({ kind: "ok", value: { value, cid: CID } });
  expect(urls[0]?.pathname).toBe("/xrpc/com.atproto.repo.getRecord");
  expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
    repo: DID,
    collection: "sh.unset.profile",
    rkey: "self",
  });
});

test("no record yet is not a failure", async () => {
  const { result } = load(() =>
    Response.json({ error: "RecordNotFound", message: "Could not locate record" }, { status: 400 }),
  );
  expect(await result).toEqual({ kind: "ok", value: null });
});

test("another refusal is never read as an empty profile", async () => {
  const { result } = load(() => Response.json({ error: "InvalidRequest", message: "no" }, { status: 400 }));
  expect((await result).kind).not.toBe("ok");
});
