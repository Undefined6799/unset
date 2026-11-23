<!--
  The shell of every page (P1.20d), as the React AppShell drew it before P1.20k; src/lib/shell.ts says what a
  page passes. The page's own load returns `shell`; the error page and any page that passes nothing get the site shell.
  Neither shell offers Sign in when the gate read a live session for the route (+layout.server.ts). Everything here works with no script: links, plain forms, and a native popover for the menu drawer
  (https://html.spec.whatwg.org/multipage/popover.html). The `?error=` callout shows only the catalog's text.
-->
<script lang="ts">
import "@unset/apps-web/app.css";
import { Icon, type IconName } from "@unset/apps-web/lib/components/icon";
import DismissAll from "@unset/apps-web/lib/components/notifications/dismiss-all.svelte";
import NotificationList from "@unset/apps-web/lib/components/notifications/notification-list.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Badge } from "@unset/apps-web/lib/components/ui/badge";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import appleTouchIcon from "@unset/apps-web/lib/icons/unset-apple-touch-icon.png";
import favicon from "@unset/apps-web/lib/icons/unset-favicon-32.png";
import { NOTIFICATIONS as N } from "@unset/apps-web/lib/notifications/messages.ts";
import { PANEL_ANCHOR } from "@unset/apps-web/lib/profile/panel.ts";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import type { Snippet } from "svelte";
import { enhance, type SubmitFunction } from "$app/forms";
import { afterNavigate, beforeNavigate } from "$app/navigation";
import { page, updated } from "$app/state";
import {
  accountLetter,
  ERROR_SHELL,
  type ShellData,
  SITE_SHELL,
  STEP_ERROR_SHELL,
  SHELL_TEXT as T,
  type ThemeChoice,
} from "../lib/shell.ts";
import type { LayoutData } from "./$types";

let { data, children }: { data: LayoutData; children: Snippet } = $props();

// An error page (+error.svelte) gets no page data, so it gets the core shell, with the member the gate read; a member
// mid-onboarding gets the site shell, signed in, with none of the app's menus (+layout.server.ts appOpen).
const errorShell = $derived(data.signedIn && !data.appOpen ? STEP_ERROR_SHELL : ERROR_SHELL);
const shell: ShellData = $derived(page.error ? errorShell : ((page.data as { shell?: ShellData }).shell ?? SITE_SHELL));
// No Sign in for a member the gate found signed in (+layout.server.ts): on the welcome steps, the confirm-email page
// and the error page, which pass no account.
const signedIn = $derived(shell.signedIn === true || data.signedIn);
// The theme form on every app page (+layout.server.ts), as the page passes it or the layout found it.
const prefs = $derived(shell.prefs ?? data.prefs);
const message = $derived(data.error === null ? undefined : ERROR_MESSAGES[data.error as keyof typeof ERROR_MESSAGES]);
const LEGAL = [
  { label: T.terms, href: "/legal/terms" },
  { label: T.privacy, href: "/legal/privacy" },
  { label: T.domains, href: "/legal/domains" },
];
const THEMES = [
  { value: "dark", label: T.dark },
  { value: "light", label: T.light },
  { value: "system", label: T.system },
] as const;
const PICKER = [
  { value: "dark", icon: "bulb-off", label: T.dark },
  { value: "system", icon: "tv", label: T.system },
  { value: "light", icon: "bulb-on", label: T.light },
] as const;

// The account menu's picker in the browser (P2.13e), as shared/ui/components/Navigation/ThemePicker.tsx did it: once the
// client runs, a choice is saved in the background and applied to <html> in place, so the menu stays open (Alex,
// 2026-10-23 02:15Z). The server renders a choice as data-theme and the color-scheme meta (lib/server/theme.ts
// themeChunk); applyTheme sets the same two. The theme cookie is HttpOnly, so the tab keeps its last saved choice in
// sessionStorage for a page the back-forward cache restores as it was left (https://web.dev/articles/bfcache).
const SAVED_THEME = "unset.theme";
const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "dark" || value === "light" || value === "system";

function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", theme === "system" ? "dark light" : theme);
}

function rememberTheme(theme: ThemeChoice): void {
  try {
    sessionStorage.setItem(SAVED_THEME, theme);
  } catch {
    // Storage can be off; the cookie still holds the choice for every page the server renders.
  }
}

function rememberedTheme(): ThemeChoice | null {
  try {
    const value = sessionStorage.getItem(SAVED_THEME);
    return isThemeChoice(value) ? value : null;
  } catch {
    return null;
  }
}

// The Appearance row's icon and words: the picker's for the current choice.
const PICKER_LABEL = Object.fromEntries(PICKER.map((choice) => [choice.value, choice.label])) as Record<
  ThemeChoice,
  string
>;
const PICKER_ICON = Object.fromEntries(PICKER.map((choice) => [choice.value, choice.icon])) as Record<
  ThemeChoice,
  IconName
>;

// The picker's choice once saved in the background; until then the server's.
let saved = $state<ThemeChoice | undefined>(undefined);
const current = $derived(saved ?? prefs?.theme ?? "system");

// A choice is saved in the background and applied in place, so the drawer stays open; a save that does not come back
// as the route's 303 sends the plain form instead, which the server answers as with no script.
const saveInPlace: SubmitFunction = ({ submitter, formElement }) => {
  const choice = (submitter as HTMLButtonElement | null)?.value;
  return async ({ result }) => {
    if (result.type === "redirect" && isThemeChoice(choice)) {
      applyTheme(choice);
      rememberTheme(choice);
      saved = choice;
      return;
    }
    const field = Object.assign(document.createElement("input"), {
      type: "hidden",
      name: "theme",
      value: choice ?? "",
    });
    formElement.append(field);
    HTMLFormElement.prototype.submit.call(formElement);
  };
};

