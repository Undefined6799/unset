// P2.13e: a page restored from the back-forward cache keeps the state it was left in, open popovers included, so Back
// from a page reached through the menu drawer showed the drawer again (Alex 2026-10-23 04:09Z). Closing them on
// pagehide means the restored page comes back with them shut. bfcache keeps "a snapshot of the entire page in memory"
// and pagehide is its hook (https://web.dev/articles/bfcache, read 2026-10-23); shown in Chromium 1194 with the cache
// on, where the drawer stayed open after Back without this and was closed with it.

/** Close every open popover each time the page is hidden, so none survives into the back-forward cache. */
export function closePopoversOnPageHide(win: Window): void {
  win.addEventListener("pagehide", () => {
    for (const popover of win.document.querySelectorAll<HTMLElement>("[popover]")) {
      if (popover.matches(":popover-open")) popover.hidePopover();
    }
  });
}
