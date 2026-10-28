// @vitest-environment jsdom
// P2.13e: Back must go to the previous page, not show the menu again (Alex 2026-10-23 04:09Z). A page restored from
// the back-forward cache keeps the state it was left in, open popovers included, so they are closed as it is hidden.
import { afterEach, expect, test } from "vitest";
import { closePopoversOnPageHide } from "./popovers.ts";

afterEach(() => document.body.replaceChildren());

/** jsdom has no popover API: a popover whose open state the test sets and whose hidePopover it counts. */
function popover(open: boolean) {
  const element = Object.assign(document.createElement("nav"), { popover: "auto" });
  element.setAttribute("popover", "auto");
  let hidden = 0;
  element.matches = ((selector: string) => selector === ":popover-open" && open) as typeof element.matches;
  element.hidePopover = () => {
    hidden += 1;
  };
  document.body.append(element);
  return { hidden: () => hidden };
}

test("closes every open popover when the page is hidden, and leaves closed ones alone", () => {
  const open = popover(true);
  const closed = popover(false);
  closePopoversOnPageHide(window);
  expect(open.hidden()).toBe(0);
  window.dispatchEvent(new Event("pagehide"));
  expect(open.hidden()).toBe(1);
  expect(closed.hidden()).toBe(0);
});
