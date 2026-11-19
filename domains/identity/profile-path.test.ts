import { describe, expect, test } from "vitest";
import { canonicalActorPath, parseActor } from "./profile-path.ts";
import { type Did, type Handle, parseDid, parseHandle } from "./syntax.ts";

const SUFFIX = ".unset.im";
const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";

describe("parseActor", () => {
  test("did_kept_as_typed", () => {
    expect(parseActor(DID, SUFFIX)).toEqual({ did: DID });
    // DIDs are case-sensitive: an uppercase did:plc is no DID, never lowercased into another account.
    expect(parseActor(DID.toUpperCase().replace("DID:PLC:", "did:plc:"), SUFFIX)).toBeNull();
    expect(parseActor("did:plc:short", SUFFIX)).toBeNull();
  });

  test("handle_lowercased_and_suffixed", () => {
    expect(parseActor("Alice", SUFFIX)).toEqual({ handle: "alice.unset.im" });
    expect(parseActor("alice.example.com", SUFFIX)).toEqual({ handle: "alice.example.com" });
  });

  test("not_a_handle_is_null", () => {
    for (const raw of ["", " alice", "@alice", "<script>", "alice.test", "a..b", "x".repeat(260)])
      expect(parseActor(raw, SUFFIX)).toBeNull();
  });
});

describe("canonicalActorPath", () => {
  const did = parseDid(DID) as Did;
  test("verified_handle_else_did", () => {
    expect(canonicalActorPath(parseHandle("alice.unset.im") as Handle, did)).toBe("/@alice.unset.im");
    expect(canonicalActorPath(null, did)).toBe(`/@${DID}`);
  });
});