// A panel opened from More actions sits on top of it, and Chromium gives focus back to the opener only for the first
// panel of a stack (seen in a test on Chromium 1243, staging audit 2026-11-19): Escape closed the panel, More actions
// stayed open, and focus was left in the hidden panel, so the next Tab went behind the menu. Once the client runs,
// focus goes back to the row that opened the panel, unless it already moved elsewhere. A page with no script (the
// public group) keeps the browser's own behaviour.
function backToActions(event: ToggleEvent): void {
  if (event.newState !== "closed") return;
  const actions = document.getElementById(ACTIONS);
  const panel = event.currentTarget as HTMLElement;
  const focused = document.activeElement;
  if (!actions?.matches(":popover-open")) return;
  if (focused !== document.body && !panel.contains(focused)) return;
  actions.querySelector<HTMLElement>(`[popovertarget="${panel.id}"]`)?.focus();
}

// A page the back-forward cache restores keeps the theme it was left with; this tab's last save replaces it.
function restoreSaved(event: PageTransitionEvent): void {
  const last = event.persisted ? rememberedTheme() : null;
  if (last === null) return;
  applyTheme(last);
  saved = last;
}

const MENU = "core-menu";
const ACCOUNT = "account-menu";
const ACTIONS = "actions-menu";
const CREATE = "create-menu";
const MESSAGES = "messages-menu";
const NOTIFICATIONS = "notifications-menu";
const SEARCH = "search-menu";
// The core header's main destinations (Clean tabs): those that run today are links.
const TABS = [{ label: T.home, href: "/", icon: "home", active: "home" }] as const;
// Coming soon (Alex, 2026-11-18: "still have them in a nav bar ... show them inactive, and then make a note somewhere
// so we don't forget"). Each is drawn greyed and disabled: not a link, not focusable, its name read with "coming soon".
// The list, and what each needs when its feature lands:
// - Search (header field; on narrow screens an icon whose panel says it is coming): a search page or palette, its
//   route and policy (policy.ts), honest results (only what it really searches), then make the field a form and add it
//   to the e2e and axe pages.
// - The menu panel's Saved, Your communities and Help; the Create panel's New post, Share a link and Ask a question:
//   each a real flow or page with its route and policy; then make its row a link and add tests for it.
// - The Messages panel: a real list with counts, loading and error states (never a hard-coded "all caught up"); until
//   then it says the feature is coming, and its "open all" row stays disabled. Notifications has its list (P2.27).
// - Community, Explore (tabs below): a page each with its route and policy; move the entry from SOON_TABS to TABS
//   with its `active` value in ShellData, so aria-current and the underline follow, and add its denial and e2e tests.
const SOON_MENU = [
  { label: T.saved, icon: "saved" },
  { label: T.yourCommunities, icon: "community" },
  { label: T.help, icon: "help" },
] as const;
const SOON_CREATE = [
  { label: T.newPost, icon: "edit" },
  { label: T.shareLink, icon: "link" },
  { label: T.askQuestion, icon: "help" },
] as const;
const PANEL_BUTTONS = [
  { id: MESSAGES, label: T.messages, icon: "comment", empty: T.messagesSoon, all: T.openInbox },
  {
    id: NOTIFICATIONS,
    label: T.notifications,
    icon: "notifications",
    // Drawn by notificationsBody below, not by the coming-soon rows.
    empty: N.none,
    all: N.viewAll,
  },
] as const;
const SOON_TABS = [
  { label: T.community, icon: "community" },
  { label: T.explore, icon: "explore" },
] as const;
// The header's icon controls: 34px on a mouse, a 44px target on touch (Clean tabs handoff).
const control = "pointer-coarse:size-11";
// Every header panel: a native popover under the header, the popover surface, a title row, then rows.
const panel =
  "fixed top-16 bottom-auto m-0 w-80 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md open:flex max-sm:w-auto";
// The member the page passed (their own page and settings, with a name there) or the gate found (+layout.server.ts).
const account = $derived(shell.account ?? data.account);
// The bell's list and count (P2.27), read by +layout.server.ts on every page a member opens; undefined for a visitor.
const notes = $derived(data.notifications);
// Opening the bell marks what it shows seen (ADR 0085, 0090 and 0108): the badge goes at once and comes back only with
// a newer entry. The hidden form posts it in the background. A page that runs no script has no panel: its bell is a
// link to /notifications, whose own load marks it (ADR 0108 point 3).
const newest = $derived(notes?.state === "ready" ? notes.entries[0]?.id : undefined);
let seenUpTo = $state<string | undefined>(undefined);
const waiting = $derived(notes?.state === "ready" && newest !== seenUpTo ? notes.count : 0);
let seenForm = $state<HTMLFormElement | undefined>(undefined);
function markSeen(event: ToggleEvent): void {
  if (event.newState !== "open" || newest === undefined || waiting === 0) return;
  seenUpTo = newest;
  seenForm?.requestSubmit();
}
// The mark needs nothing back: the page stays as it is, and the next page's bell reads the stored mark. The action
// answers a 303, which enhance reads as a "redirect" result; anything else (a dropped connection gives an "error"
// result: @sveltejs/kit 3.2.0 src/runtime/app/forms/client.js, handle_submit's catch) stored nothing, so the badge
// comes back and the next opening tries again (Codex review of #1910).
const markInBackground: SubmitFunction =
  () =>
  async ({ result }) => {
    if (result.type !== "redirect") seenUpTo = undefined;
  };
