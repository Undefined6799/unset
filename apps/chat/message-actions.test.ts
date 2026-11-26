// A message's actions are reachable from the keyboard (Codex review on #1963): ConversationMessage.svelte rendered by
// the pinned Svelte's server renderer through the page's own Vite config (Vite 8.3.5 ssrLoadModule; svelte 5.57.3
// render from svelte/server, loaded through the same Vite so one Svelte runs both). Element shows a message's action bar
// when keyboard focus enters the tile, and something in every tile takes focus, its linked timestamp
// (element-web v1.12.35 apps/web/src/components/views/rooms/EventTile.tsx:700-708 onFocusWithin, 1049-1057 the
// linked timestamp, 1197). Here the actions themselves take focus: while the menu is closed they are in the page but
// out of sight, never display:none, which would take them out of the tab order, and focus within the message shows
// them. The keyboard path in a real browser is tests/e2e/chat-two-browsers.chromium.spec.ts.
import { join } from "node:path";
import type { Component } from "svelte";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Message, MessageAction } from "./core/conversations.ts";

let vite: ViteDevServer;
let render: typeof import("svelte/server").render;
let ConversationMessage: Component<Record<string, unknown>>;
beforeAll(async () => {
  vite = await createServer({
    configFile: join(import.meta.dirname, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  ({ render } = await vite.ssrLoadModule("svelte/server"));
  ConversationMessage = (await vite.ssrLoadModule("/ConversationMessage.svelte")).default;
}, 60_000);
afterAll(() => vite?.close());

const message: Message = {
  id: "$m1",
  mine: false,
  kind: "text",
  text: "hi",
  at: 0,
  replyTo: null,
  reactions: [],
  unconfirmed: false,
};
const nothing = () => undefined;

/** The message's markup with its menu closed, outside selection mode. */
function rendered(actions: readonly MessageAction[]): string {
  const { body } = render(ConversationMessage, {
    props: {
      message,
      actions,
      seenAt: null,
      otherName: "Bea",
      onReact: nothing,
      onReply: nothing,
      onDelete: nothing,
      onSelect: nothing,
      selection: null,
    },
  });
  return body.replace(/<!--.*?-->/g, "");
}

test("chat.message_actions_keyboard: a closed menu's actions stay in the tab order, shown when focus is within", () => {
  const html = rendered(["react", "reply", "delete"]);
  const toolbar = /<div class="([^"]*)" role="toolbar" aria-label="Message actions"[^>]*>(.*?)<\/div>/s.exec(html);
  if (toolbar === null) throw new Error("no toolbar");
  const classes = (toolbar[1] ?? "").split(/\s+/);
  expect(classes).not.toContain("hidden");
  expect(classes).toContain("group-focus-within:opacity-100");
  const buttons = Array.from(
    (toolbar[2] ?? "").matchAll(/<button((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>(.*?)<\/button>/gs),
    (m) => ({
      attributes: (m[1] ?? "").replace(/="[^"]*"/g, ""),
      label: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
    }),
  );
  expect(buttons.map((b) => b.label)).toEqual(["React", "Reply", "Delete", "Select"]);
  for (const button of buttons) expect(button.attributes).not.toMatch(/tabindex|disabled/);
});
