// The chat box's side of its talk with unset.sh (ADR 0115): what it takes from the frame's parent, and its one-time
// value's cookie. The box trusts a message only from its own parent window, whose origin the page's frame-ancestors
// pins to unset.sh, and only in the shapes below.
import { describe, expect, test } from "vitest";
import { boxVisibility, dockMessage, initialOf, isDock, stateCookie, unreadChats } from "./dock.ts";

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
      dockMessage(event({ type: "unset.dock.open", did: "did:plc:abc" }, parent, o), parent, "https://unset.sh");
    expect(from("https://unset.sh")).toEqual({ kind: "open", did: "did:plc:abc" });
    expect(from("https://evil.test")).toBeNull();
    // Before the hello nothing but the hello is taken.
    expect(dockMessage(event({ type: "unset.dock.open", did: "did:plc:abc" }), parent, null)).toBeNull();
  });

  test("chat.dock_shapes: a Message link's DID and whether the box is open; anything else, a ticket too, is nothing", () => {
    const known = (data: unknown) => dockMessage(event(data), parent, "https://unset.sh");
    // The ticket never passes through the shell (chat box review D1), so the box takes none from it.
    expect(known({ type: "unset.dock.ticket", ticket: "abc" })).toBeNull();
    expect(known({ type: "unset.dock.open", did: "did:plc:abc" })).toEqual({ kind: "open", did: "did:plc:abc" });
    expect(known({ type: "unset.dock.open", did: "not a did" })).toBeNull();
    expect(known({ type: "unset.dock.shown", shown: true })).toEqual({ kind: "shown", shown: true });
    expect(known({ type: "unset.dock.shown", shown: false })).toEqual({ kind: "shown", shown: false });
    expect(known({ type: "unset.dock.shown", shown: "yes" })).toBeNull();
    expect(known({ type: "unset.dock.log_out" })).toEqual({ kind: "log_out" });
    expect(known({ type: "unset.dock.list" })).toEqual({ kind: "list" });
    expect(known({ type: "unset.dock.back" })).toEqual({ kind: "back" });
    expect(known("unset.dock.hello")).toBeNull();
    expect(known(null)).toBeNull();
    expect(known({ type: "something.else" })).toBeNull();
  });
});

test("chat.dock_theme: unset.sh's light, dark or device choice, and nothing else", () => {
  const known = (data: unknown) => dockMessage(event(data), parent, "https://unset.sh");
  expect(known({ type: "unset.dock.theme", theme: "dark" })).toEqual({ kind: "theme", theme: "dark" });
  expect(known({ type: "unset.dock.theme", theme: "light" })).toEqual({ kind: "theme", theme: "light" });
  expect(known({ type: "unset.dock.theme", theme: "system" })).toEqual({ kind: "theme", theme: "system" });
  expect(known({ type: "unset.dock.theme", theme: "blue" })).toBeNull();
  expect(known({ type: "unset.dock.theme" })).toBeNull();
});

describe("boxVisibility", () => {
  // Hiding the frame's container leaves the box's own document "visible" (CSS display does not change
  // visibilityState), so the box is seen only while the tab is seen and the shell says the box is open; read receipts
  // follow it (matrix/conversation-service.ts readIfSeen; Codex review on PR #1963).
  const tab = (visibilityState: DocumentVisibilityState) =>
    Object.assign(new EventTarget(), { visibilityState }) as EventTarget & { visibilityState: DocumentVisibilityState };

  test("chat.dock_seen_only_open: hidden until the shell says open, and again once it says closed", () => {
    const page = tab("visible");
    const box = boxVisibility(page);
    expect(box.visibilityState).toBe("hidden");
    box.setShown(true);
    expect(box.visibilityState).toBe("visible");
    box.setShown(false);
    expect(box.visibilityState).toBe("hidden");
  });

  test("chat.dock_seen_only_tab_seen: an open box in a hidden tab is not seen", () => {
    const page = tab("hidden");
    const box = boxVisibility(page);
    box.setShown(true);
    expect(box.visibilityState).toBe("hidden");
  });

  test("chat.dock_seen_changes: a change of either says visibilitychange", () => {
    const page = tab("hidden");
    const box = boxVisibility(page);
    const seen: DocumentVisibilityState[] = [];
    box.addEventListener("visibilitychange", () => seen.push(box.visibilityState));
    box.setShown(true);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    box.setShown(false);
    expect(seen).toEqual(["hidden", "visible", "hidden"]);
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

  test("chat.dock_initial: an avatar's letter is the handle's first, upper-cased; nothing usable gives a dot", () => {
    expect(initialOf("maya.unset.sh")).toBe("M");
    expect(initialOf("@élise.unset.sh")).toBe("É");
    expect(initialOf("")).toBe("·");
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