// The chat icon (build step 10; ADR 0094 decision 5; Alex: no dock on a phone): for a member, Messages is a plain link to the chat page on
// its own origin, with the number of chats with new messages, on every width (no dock); a visitor keeps the panel.
const chat = $derived(data.chat);
// The chat box (ADR 0115; Alex 2026-11-23, "what I want to see is chat inside unset.sh"): on a wider screen the icon
// and a profile's Message link open the chat page in a frame on unset.cc's origin, here in the corner, instead of
// leaving; a phone keeps the plain link (Alex: no dock on a phone). The frame is made at the first open, so a page
// that never opens it runs no chat; it stays, hidden, while the member moves between pages. To sign in, the shell
// only points the frame at web's GET /chat/sign-in with the box's one-time value: the request is this origin's, so the
// session goes with it, and the ticket reaches the box by the redirect, never this script (chat box review D1; apps/chat
// core/dock.ts has the whole exchange). Each message is taken
// only from the frame's own window and origin (HTML web messaging: check source and origin). The icon's number is
// read again every half minute while the box is not open (GET /chat/count), and from the box once it runs.
const DOCK = "unset.dock.";
const WIDE = "(min-width: 40rem)";
const COUNT_EVERY_MS = 30_000;
const chatOrigin = $derived(chat === undefined ? "" : new URL(chat.href).origin);
let dockMade = $state(false);
let dockShown = $state(false);
let dockFrame: HTMLIFrameElement | undefined = $state();
/** What the box shows (apps/chat core/dock.ts DockMode): the list under the icon, a chat or its avatar at the corner. */
type DockMode = "list" | "conversation" | "bubble";
let dockMode: DockMode = $state("list");
const DOCK_PLACE: Record<DockMode, string> = {
  list: "top-20 h-[min(32rem,calc(100dvh-6rem))] w-96 rounded-lg border",
  conversation: "bottom-4 h-[min(36rem,calc(100dvh-6rem))] w-96 rounded-lg border",
  bubble: "bottom-4 size-14 rounded-full",
};
let liveUnread: number | undefined = $state();
/**
 * Whether the box sends the count: from its first count on. A box that never gets that far (chat open in another tab,
 * or a failed sign-in) leaves the poll running, so the icon's number stays current (Codex review on cdb237c1).
 */
let dockCounting = false;
const unread = $derived(liveUnread ?? chat?.unread ?? 0);
/** A Message link's DID, sent with the hello when the box's page loads. */
let dockAsk: string | undefined;

/**
 * Whether the frame holds the box's page on the chat origin: from its load event (which follows the hop's redirects)
 * until the shell sends it on another hop. Before that the frame is about:blank or the hop on unset.sh, and a message
 * to the chat origin would only be dropped with a console warning (HTML "Cross-document messaging", postMessage
 * step 8, https://html.spec.whatwg.org/multipage/web-messaging.html, read 2026-11-23; Alex's staging list item 6).
 */
let dockGreeted = false;
/** The chat icon was pressed before the box's page loaded: show the list once it has. */
let dockAskList = false;

function toDock(data: Record<string, unknown>) {
  if (dockGreeted) dockFrame?.contentWindow?.postMessage(data, chatOrigin);
}

/** Open the box (and the conversation with `did`); false on a phone or with no chat, where the link is followed. */
function openDock(did?: string): boolean {
  if (chat === undefined || !window.matchMedia(WIDE).matches) return false;
  dockMade = true;
  dockShown = true;
  if (did !== undefined) {
    if (dockFrame?.contentWindow) toDock({ type: `${DOCK}open`, did });
    dockAsk = did;
  }
  return true;
}

/**
 * The chat icon (the mock-up's "Later: the menu and chat box"): it shows the list under it; pressed again it goes back
 * to the chat (or its avatar) the list covered, or closes. The box decides which, as it knows what it covered.
 */
function chatClick(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!dockMade || !dockShown) {
    if (!openDock()) return;
    event.preventDefault();
    if (dockGreeted) toDock({ type: `${DOCK}list` });
    else dockAskList = true;
    return;
  }
  event.preventDefault();
  toDock({ type: dockMode === "list" ? `${DOCK}back` : `${DOCK}list` });
}

