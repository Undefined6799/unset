// The page's half of the Message link (ADR 0082 decision 6, ADR 0090 decision 3): a path `/dm/<did>` names the
// member, the door is asked for their chat ID with the device this page holds, and the page goes on at the start
// route `/?with=<chat ID>`, or at `/?with=` (which the list answers as an unknown chat ID) when the door has none.
// The door is a stand-in fetch (unmanaged, TE-1); its own side is tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import { dmTarget, startPathFor } from "./contact.ts";

const DID = `did:plc:${"b".repeat(24)}`;
const CHAT_ID = `@u${"b".repeat(20)}:unset.cc`;
const deadline = () => AbortSignal.timeout(1000);

function door(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchFn, calls };
}

describe("dmTarget", () => {
  test("chat.dm_path: only /dm/ and a DID, nothing more", () => {
    expect(dmTarget(`/dm/${DID}`)).toBe(DID);
    for (const path of ["/", "/dm/", "/dm/nope", `/dm/${DID}/x`, `/x/dm/${DID}`, `/dm/${DID}?with=y`]) {
      expect(dmTarget(path)).toBeNull();
    }
  });
});

describe("startPathFor", () => {
  test("chat.dm_found: the door's chat ID becomes the start route", async () => {
    const d = door(200, { chatId: CHAT_ID });
    expect(await startPathFor(d.fetchFn, "DEVICEAAAA", DID, deadline())).toBe(`/?with=${encodeURIComponent(CHAT_ID)}`);
    expect(d.calls[0]?.url).toBe("/chat-id");
    expect(d.calls[0]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ deviceId: "DEVICEAAAA", did: DID }),
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  test("chat.dm_missing: a 404, a fault or an answer of the wrong shape starts nothing", async () => {
    for (const d of [door(404, { error: "chat.not_found" }), door(200, { chatId: "<b>" }), door(200, {})]) {
      expect(await startPathFor(d.fetchFn, "DEVICEAAAA", DID, deadline())).toBe("/?with=");
    }
  });
});
