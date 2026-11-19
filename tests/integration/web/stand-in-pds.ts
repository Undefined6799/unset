// A stand-in PDS and its authorization server for the built web server's tests (rule TE-1: the PDS is unmanaged), run
// inside stand-in-server.ts. It answers what a restored OAuth session asks for (the authorization server metadata, as
// tests/integration/oauth/refresh.test.ts serves it) and the calls the member's page makes, over one in-memory repo:
// getRecord, listRecords, putRecord (with swapRecord), createRecord (with swapCommit), deleteRecord and
// com.atproto.sync.getLatestCommit (https://atproto.com/specs/xrpc; lexicons com.atproto.repo.*, sync.*). Every write
// moves the repo's head, as a real commit does. Each write is reported through `onWrite`.
import { createHash } from "node:crypto";
import type { PdsFixture } from "./built-server.ts";

export type PdsWrite = {
  readonly method: "putRecord" | "createRecord" | "deleteRecord";
  readonly collection: string;
  readonly rkey: string;
  readonly record?: unknown;
  readonly swapRecord?: string | null;
};

/** A valid CIDv1 (dag-cbor, sha-256) the stand-in gives every record; nothing here checks content addressing. */
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
    require_pushed_authorization_requests: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256"],
    dpop_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["atproto"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

/** A CIDv1 (raw, sha-256) for `n`, base32 as atproto writes CIDs, so each head the stand-in reports is distinct. */
function cidOf(n: number): string {
  const bytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), createHash("sha256").update(`${n}`).digest()]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "b";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    for (; bits >= 5; bits -= 5) out += alphabet[(value >>> (bits - 5)) & 31];
  }
  return bits > 0 ? out + alphabet[(value << (5 - bits)) & 31] : out;
}

let created = 0;
/** A fresh TID-shaped record key (13 base32-sortable characters). */
const nextKey = () => `3l${String(++created).padStart(11, "2")}`;

/** The stand-in: a Response for a request to `fixture.origin`, or undefined for any other origin. */
export function standInPds(fixture: PdsFixture, onWrite: (write: PdsWrite) => void) {
  const repo = new Map(Object.entries(fixture.records).map(([c, keys]) => [c, new Map(Object.entries(keys))]));
  const collection = (name: string) => {
    const records = repo.get(name) ?? new Map<string, unknown>();
    repo.set(name, records);
    return records;
  };
  const uri = (c: string, rkey: string) => `at://${fixture.did}/${c}/${rkey}`;
  const wrongRepo = () => json(400, { error: "InvalidRequest", message: "not this repo" });
  let commits = 0;
  const head = () => cidOf(commits);

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (url.origin !== fixture.origin) return undefined;
    if (url.pathname === "/.well-known/oauth-authorization-server") return json(200, metadata(fixture.origin));
    if (url.pathname === "/.well-known/oauth-protected-resource")
      return json(200, { resource: fixture.origin, authorization_servers: [fixture.origin] });
    // com.atproto.server.getSession, when the fixture names an email state: the account the token is for, which here is
    // always `fixture.did` (https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/getSession.json).
    if (url.pathname === "/xrpc/com.atproto.server.getSession" && fixture.session !== undefined)
      return json(200, {
        did: fixture.did,
        handle: `alice.${new URL(fixture.origin).hostname}`,
        email: "alice@example.test",
        emailConfirmed: fixture.session.emailConfirmed,
      });
    if (url.pathname === "/xrpc/com.atproto.sync.getLatestCommit")
      return url.searchParams.get("did") === fixture.did
        ? json(200, { cid: head(), rev: "3jzfcijpj2z2a" })
        : wrongRepo();
    const method = url.pathname.replace(/^\/xrpc\/com\.atproto\.repo\./, "");
    if (fixture.failing?.includes(method)) return json(503, { error: "Unavailable" });
    const hold = fixture.slow?.[method];
    if (hold !== undefined) await new Promise((done) => setTimeout(done, hold));
    if (request.method === "GET") {
      const q = url.searchParams;
      if (q.get("repo") !== fixture.did) return wrongRepo();
      const records = collection(q.get("collection") ?? "");
      if (method === "getRecord") {
        const rkey = q.get("rkey") ?? "";
        const value = records.get(rkey);
        return value === undefined
          ? json(400, { error: "RecordNotFound", message: "Could not locate record" })
          : json(200, { uri: uri(q.get("collection") ?? "", rkey), cid: CID, value });
      }
      if (method === "listRecords")
        return json(200, {
          records: [...records].map(([rkey, value]) => ({
            uri: uri(q.get("collection") ?? "", rkey),
            cid: CID,
            value,
          })),
        });
      return json(404, { error: "MethodNotImplemented" });
    }
    const input = (await request.json()) as {
      repo: string;
      collection: string;
      rkey?: string;
      record?: unknown;
      swapRecord?: string | null;
      swapCommit?: string;
    };
    if (input.repo !== fixture.did) return wrongRepo();
    if (input.swapCommit !== undefined && input.swapCommit !== head())
      return json(400, { error: "InvalidSwap", message: `Commit was at ${head()}` });
    const records = collection(input.collection);
    if (method === "putRecord") {
      const rkey = input.rkey ?? "";
      if (input.swapRecord === null && records.has(rkey)) return json(400, { error: "InvalidSwap", message: "exists" });
      records.set(rkey, input.record);
      commits += 1;
      onWrite({
        method,
        collection: input.collection,
        rkey,
        record: input.record,
        swapRecord: input.swapRecord ?? null,
      });
      return json(200, { uri: uri(input.collection, rkey), cid: CID });
    }
    if (method === "createRecord") {
      const rkey = nextKey();
      records.set(rkey, input.record);
      commits += 1;
      onWrite({ method, collection: input.collection, rkey, record: input.record });
      return json(200, { uri: uri(input.collection, rkey), cid: CID });
    }
    if (method === "deleteRecord") {
      records.delete(input.rkey ?? "");
      commits += 1;
      onWrite({ method, collection: input.collection, rkey: input.rkey ?? "" });
      return json(200, {});
    }
    return json(404, { error: "MethodNotImplemented" });
  };
}
