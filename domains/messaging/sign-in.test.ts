// The unset.cc sign-in hop's rules in web (ADR 0093 decision 3; security pass finding 8): what web signs a ticket for,
// and what it refuses. The ports are doubles of Postgres and the signer.
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { ChatUser } from "./chat-account.ts";
import { type DoorState, parseDoorState, type SessionRef, type SignInTicket, sessionRef, signIn } from "./sign-in.ts";

const ALICE = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const USER = `u${"f".repeat(20)}` as ChatUser;
const STATE = "A".repeat(43);

describe("parseDoorState", () => {
  test("chat.state_form: 43 base64url characters (32 random bytes) and nothing else", () => {
    expect(parseDoorState(STATE)).toBe(STATE);
    for (const bad of [null, "", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}/`]) {
      expect(parseDoorState(bad)).toBeNull();
    }
  });
});

describe("sessionRef", () => {
  test("chat.session_ref_one_way: the same session gives the same reference, never its key", () => {
    const idHash = Buffer.alloc(32, 7);
    const ref = sessionRef(idHash);
    expect(ref).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionRef(Buffer.alloc(32, 7))).toBe(ref);
    expect(sessionRef(Buffer.alloc(32, 8))).not.toBe(ref);
    expect(ref).not.toBe(idHash.toString("base64url"));
  });
});

function ports(user: ChatUser | null) {
  const signed: SignInTicket[] = [];
  return {
    signed,
    doubles: {
      readyUser: async () => user,
      sign: (ticket: SignInTicket) => {
        signed.push(ticket);
        return "signed-ticket";
      },
    },
  };
}

describe("signIn", () => {
  const request = { did: ALICE, idHash: Buffer.alloc(32, 7), state: STATE as DoorState };

  test("chat.ticket_names_member_session_and_state: the ticket binds the hop to the browser that started it", async () => {
    const { doubles, signed } = ports(USER);
    expect(await signIn(doubles, request)).toEqual({ kind: "ticket", ticket: "signed-ticket" });
    expect(signed).toEqual([
      { user: USER, did: ALICE, sid: sessionRef(Buffer.alloc(32, 7)) as SessionRef, state: STATE as DoorState },
    ]);
  });

  test("chat.not_ready_refused: a member whose chat account is not created yet gets no ticket", async () => {
    const { doubles, signed } = ports(null);
    expect(await signIn(doubles, request)).toEqual({ kind: "not_ready" });
    expect(signed).toEqual([]);
  });
});
