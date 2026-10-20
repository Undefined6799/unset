// P2.04 (identity-resolvers.ts; P2.01 step C): the OAuth library resolves identities only through the identity domain.
// The domain runs as itself; only the network under it is a stand-in (DNS, PLC and handle hosts are unmanaged, TE-1).
import { createDidResolver, type HttpOutcome, type IdentityNetwork, type TxtOutcome } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import { AccountElsewhereError, didResolverForOAuth, handleResolverForOAuth } from "./identity-resolvers.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const PLC = new URL("https://plc.directory");
const json = (value: unknown): HttpOutcome => ({
  kind: "response",
  status: 200,
  body: new TextEncoder().encode(JSON.stringify(value)),
});
const NOT_FOUND: HttpOutcome = { kind: "response", status: 404, body: new Uint8Array() };

function network(answers: { txt?: TxtOutcome; get?: HttpOutcome }): IdentityNetwork {
  return {
    txt: async () => answers.txt ?? { kind: "no_record" },
    get: async () => answers.get ?? NOT_FOUND,
  };
}

const document = {
  id: DID,
  alsoKnownAs: ["at://alice.example.com"],
  verificationMethod: [
    {
      id: `${DID}#atproto`,
      type: "Multikey",
      controller: DID,
      publicKeyMultibase: "zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF",
    },
  ],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }],
};

describe("handleResolverForOAuth", () => {
  test("oauthAdapter_maps_found_and_not_found", async () => {
    const found = handleResolverForOAuth(network({ txt: { kind: "records", records: [`did=${DID}`] } }));
    expect(await found.resolve("alice.example.com")).toBe(DID);
    const missing = handleResolverForOAuth(network({}));
    expect(await missing.resolve("alice.example.com")).toBeNull();
  });

  test("oauthAdapter_refuses_bad_handles_before_any_network", async () => {
    let asked = false;
    const net: IdentityNetwork = {
      txt: async () => {
        asked = true;
        return { kind: "no_record" };
      },
      get: async () => {
        asked = true;
        return NOT_FOUND;
      },
    };
    expect(await handleResolverForOAuth(net).resolve("localhost")).toBeNull();
    expect(asked).toBe(false);
  });

  test("oauthAdapter_throws_on_unavailable", async () => {
    const down = handleResolverForOAuth(network({ txt: { kind: "unavailable" }, get: { kind: "unavailable" } }));
    await expect(down.resolve("alice.example.com")).rejects.toMatchObject({
      name: "IdentityError",
      kind: "unavailable",
    });
  });
});

describe("didResolverForOAuth", () => {
  const resolverOver = (get: HttpOutcome) =>
    didResolverForOAuth(
      createDidResolver({ network: network({ get }), plcUrl: PLC, cacheTtlS: 60, cacheMax: 10 }),
      "https://pds.example.com",
    );

  test("oauthAdapter_document_carries_only_what_the_library_reads", async () => {
    const doc = await resolverOver(json(document)).resolve(DID);
    expect(doc).toEqual({
      id: DID,
      alsoKnownAs: ["at://alice.example.com"],
      service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }],
    });
  });

  test("oauthAdapter_no_usable_pds_means_no_service", async () => {
    const plain = { ...document, service: [{ ...document.service[0], serviceEndpoint: "http://pds.example.com" }] };
    expect((await resolverOver(json(plain)).resolve(DID)).service).toEqual([]);
  });

  test("oauthAdapter_refuses_an_account_on_another_pds", async () => {
    // P1.36v: only our own PDS's accounts resolve; another host, however close, throws before the library asks it.
    for (const endpoint of [
      "https://pds.example.org",
      "https://evil-pds.example.com",
      "https://pds.example.com:8443",
    ]) {
      const elsewhere = { ...document, service: [{ ...document.service[0], serviceEndpoint: endpoint }] };
      await expect(resolverOver(json(elsewhere)).resolve(DID), endpoint).rejects.toBeInstanceOf(AccountElsewhereError);
    }
  });

  test("oauthAdapter_did_failures_throw", async () => {
    await expect(resolverOver(NOT_FOUND).resolve(DID)).rejects.toMatchObject({ kind: "not_found" });
    await expect(resolverOver(json(document)).resolve("did:web:localhost")).rejects.toMatchObject({
      kind: "invalid_doc",
    });
  });
});
