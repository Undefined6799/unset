// P2.18s: what the adapter decides before and after the network, with the store itself as the one unmanaged
// dependency doubled (TE-1). The calls against a real store are tests/integration/storage/object-store.test.ts.
import { describe, expect, test } from "vitest";
import { createObjectStore, type ObjectStore } from "./object-store.ts";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const UNAVAILABLE = { ok: false, code: "objects.unavailable" };

const store = (fetch: typeof globalThis.fetch): ObjectStore =>
  createObjectStore({ origin: "http://objects:8333", bucket: "unset-private", keyId: "id", secret: "secret", fetch });
const answering =
  (status: number, body = ""): typeof fetch =>
  async () =>
    new Response(body, { status });

describe("object store adapter", () => {
  test("objects_bad_key_refused", async () => {
    const never = store(async () => {
      throw new Error("must not be called");
    });
    for (const key of ["", "/drafts/a", "drafts/../media/a", "drafts/./a", "drafts//a", "drafts/a?x", "drafts/a b"]) {
      await expect(never.get(key), key).rejects.toThrow(TypeError);
    }
    await expect(never.get("drafts/%2e")).rejects.toThrow(TypeError);
    await expect(never.deletePrefix("drafts/a&b/")).rejects.toThrow(TypeError);
  });

  test("objects_unavailable_is_typed", async () => {
    const down = store(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await down.put(`drafts/${DID}/x`, new Uint8Array([1]), "text/plain")).toEqual(UNAVAILABLE);
    expect(await down.get(`drafts/${DID}/x`)).toEqual(UNAVAILABLE);
    expect(await down.setTags(`drafts/${DID}/x`, {})).toEqual(UNAVAILABLE);
    expect(await down.list(`drafts/${DID}/`)).toEqual(UNAVAILABLE);
    expect(await down.deletePrefix(`drafts/${DID}/`)).toEqual(UNAVAILABLE);
  });

  test("objects_refusal_is_unavailable", async () => {
    expect(await store(answering(403)).get(`drafts/${DID}/x`)).toEqual(UNAVAILABLE);
    expect(await store(answering(500)).put(`drafts/${DID}/x`, new Uint8Array([1]), "text/plain")).toEqual(UNAVAILABLE);
    expect(await store(answering(404)).get(`drafts/${DID}/x`)).toEqual({ ok: true, bytes: null });
  });

  test("objects_truncated_list_without_token_is_unavailable", async () => {
    const xml = "<ListBucketResult><IsTruncated>true</IsTruncated><Key>drafts/a</Key></ListBucketResult>";
    expect(await store(answering(200, xml)).list("drafts/")).toEqual(UNAVAILABLE);
  });

  test("objects_malformed_list_is_unavailable", async () => {
    for (const xml of [
      "",
      "<ListBucketResult><Contents>",
      "<ListBucketResult><Key>drafts/a</Key></ListBucketResult>",
    ]) {
      expect(await store(answering(200, xml)).deletePrefix("drafts/"), xml).toEqual(UNAVAILABLE);
    }
  });

  test("objects_cut_off_body_is_unavailable", async () => {
    const broken = (): Response =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
      );
    const fetch: typeof globalThis.fetch = async () => broken();
    expect(await store(fetch).list("drafts/")).toEqual(UNAVAILABLE);
    expect(await store(fetch).get(`drafts/${DID}/x`)).toEqual(UNAVAILABLE);
    const listed = "<ListBucketResult><IsTruncated>false</IsTruncated><Key>drafts/a</Key></ListBucketResult>";
    const deleteBroken: typeof globalThis.fetch = async (input) =>
      (input as Request).method === "GET" ? new Response(listed) : broken();
    expect(await store(deleteBroken).deletePrefix("drafts/")).toEqual(UNAVAILABLE);
  });

  test("objects_prefix_needs_trailing_slash", async () => {
    const never = store(async () => {
      throw new Error("must not be called");
    });
    // drafts/did:web:example.com would also match drafts/did:web:example.com.au/…
    await expect(never.deletePrefix("drafts/did:web:example.com")).rejects.toThrow(TypeError);
    await expect(never.list("drafts/did:web:example.com")).rejects.toThrow(TypeError);
    await expect(never.get("drafts/did:web:example.com/")).rejects.toThrow(TypeError);
  });

  test("objects_delete_needs_whole_result", async () => {
    const listed = "<ListBucketResult><IsTruncated>false</IsTruncated><Key>drafts/a</Key></ListBucketResult>";
    for (const answer of ["", "<DeleteResult>", "<Other></Other>"]) {
      const fetch: typeof globalThis.fetch = async (input) =>
        new Response((input as Request).method === "GET" ? listed : answer);
      expect(await store(fetch).deletePrefix("drafts/"), answer).toEqual(UNAVAILABLE);
    }
    const ok: typeof globalThis.fetch = async (input) =>
      new Response(
        (input as Request).method === "GET" ? listed : '<?xml version="1.0"?>\n<DeleteResult></DeleteResult>',
      );
    expect(await store(ok).deletePrefix("drafts/")).toEqual({ ok: true, deleted: 1 });
  });

  test("objects_listed_key_outside_alphabet_is_unavailable", async () => {
    const listed = "<ListBucketResult><IsTruncated>false</IsTruncated><Key>drafts/a&lt;b</Key></ListBucketResult>";
    expect(await store(answering(200, listed)).deletePrefix("drafts/")).toEqual(UNAVAILABLE);
  });

  test("objects_tag_values_are_escaped", async () => {
    let body = "";
    const fetch: typeof globalThis.fetch = async (input) => {
      body = await (input as Request).text();
      return new Response("");
    };
    await store(fetch).setTags(`drafts/${DID}/x`, { note: "a<b&c" });
    expect(body).toContain("<Value>a&lt;b&amp;c</Value>");
  });

  test("objects_partial_delete_is_unavailable", async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const request = input as Request;
      calls.push(`${request.method} ${new URL(request.url).search}`);
      if (request.method === "GET") {
        return new Response("<ListBucketResult><IsTruncated>false</IsTruncated><Key>drafts/a</Key></ListBucketResult>");
      }
      return new Response("<DeleteResult><Error><Key>drafts/a</Key><Code>AccessDenied</Code></Error></DeleteResult>");
    };
    expect(await store(fetch).deletePrefix("drafts/")).toEqual(UNAVAILABLE);
    expect(calls.at(-1)).toBe("POST ?delete");
  });

  test("objects_payload_is_signed", async () => {
    let seen: Request | undefined;
    const fetch: typeof globalThis.fetch = async (input) => {
      seen = input as Request;
      return new Response("", { status: 200 });
    };
    await store(fetch).put(`drafts/${DID}/x`, new TextEncoder().encode("x"), "text/plain", { lifecycle: "expire" });
    // sha256("x"), never UNSIGNED-PAYLOAD
    expect(seen?.headers.get("x-amz-content-sha256")).toBe(
      "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    );
    expect(seen?.headers.get("authorization")).toContain("x-amz-content-sha256");
    expect(seen?.headers.get("x-amz-tagging")).toBe("lifecycle=expire");
    expect(seen?.url).toBe(`http://objects:8333/unset-private/drafts/${DID}/x`);
  });
});
