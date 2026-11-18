// The owner's editors with no script (staging walkthrough 2026-11-18, finding 8): each trigger is a link to the page
// with that editor in place, `?edit=<key>`, `?remove=<key>`, `?add[=<kind>]` or `?avatar`, read by the page's load and
// drawn by card-panel.svelte at PANEL_ANCHOR. With script a plain press opens the dialog instead.

/** The id the in-place editor carries, so the link's fragment scrolls to it. */
export const PANEL_ANCHOR = "card-editor";

/**
 * Whether a press on a trigger link should open its dialog here: a plain left press. One meant for a new tab or
 * window (a modifier key, another button) follows the link, which opens the editor in place there.
 */
export function opensHere(event: MouseEvent): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  return true;
}