/** A click on a profile's Message link (`<door>/dm/<did>`, apps/web profile-header.svelte) opens it in the box. */
function messageLinkClick(event: MouseEvent) {
  if (chat === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  const url = new URL(link.href);
  if (url.origin !== chatOrigin || !url.pathname.startsWith("/dm/")) return;
  if (openDock(decodeURIComponent(url.pathname.slice("/dm/".length)))) event.preventDefault();
}

/**
 * Log out with a box running (chat box review D3): the box logs out in its own storage first (its backup catches up,
 * its device ends, its stores go), since the chat page's own Log out runs on unset.cc's top level, which cannot reach
 * the box's partition. Then the form is posted as usual; web's queued end is the fallback if the box does not answer.
 */
let loggingOut: (() => void) | undefined;
const DOCK_LOG_OUT_MS = 20_000;
function logOutDock(event: SubmitEvent) {
  const form = event.currentTarget as HTMLFormElement;
  if (dockFrame?.contentWindow == null || !dockGreeted || loggingOut !== undefined) return;
  event.preventDefault();
  const done = () => form.submit();
  const timer = window.setTimeout(done, DOCK_LOG_OUT_MS);
  loggingOut = () => {
    window.clearTimeout(timer);
    done();
  };
  toDock({ type: `${DOCK}log_out` });
}

/** The box's page has loaded (again, after a renewal): say hello first, so the box learns this origin from us. */
function dockLoaded() {
  dockGreeted = true;
  toDock({ type: `${DOCK}hello` });
  toDock({ type: `${DOCK}theme`, theme: current });
  toDock({ type: `${DOCK}shown`, shown: dockShown });
  if (dockAsk !== undefined) toDock({ type: `${DOCK}open`, did: dockAsk });
  else if (dockAskList) toDock({ type: `${DOCK}list` });
  dockAskList = false;
}

// Hiding the box leaves its page "visible" to itself, so it is told, and sends read receipts only while open
// (apps/chat core/dock.ts boxVisibility).
$effect(() => {
  toDock({ type: `${DOCK}shown`, shown: dockShown });
});

// The light / dark / device switch is one setting everywhere (Alex 2026-11-23): the box follows each change.
$effect(() => {
  toDock({ type: `${DOCK}theme`, theme: current });
});

function dockMessage(event: MessageEvent) {
  if (dockFrame?.contentWindow == null || event.source !== dockFrame.contentWindow || event.origin !== chatOrigin)
    return;
  const message = event.data as { type?: unknown; state?: unknown; unread?: unknown; mode?: unknown } | null;
  if (typeof message !== "object" || message === null) return;
  if (message.type === `${DOCK}sign_in` && typeof message.state === "string") {
    // web checks the value's form; the frame comes back on the box's page, which says hello again.
    dockGreeted = false;
    dockFrame.src = `/chat/sign-in?${new URLSearchParams({ state: message.state, dock: "" })}`;
  } else if (
    message.type === `${DOCK}count` &&
    typeof message.unread === "number" &&
    Number.isSafeInteger(message.unread)
  ) {
    dockCounting = true;
    liveUnread = Math.max(0, message.unread);
  } else if (message.type === `${DOCK}count_stopped`) {
    // The box's client ended (chat taken over by another tab, signed out, failed): the poll takes the count back.
    dockCounting = false;
  } else if (message.type === `${DOCK}close`) {
    dockShown = false;
  } else if (message.type === `${DOCK}layout` && typeof message.mode === "string" && message.mode in DOCK_PLACE) {
    dockMode = message.mode as DockMode;
  } else if (message.type === `${DOCK}logged_out`) {
    loggingOut?.();
  }
}

$effect(() => {
  if (chat === undefined) return;
  const timer = window.setInterval(async () => {
    if (document.visibilityState !== "visible" || dockCounting) return;
    try {
      const response = await fetch("/chat/count", { cache: "no-store", redirect: "error" });
      const body = (await response.json()) as { unread?: unknown };
      if (response.ok && typeof body.unread === "number" && Number.isSafeInteger(body.unread)) liveUnread = body.unread;
    } catch {
      // The number stays as it was; the next page load reads it again.
    }
  }, COUNT_EVERY_MS);
  return () => window.clearInterval(timer);
});
const panelButtons = $derived(chat === undefined ? PANEL_BUTTONS : PANEL_BUTTONS.filter((b) => b.id !== MESSAGES));
// The count on the bell and on More actions (which opens the same panel on a phone): read in the button's name,
// drawn as shadcn's stock Badge, made small and pinned to the button's corner.
const badge =
  "pointer-events-none absolute -top-1.5 -right-1.5 min-w-4.5 px-1 py-0 text-[0.6875rem] leading-4 font-semibold";
const letter = $derived(account?.name === undefined ? undefined : accountLetter(account.name));
// A client navigation keeps the layout, drawer included, so the drawer is closed once the new page is in, as the
// Hono shell's Navigation did (shared/ui/components/Navigation/Navigation.tsx, hidePopover on navigation).
afterNavigate(() => {
  // A page load read the icon's number afresh; the box, once running, keeps telling its own.
  if (!dockCounting) liveUnread = undefined;
  for (const id of [MENU, ACCOUNT, ACTIONS, CREATE, MESSAGES, NOTIFICATIONS, SEARCH]) {
    const popover = document.getElementById(id);
    if (popover?.matches(":popover-open")) popover.hidePopover();
  }
});
// A client navigation keeps the document too, and with it the theme the server drew the first page with. The server
// draws a page every visitor shares in the system's theme and a page with the theme form in the choice
// (hooks.server.ts readsTheme, +layout.server.ts prefs), so the page now shown gets the one a full load of it would
// have. It matters since the public profile runs the client (P1.22e): its Sign in link is followed in place.
afterNavigate(({ type }) => {
  if (type !== "enter") applyTheme(prefs === undefined ? "system" : current);
});
// A tab that has seen a newer build (SvelteKit checks version.json when the tab is shown or focused, and reads the
// version on every data response) loads the next page in full, as kit 3.2.0 documents for version.name
// (src/exports/vite/public.d.ts, "version"): the old tab's pieces may be gone after a deploy (P1.21g, ADR 0069), or
// still loaded and older than the server's data. Each click sets the address at once and cancels the client
// navigation, whose failed import would later load its own page in full (load_route), so the last one pressed wins.
// Back and Forward and forms keep SvelteKit's own handling, which also falls back to a full load when a piece is gone.
beforeNavigate(({ type, to, cancel }) => {
  if (!updated.current || (type !== "link" && type !== "goto") || to?.url === undefined) return;
  cancel();
  location.href = to.url.href;
});
// A footer link is a 24px target (WCAG 2.2 SC 2.5.8): its 20px line plus 2px above and below.
const footerLink = "py-0.5";
// A menu row: a link drawn as a row, not as text, so it keeps the foreground colour and no underline; muted marks hover
// and the current page, since the menus' own surface is the accent colour.
const row =
  "flex items-center gap-3 rounded-md px-3 py-2 text-foreground no-underline hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium";
</script>

<svelte:window onpageshow={restoreSaved} onmessage={dockMessage} onclickcapture={messageLinkClick} />

<svelte:head>
  <!-- As the Hono head had them (apps/web/src/shell/head.tsx): both fonts preloaded, in anonymous CORS mode because a
       font is fetched that way even from our own origin and a preload is reused only when its mode matches (MDN
       rel="preload"); the icons as files under /_app/ (vite.config.ts inlines nothing). -->
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/SpaceGrotesk-Variable.woff2" />
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/JetBrainsMono-Variable.woff2" />
  <link rel="icon" href={favicon} sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href={appleTouchIcon} />
  {#if shell.noindex || data.siteNoindex}<meta name="robots" content="noindex" />{/if}
</svelte:head>

{#snippet themeForm()}
  <form method="post" action="/prefs/theme" class="flex flex-col gap-2">
    <fieldset class="flex flex-col gap-1">
      <legend class="mb-1 text-sm font-medium">{T.theme}</legend>
      {#each THEMES as option (option.value)}
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="theme" value={option.value} checked={prefs?.theme === option.value} />
          {option.label}
        </label>
      {/each}
    </fieldset>
    <input type="hidden" name="return" value={prefs?.returnTo ?? "/"} />
    <Button type="submit" variant="outline" size="sm">{T.saveTheme}</Button>
  </form>
{/snippet}

{#snippet themePicker()}
  <!-- The account menu's picker (P2.13e; Figma 151:939 option A): three buttons in one group that each POST their choice, so
       it works with no script; the chosen one is pressed. -->
  <form method="post" action="/prefs/theme" use:enhance={saveInPlace}>
    <input type="hidden" name="return" value={prefs?.returnTo ?? "/"} />
    <fieldset class="grid grid-cols-3 gap-0.5 rounded-md border p-0.5">
      <legend class="sr-only">{T.theme}</legend>
      {#each PICKER as choice (choice.value)}
        <Button
          type="submit"
          name="theme"
          value={choice.value}
          variant="ghost"
          size="sm"
          aria-pressed={choice.value === current}
          class="gap-1.5 px-2 font-normal pointer-coarse:h-11 aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:ring-1 aria-pressed:ring-border"
        >
          <Icon name={choice.icon} size={16} /><span>{choice.label}</span>
        </Button>
      {/each}
    </fieldset>
  </form>
{/snippet}

{#snippet content()}
  {#if data.privacyNotice !== null}
    <!-- The changed privacy notice (P2.12b): on whatever app page the member opens, until they dismiss it or accept
         newer terms. The dismiss is a plain form, so it works with no script; a GET never records it. -->
    <Alert.Root class="mb-6">
      <Alert.Title>{T.privacyNoticeTitle}</Alert.Title>
      <Alert.Description class="flex flex-wrap items-center justify-between gap-2">
        <a href="/legal/privacy">{T.privacyNotice}</a>
        <form method="post" action="/privacy-notice/seen">
          <input type="hidden" name="version" value={data.privacyNotice} />
          <input type="hidden" name="return" value={prefs?.returnTo ?? "/me"} />
          <Button type="submit" variant="outline" size="sm">{T.privacyNoticeDismiss}</Button>
        </form>
      </Alert.Description>
    </Alert.Root>
  {/if}
  {#if message !== undefined}
    <Alert.Root variant="destructive" class="mb-6"><Alert.Description>{message}</Alert.Description></Alert.Root>
  {/if}
  {#if shell.hiddenHeading !== undefined}<h1 class="sr-only">{shell.hiddenHeading}</h1>{/if}
  {@render children()}
{/snippet}

{#if shell.kind === "bare"}
  <main id="main" class="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-8">
    {@render content()}
  </main>
{:else}
<a
  href="#main"
  class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
  >{T.skip}</a
>

{#if shell.kind === "core"}
  <!-- The core shell's header (P1.20k; Alex, 2026-11-18, "Clean tabs", and the planned menus he sent at 05:04Z): the
       menu button and wordmark, the action buttons and account menu at the right edge, and a row of main destinations
       below. Every menu is a native popover with a title and a close button, so it opens with no script, closes on
       Escape or a click outside, and gives focus back to its button. Only what runs today is a link; the rest is drawn
       disabled, as SOON_ACTIONS, SOON_TABS and the panels list them. It sticks to the top of the page as it scrolls
       (Alex, 2026-11-20), at a fixed height that app.css names as --site-header-height, so anchors land below it and a
       bar can stick under it; it sits outside the page's wrapper so the footer never pushes it off. -->
  <header data-site-header="core" class="sticky top-0 z-40 border-b bg-secondary">
    <div class="flex h-18 items-center gap-4 px-5.5 max-md:gap-3 max-md:px-4 max-sm:gap-1.5 max-sm:px-2">
      <div class="flex items-center gap-3.5 max-md:gap-2.5 max-sm:gap-1.5">
        <Button variant="outline" size="icon-sm" popovertarget={MENU} popovertargetaction="toggle" class={control}>
          <Icon name="menu" size={20} label={T.menu} />
        </Button>
        <a href="/" class="font-mono text-xl font-semibold whitespace-nowrap max-sm:text-lg text-foreground no-underline" aria-label={T.homeLabel}
          >{T.brandName}<span class="font-normal text-muted-foreground">{T.brandSuffix}</span></a
        >
      </div>
      <button
        type="button"
        disabled
        class="ml-auto flex h-8 w-70 max-w-85 min-w-38 shrink items-center gap-2 rounded-md border bg-background px-2.5 text-left text-sm text-muted-foreground opacity-60 pointer-coarse:h-11 max-md:w-58 max-sm:hidden"
      >
        <Icon name="search" size={16} /><span class="truncate" aria-hidden="true">{T.search}</span>
        <span class="sr-only">{T.search}, {T.comingSoon}</span>
      </button>
      <div class="flex items-center gap-2 max-sm:ml-auto max-sm:gap-1.5">
        <!-- On a phone a disabled icon says nothing to a finger, so it opens a panel that says search is coming
             (staging walkthrough 2026-11-19), as Messages and Notifications do. A member's phone has the chat link
             instead, which works today, and finds this panel under More actions, so the bar fits 320px. -->
        {#if chat === undefined}
          <Button
            variant="outline"
            size="icon-sm"
            popovertarget={SEARCH}
            popovertargetaction="toggle"
            class="{control} sm:hidden"
          >
            <Icon name="search" size={20} label="{T.search}, {T.comingSoon}" />
          </Button>
        {/if}
        <Button
          variant="outline"
          size="sm"
          popovertarget={CREATE}
          popovertargetaction="toggle"
          class="h-8 gap-1 px-2 pointer-coarse:h-11 max-sm:hidden"
        >
          <Icon name="add" size={20} label={T.create} /><Icon name="open" size={16} />
        </Button>
        {#if chat !== undefined}
          <Button
            variant="outline"
            size="icon-sm"
            href={chat.href}
            class="{control} relative"
            onclick={chatClick}
            aria-expanded={dockMade ? dockShown : undefined}
          >
            <Icon name="comment" size={20} label={T.chat(unread)} />
            {#if unread > 0}<Badge aria-hidden="true" class={badge}>{N.badge(unread)}</Badge>{/if}
          </Button>
        {/if}
        {#each panelButtons as button (button.id)}
          {#if button.id === NOTIFICATIONS && !data.bellOpens}
            <!-- ADR 0108 point 3: with no script on this page, the bell is the way to the page, whose visit marks it seen. -->
            <Button variant="outline" size="icon-sm" href="/notifications" class="{control} relative max-sm:hidden">
              <Icon name={button.icon} size={20} label={N.bell(waiting)} />
              {#if waiting > 0}<Badge aria-hidden="true" class={badge}>{N.badge(waiting)}</Badge>{/if}
            </Button>
          {:else}
            <Button
              variant="outline"
              size="icon-sm"
              popovertarget={button.id}
              popovertargetaction="toggle"
              class="{control} relative max-sm:hidden"
            >
              <Icon name={button.icon} size={20} label={button.id === NOTIFICATIONS ? N.bell(waiting) : button.label} />
              {#if button.id === NOTIFICATIONS && waiting > 0}<Badge aria-hidden="true" class={badge}>{N.badge(waiting)}</Badge>{/if}
            </Button>
          {/if}
        {/each}
        <Button
          variant="outline"
          size="icon-sm"
          popovertarget={ACTIONS}
          popovertargetaction="toggle"
          class="{control} relative sm:hidden"
        >
          <Icon name="more" size={20} label={waiting > 0 ? `${T.moreActions}, ${N.bell(waiting)}` : T.moreActions} />
          {#if waiting > 0}<Badge aria-hidden="true" class={badge}>{N.badge(waiting)}</Badge>{/if}
        </Button>
        {#if account !== undefined}
          <Button
            variant="outline"
            size="icon-sm"
            popovertarget={ACCOUNT}
            popovertargetaction="toggle"
            class="{control} rounded-full bg-muted font-semibold"
          >
            {#if letter !== undefined}<span aria-hidden="true">{letter}</span>{:else}<Icon name="profile" size={20} />{/if}
            <span class="sr-only">{T.accountMenu}</span>
          </Button>
        {:else}
          <!-- A visitor signs in here and comes back to this page (signInHref, +layout.server.ts). -->
          <Button variant="outline" size="icon-sm" href={data.signInHref} class={control}>
            <Icon name="profile" size={20} label={T.signIn} />
          </Button>
        {/if}
      </div>
    </div>
    <nav aria-label={T.mainNav} class="flex h-11.5 items-stretch gap-2 px-5 max-md:px-3 max-sm:gap-1 max-sm:px-2">
      {#each TABS as tab (tab.href)}
        <a
          href={tab.href}
          aria-current={shell.active === tab.active ? "page" : undefined}
          class="relative flex items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap text-foreground no-underline transition-colors duration-120 hover:bg-muted motion-reduce:transition-none aria-[current=page]:font-semibold aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.75 aria-[current=page]:after:rounded-sm aria-[current=page]:after:bg-primary"
        >
          <Icon name={tab.icon} size={16} class="text-muted-foreground" /><span>{tab.label}</span>
        </a>
      {/each}
      {#each SOON_TABS as tab (tab.label)}
        <!-- Muted text with no extra fading: unlike a disabled button, plain text is held to 4.5:1 (WCAG 1.4.3). The words
             are one string for assistive technology, since a gap between two flex items reads as a space. -->
        <span class="flex items-center gap-2 px-3 text-sm whitespace-nowrap text-muted-foreground max-sm:px-2.5"
          ><Icon name={tab.icon} size={16} /><span aria-hidden="true">{tab.label}</span><span class="sr-only"
            >{tab.label}, {T.comingSoon}</span
          ></span
        >
      {/each}
    </nav>
  </header>
  <div class="flex min-h-[calc(100svh-var(--site-header-height))] flex-col">
  {#snippet soonRow(item: { label: string; icon: IconName })}
    <li>
      <button type="button" disabled class="{row} w-full text-muted-foreground opacity-60">
        <!-- One string for assistive technology, since a gap between two flex items reads as a space. -->
        <Icon name={item.icon} size={20} /><span aria-hidden="true">{item.label}</span>
        <span class="ml-auto text-xs" aria-hidden="true">{T.comingSoon}</span><span class="sr-only"
          >{item.label}, {T.comingSoon}</span
        >
      </button>
    </li>
  {/snippet}
  {#snippet notificationsBody()}
    <!-- P2.27, ADR 0081: the newest few, each a link to its detail on the page, Dismiss all, and the page. A visitor is told to sign in
         (the header's Sign in button is the one link for it). A failed read says so; the empty text comes from a real,
         empty list. -->
    {#if notes === undefined}
      <p class="px-3 pt-1 pb-3 text-sm text-muted-foreground">{N.visitor}</p>
    {:else}
      {#if notes.state === "failed"}
        <p role="alert" class="px-3 pt-1 pb-3 text-sm text-muted-foreground">{N.failed}</p>
      {:else if notes.entries.length === 0}
        <p class="px-3 pt-1 pb-3 text-sm text-muted-foreground">{N.none}</p>
      {:else}
        <NotificationList entries={notes.entries} />
        <div class="flex justify-end px-1"><DismissAll entries={notes.entries} returnTo={page.url.pathname} /></div>
      {/if}
      <ul class="flex flex-col gap-1 border-t pt-1">
        <li>
          <a href="/notifications" class={row} aria-current={page.url.pathname === "/notifications" ? "page" : undefined}
            ><Icon name="next" size={20} /><span>{N.viewAll}</span></a
          >
        </li>
      </ul>
    {/if}
  {/snippet}
  {#snippet panelTitle(id: string, title: string, focusClose: boolean)}
    <div class="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
      <h2 id="{id}-title" class="font-semibold">{title}</h2>
      {#if focusClose}
        <!-- svelte-ignore a11y_autofocus -- nothing in this panel runs yet, so focus lands on its close button -->
        <Button variant="ghost" size="icon-sm" autofocus popovertarget={id} popovertargetaction="hide" class={control}>
          <Icon name="close" size={20} label="{T.close} {title}" />
        </Button>
      {:else}
        <Button variant="ghost" size="icon-sm" popovertarget={id} popovertargetaction="hide" class={control}>
          <Icon name="close" size={20} label="{T.close} {title}" />
        </Button>
      {/if}
    </div>
  {/snippet}
  <section id={MENU} popover="auto" aria-labelledby="{MENU}-title" class="{panel} right-auto left-3 max-sm:right-2 max-sm:left-2">
    {@render panelTitle(MENU, T.more, true)}
    <ul class="flex flex-col gap-1">
      {#each SOON_MENU as item (item.label)}{@render soonRow(item)}{/each}
    </ul>
  </section>
  <section id={CREATE} popover="auto" ontoggle={backToActions} aria-labelledby="{CREATE}-title" class="{panel} right-3 left-auto max-sm:right-2 max-sm:left-2">
    {@render panelTitle(CREATE, T.create, false)}
    <ul class="flex flex-col gap-1">
      {#each SOON_CREATE as item (item.label)}{@render soonRow(item)}{/each}
    </ul>
    <ul class="mt-1 flex flex-col gap-1 border-t pt-1">
      <li>
        <!-- svelte-ignore a11y_autofocus -- the one item that runs today takes focus when the menu opens -->
        <a href={account === undefined ? "/me" : `${account.path}?add#${PANEL_ANCHOR}`} class={row} autofocus>
          <Icon name="apps" size={20} /><span>{T.addCard}</span>
        </a>
      </li>
    </ul>
  </section>
  {#each panelButtons.filter((b) => b.id !== NOTIFICATIONS || data.bellOpens) as button (button.id)}
    <section
      id={button.id}
      popover="auto"
      ontoggle={(event) => {
        backToActions(event);
        if (button.id === NOTIFICATIONS) markSeen(event);
      }}
      aria-labelledby="{button.id}-title"
      class="{panel} right-3 left-auto max-sm:right-2 max-sm:left-2"
    >
      {@render panelTitle(button.id, button.label, true)}
      {#if button.id === NOTIFICATIONS}
        {@render notificationsBody()}
        {#if newest !== undefined}
          <form bind:this={seenForm} method="POST" action="/notifications?/seen" hidden use:enhance={markInBackground}>
            <input type="hidden" name="upTo" value={newest} />
          </form>
        {/if}
      {:else}
        <p class="px-3 pt-1 pb-3 text-sm text-muted-foreground">{button.empty}</p>
        <ul class="flex flex-col gap-1 border-t pt-1">{@render soonRow({ label: button.all, icon: "next" })}</ul>
      {/if}
    </section>
  {/each}
  <section id={SEARCH} popover="auto" ontoggle={backToActions} aria-labelledby="{SEARCH}-title" class="{panel} right-2 left-2 w-auto sm:hidden">
    {@render panelTitle(SEARCH, T.search, true)}
    <p class="px-3 pt-1 pb-3 text-sm text-muted-foreground">{T.searchSoon}</p>
  </section>
  <section id={ACTIONS} popover="auto" aria-labelledby="{ACTIONS}-title" class="{panel} right-2 left-2 w-auto">
    {@render panelTitle(ACTIONS, T.moreActions, false)}
    <ul class="flex flex-col gap-1">
      <li>
        <!-- svelte-ignore a11y_autofocus -- focus belongs inside the menu it opens -->
        <button type="button" popovertarget={CREATE} popovertargetaction="show" class="{row} w-full" autofocus>
          <Icon name="add" size={20} /><span>{T.create}</span>
        </button>
      </li>
      {#if chat !== undefined}
        <li>
          <button type="button" popovertarget={SEARCH} popovertargetaction="show" class="{row} w-full">
            <Icon name="search" size={20} /><span>{T.search}</span>
          </button>
        </li>
      {/if}
      {#each panelButtons as button (button.id)}
        <li>
          {#if button.id === NOTIFICATIONS && !data.bellOpens}
            <a href="/notifications" class="{row} w-full">
              <Icon name={button.icon} size={20} /><span>{button.label}</span>
              {#if waiting > 0}<span class="ml-auto text-xs text-muted-foreground"
                  ><span aria-hidden="true">{N.badge(waiting)}</span><span class="sr-only">{N.bell(waiting)}</span></span
                >{/if}
            </a>
          {:else}
            <button type="button" popovertarget={button.id} popovertargetaction="show" class="{row} w-full">
              <Icon name={button.icon} size={20} /><span>{button.label}</span>
              {#if button.id === NOTIFICATIONS && waiting > 0}<span class="ml-auto text-xs text-muted-foreground"
                  ><span aria-hidden="true">{N.badge(waiting)}</span><span class="sr-only">{N.bell(waiting)}</span></span
                >{/if}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
  {#if account !== undefined}
    <section id={ACCOUNT} popover="auto" aria-labelledby="{ACCOUNT}-title" class="{panel} right-3 left-auto max-sm:right-2 max-sm:left-2">
      {@render panelTitle(ACCOUNT, T.account, false)}
      {#if account.name}<p class="truncate px-3 pb-2 font-medium" title={account.name}>{account.name}</p>{/if}
      <ul class="flex flex-col gap-1">
        <li>
          <!-- svelte-ignore a11y_autofocus -- focus belongs inside the menu it opens, so Escape returns it to the avatar -->
          <a href={account.path} class={row} autofocus aria-current={shell.active === "account" ? "page" : undefined}>
            <Icon name="profile" size={20} /><span>{T.yourProfile}</span>
          </a>
        </li>
        <li>
          <a href="/settings/profile" class={row} aria-current={shell.active === "settings" ? "page" : undefined}>
            <Icon name="settings" size={20} /><span>{T.settings}</span>
          </a>
        </li>
      </ul>
      {#if prefs !== undefined}
        <!-- As the planned menu draws it (Alex, 2026-11-18 05:04Z): Appearance with the current choice in words, then
             the three choices, each with its name beside its icon. -->
        <div class="mt-1 flex flex-col gap-2 border-t px-3 pt-2 pb-1">
          <p class="flex items-center gap-3 text-sm">
            <Icon name={PICKER_ICON[current]} size={20} /><span>{T.appearance}</span>
            <span class="ml-auto text-muted-foreground">{PICKER_LABEL[current]}</span>
          </p>
          {@render themePicker()}
        </div>
      {/if}
      <form method="post" action="/logout" class="mt-1 border-t pt-1" onsubmit={logOutDock}>
        <Button type="submit" variant="ghost" class="h-auto w-full justify-start gap-3 px-3 py-2 font-normal">
          <Icon name="signout" size={20} /><span>{T.signOut}</span>
        </Button>
      </form>
    </section>
  {/if}
  <main id="main" tabindex="-1" class="mx-auto w-full flex-1 py-8 {shell.wide ? 'px-5.5 max-md:px-4' : 'max-w-3xl px-4'}">{@render content()}</main>
  </div>
  {#if dockMade && chat !== undefined}
    <!-- The chat box (ADR 0115): sandboxed, so it can never navigate this page; it may open the full chat in a new tab. -->
    <div
      class="fixed right-4 z-50 overflow-hidden bg-background shadow-lg {DOCK_PLACE[dockMode]}"
      hidden={!dockShown}
      data-dock
    >
      <iframe
        bind:this={dockFrame}
        onload={dockLoaded}
        data-mode={dockMode}
        src="{chatOrigin}/?dock"
        title={T.chat(0)}
        class="size-full"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      ></iframe>
    </div>
  {/if}
  <!-- Below the first screen on every page, short ones too: the header and main fill the viewport (Alex, 2026-11-18). -->
  <footer class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-5.5 py-6 text-sm text-muted-foreground max-sm:px-4">
    <p>{T.note}</p>
    <nav aria-label={T.legalColumn}>
      <ul class="flex flex-wrap gap-x-5 gap-y-1">
        {#each LEGAL as link (link.href)}
          <li><a href={link.href} class="{footerLink} text-muted-foreground hover:text-foreground">{link.label}</a></li>
        {/each}
      </ul>
    </nav>
  </footer>
{:else}
  <!-- Sticky too, at --site-header-height (app.css), outside the page's wrapper as in the core shell. -->
  <header data-site-header="site" class="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4">
      <a href="/" class="font-mono font-semibold text-foreground" aria-label={T.homeLabel}>{T.brand}</a>
      {#if !signedIn}<Button href={data.signInHref} size="sm">{T.signIn}</Button>{/if}
  </header>
  <div class="flex min-h-[calc(100svh-var(--site-header-height))] flex-col">
    <main id="main" class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{@render content()}</main>
  </div>
  <!-- As in the core shell: the footer starts below the first screen. -->
  <footer class="flex flex-wrap gap-8 border-t px-4 py-8 text-sm">
    <div class="flex flex-col gap-2">
      <h2 class="font-medium">{T.siteColumn}</h2>
      <a href="/" class={footerLink}>{T.home}</a>
      {#if !signedIn}<a href={data.signInHref} class={footerLink}>{T.signIn}</a>{/if}
    </div>
    <div class="flex flex-col gap-2">
      <h2 class="font-medium">{T.legalColumn}</h2>
      {#each LEGAL as link (link.href)}<a href={link.href} class={footerLink}>{link.label}</a>{/each}
    </div>
    {#if prefs !== undefined}<div>{@render themeForm()}</div>{/if}
    <p class="w-full text-muted-foreground">{T.note}</p>
  </footer>
{/if}
{/if}
