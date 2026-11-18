// The member page's `enhance`: kit's own, except that a write which sends the browser back to the page it is on
// refreshes that page's data in place instead of navigating to it. Kit follows an action's redirect with a navigation
// (@sveltejs/kit 3.2.0, src/runtime/client/client.js applyAction, line 2990), which scrolls to the top and drops
// focus, so moving or deleting a card near the bottom lost the member's place (staging walkthrough 2026-11-18,
// finding 6). refreshAll (same file, line 2726) re-runs the page's load and leaves scroll and focus alone; the
// components then put focus where the write left the card. A redirect anywhere else, such as to sign in, is followed.
import type { Enhance, SubmitHandler } from "@unset/apps-web/lib/profile/types.ts";
import { enhance } from "$app/forms";
import { refreshAll } from "$app/navigation";

type Place = { readonly href: string; readonly origin: string; readonly pathname: string; readonly search: string };

/** Whether `location` is the page the browser is on, its fragment aside. Runs only in the browser. */
function isThisPage(location: string): boolean {
  // interfaces/web's TypeScript has no DOM library; this file runs only in the browser, where location is defined.
  const here = (globalThis as unknown as { location: Place }).location;
  const to = new URL(location, here.href);
  return to.origin === here.origin && to.pathname === here.pathname && to.search === here.search;
}

export const enhanceInPlace: Enhance = (form, handler?: SubmitHandler) =>
  enhance(form, (input) => {
    const after = handler?.(input);
    return async (outcome) => {
      const update = async () => {
        if (outcome.result.type === "redirect" && isThisPage(outcome.result.location)) await refreshAll();
        else await outcome.update();
      };
      if (after === undefined) await update();
      else await after({ result: outcome.result, update });
    };
  });
