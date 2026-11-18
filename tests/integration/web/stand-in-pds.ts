// A stand-in PDS and its authorization server for the built web server's tests (rule TE-1: the PDS is unmanaged), run
// inside stand-in-server.ts. It answers what a restored OAuth session asks for (the authorization server metadata, as
// tests/integration/oauth/refresh.test.ts serves it) and the five com.atproto.repo calls the member's page makes, over
// one in-memory repo: getRecord, listRecords, putRecord (with swapRecord), createRecord and deleteRecord
// (https://atproto.com/specs/xrpc; lexicons com.atproto.repo.*). Each write is reported through `onWrite`.
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

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (url.origin !== fixture.origin) return undefined;
    if (url.pathname === "/.well-known/oauth-authorization-server") return json(200, metadata(fixture.origin));
    if (url.pathname === "/.well-known/oauth-protected-resource")
      return json(200, { resource: fixture.origin, authorization_servers: [fixture.origin] });
    const method = url.pathname.replace(/^\/xrpc\/com\.atproto\.repo\./, "");
    if (fixture.failing?.includes(method)) return json(503, { error: "Unavailable" });
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
    };
    if (input.repo !== fixture.did) return wrongRepo();
    const records = collection(input.collection);
    if (method === "putRecord") {
      const rkey = input.rkey ?? "";
      if (input.swapRecord === null && records.has(rkey)) return json(400, { error: "InvalidSwap", message: "exists" });
      records.set(rkey, input.record);
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
      onWrite({ method, collection: input.collection, rkey, record: input.record });
      return json(200, { uri: uri(input.collection, rkey), cid: CID });
    }
    if (method === "deleteRecord") {
      records.delete(input.rkey ?? "");
      onWrite({ method, collection: input.collection, rkey: input.rkey ?? "" });
      return json(200, {});
    }
    return json(404, { error: "MethodNotImplemented" });
  };
}
