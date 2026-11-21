// chat-admin's envelope checks (ADR 0081 decision 5): shape, key, signature, the issuer's verbs, claims and each
// verb's fields, in that order, with nothing read from a payload before its signature holds.
import { describe, expect, test } from "vitest";
import { checkEnvelope, checkShape, isRefusal } from "../../../interfaces/chat-admin/envelope.ts";
import { ALICE, callerKey, nowSeconds, payloadFor, signed, TICKET } from "./harness.ts";

const web = callerKey("web-1", "web", [
  "account.create",
  "session.mint",
  "session.end",
  "account.lock",
  "account.unlock",
  "account.deactivate",
]);
const door = callerKey("door-1", "door", ["session.end"]);
const keys = [web.service, door.service];

const check = (key: ReturnType<typeof callerKey>, overrides = {}) => {
  const shaped = checkShape(signed(key, payloadFor(overrides)));
  if (isRefusal(shaped)) return shaped;
  return checkEnvelope(shaped, keys, "dev", nowSeconds());
};

describe("envelope", () => {
  test("envelope.mint_from_web: a web-signed mint names the user and nothing else", () => {
    expect(check(web)).toMatchObject({ verb: "session.mint", user: ALICE, kid: "web-1" });
  });

  test("envelope.door_only_ends: the door's key may ask session.end and nothing else", () => {
    expect(check(door, { verb: "session.end", device: "ABCDEFGHJK" })).toMatchObject({ verb: "session.end" });
    expect(check(door, { verb: "session.mint" })).toEqual({ status: 403, reason: "verb" });
    expect(check(door, { verb: "account.create", name: "alice.unset.sh" })).toEqual({ status: 403, reason: "verb" });
    for (const verb of ["account.lock", "account.unlock", "account.deactivate"]) {
      expect(check(door, { verb })).toEqual({ status: 403, reason: "verb" });
    }
  });

  test("envelope.account_verbs_from_web: lock, unlock and deactivate name only the user", () => {
    for (const verb of ["account.lock", "account.unlock", "account.deactivate"]) {
      expect(check(web, { verb })).toMatchObject({ verb, user: ALICE });
    }
  });

  test("envelope.door_key_widened: a door key configured with mint still cannot mint", () => {
    const wide = callerKey("door-2", "door", ["session.end", "session.mint"]);
    const shaped = checkShape(signed(wide, payloadFor()));
    if (isRefusal(shaped)) throw new Error("shape");
    expect(checkEnvelope(shaped, [wide.service], "dev", nowSeconds())).toEqual({ status: 403, reason: "verb" });
  });

  test("envelope.no_scope_key: a payload carrying a scope, or missing a key, is refused at the shape", () => {
    const envelope = signed(web, payloadFor());
    expect(checkShape({ ...envelope, payload: { ...envelope.payload, scope: "urn:mas:admin" } })).toEqual({
      status: 400,
      reason: "shape",
    });
    const { state: _, ...missing } = envelope.payload;
    expect(checkShape({ ...envelope, payload: missing })).toEqual({ status: 400, reason: "shape" });
    expect(checkShape({ ...envelope, extra: 1 })).toEqual({ status: 400, reason: "shape" });
  });

  test.each([
    ["same kid other key", callerKey("web-1", "web", ["session.mint"]), {}, "signature"],
    ["unknown kid", callerKey("web-9", "web", ["session.mint"]), {}, "unknown_kid"],
    ["other audience", web, { aud: "pds-admin" }, "claims"],
    ["other env", web, { env: "prod" }, "claims"],
    ["too long", web, { exp: nowSeconds() + 61 }, "time"],
    ["expired", web, { iat: nowSeconds() - 70, exp: nowSeconds() - 10 }, "time"],
    ["future", web, { iat: nowSeconds() + 30, exp: nowSeconds() + 60 }, "time"],
  ])("envelope.refused_%s", (_name, key, overrides, reason) => {
    expect(check(key, overrides)).toMatchObject({ status: 403, reason });
  });

  test.each([
    ["bad user", { user: "Alice!" }],
    ["create without name", { verb: "account.create" }],
    ["create with device", { verb: "account.create", name: "alice.unset.sh", device: "ABCDEFGHJK" }],
    ["mint with device", { device: "ABCDEFGHJK" }],
    ["mint with name", { name: "alice.unset.sh" }],
    ["end without device", { verb: "session.end" }],
    ["end with lowercase device", { verb: "session.end", device: "abcdefghjk" }],
    ["end with short device", { verb: "session.end", device: "ABCDEFGHJ" }],
    ["bad jti", { jti: "short" }],
    // ADR 0081 decision 3: a ticket names the member, the web session and the door's one-time value, each well formed.
    ["mint without did", { did: "" }],
    ["mint with a handle for did", { did: "alice.unset.sh" }],
    ["mint without sid", { sid: "" }],
    ["mint with short sid", { sid: "s".repeat(42) }],
    ["mint without state", { state: "" }],
    ["mint with a bad state", { state: `${"t".repeat(42)}!` }],
    ["create with did", { verb: "account.create", name: "alice.unset.sh", did: TICKET.did }],
    // ADR 0084: the account verbs name the user and nothing else.
    ["lock with device", { verb: "account.lock", device: "ABCDEFGHJK" }],
    ["unlock with name", { verb: "account.unlock", name: "alice.unset.sh" }],
    ["deactivate with did", { verb: "account.deactivate", did: TICKET.did }],
    ["create with state", { verb: "account.create", name: "alice.unset.sh", state: TICKET.state }],
    ["end with sid", { verb: "session.end", device: "ABCDEFGHJK", sid: TICKET.sid }],
  ])("envelope.fields_%s", (_name, overrides) => {
    expect(check(web, overrides)).toMatchObject({ status: 400 });
  });
});
