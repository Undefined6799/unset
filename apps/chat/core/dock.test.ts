// The chat box's side of its talk with unset.sh (ADR 0115): what it takes from the frame's parent, and its one-time
// value's cookie. The box trusts a message only from its own parent window, whose origin the page's frame-ancestors
// pins to unset.sh, and only in the shapes below.
import { describe, expect, test } from "vitest";
import { dockMessage, isDock, stateCookie, unreadChats } from "./dock.ts";

const parent = {} as MessageEventSource;
const other = {} as MessageEventSource;
const event = (data: unknown, source: MessageEventSource | null = parent, origin = "https://unset.sh") =>
  ({ data, source, origin }) as MessageEvent;

describe("dockMessage", () => {
  test("chat.dock_hello: the parent's hello names its origin", () => {
    expect(dockMessage(event({ type: "unset.dock.hello" }), parent, null)).toEqual({
      kind: "hello",
      origin: "https://unset.sh",
    });
  });

  test("chat.dock_only_parent: a message from any other window is nothing", () => {
    expect(dockMessage(event({ type: "unset.dock.hello" }, other), parent, null)).toBeNull();
    expect(dockMessage(event({ type: "unset.dock.hello" }, null), parent, null)).toBeNull();
  });

  test("chat.dock_only_its_origin: once known, a message from another origin is nothing", () => {
    const from = (o: string) =>
      dockMessage(event({ type: "unset.dock.ticket", ticket: "abc" }, parent, o), parent, "https://unset.sh");
    expect(from("https://unset.sh")).toEqual({ kind: "ticket", ticket: "abc" });
    expect(from("https://evil.test")).toBeNull();
    // Before the hello nothing but the hello is taken.
    expect(dockMessage(event({ type: "unset.dock.ticket", ticket: "abc" }), parent, null)).toBeNull();
  });

  test("chat.dock_shapes: a ticket, a refused ticket and a Message link's DID; anything else is nothing", () => {
    const known = (data: unknown) => dockMessage(event(data), parent, "https://unset.sh");
    expect(known({ type: "unset.dock.ticket", ticket: null })).toEqual({ kind: "ticket", ticket: null });
    expect(known({ type: "unset.dock.open", did: "did:plc:abc" })).toEqual({ kind: "open", did: "did:plc:abc" });
    expect(known({ type: "unset.dock.open", did: "not a did" })).toBeNull();
    expect(known({ type: "unset.dock.ticket", ticket: 7 })).toBeNull();
    expect(known({ type: "unset.dock.ticket", ticket: "x".repeat(5000) })).toBeNull();
    expect(known("unset.dock.hello")).toBeNull();
    expect(known(null)).toBeNull();
    expect(known({ type: "something.else" })).toBeNull();
  });
});

describe("the box", () => {
  test("chat.dock_mode: only the root with ?dock, inside a frame", () => {
    expect(isDock({ pathname: "/", search: "?dock" }, true)).toBe(true);
    expect(isDock({ pathname: "/", search: "?dock" }, false)).toBe(false);
    expect(isDock({ pathname: "/", search: "" }, true)).toBe(false);
    expect(isDock({ pathname: "/welcome", search: "?dock" }, true)).toBe(false);
  });

  test("chat.dock_state_cookie: the door's hop-state name, partitioned to the box, ten minutes", () => {
    expect(stateCookie("abc")).toBe("__Host-chat-state=abc; Path=/; Max-Age=600; Secure; SameSite=None; Partitioned");
  });

  test("chat.dock_unread: the icon counts chats with new messages and requests waiting", () => {
    const list = [
      { available: true, request: false, unread: 2 },
      { available: true, request: false, unread: 0 },
      { available: true, request: true, unread: 0 },
      { available: false, request: false, unread: 3 },
    ];
    expect(unreadChats(list)).toBe(2);
  });
});
