<!--
  The shell of every page (P1.20d), as apps/web/src/shell/AppShell.tsx draws it today; src/lib/shell.ts says what a
  page passes. The page's own load returns `shell`; the error page and any page that passes nothing get the site shell.
  Neither shell offers Sign in when the gate read a live session for the route (+layout.server.ts). Everything here works with no script: links, plain forms, and a native popover for the menu drawer
  (https://html.spec.whatwg.org/multipage/popover.html). The `?error=` callout shows only the catalog's text.
-->
<script lang="ts">
import "@unset/apps-web/app.css";
import { Icon } from "@unset/apps-web/lib/components/icon";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import appleTouchIcon from "@unset/apps-web/lib/icons/unset-apple-touch-icon.png";
import favicon from "@unset/apps-web/lib/icons/unset-favicon-32.png";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import type { Snippet } from "svelte";
import { enhance, type SubmitFunction } from "$app/forms";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";
import { accountLetter, type ShellData, SITE_SHELL, SHELL_TEXT as T, type ThemeChoice } from "../lib/shell.ts";
import type { LayoutData } from "./$types";

let { data, children }: { data: LayoutData; children: Snippet } = $props();

const shell: ShellData = $derived((page.data as { shell?: ShellData }).shell ?? SITE_SHELL);
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

// A page the back-forward cache restores keeps the theme it was left with; this tab's last save replaces it.
function restoreSaved(event: PageTransitionEvent): void {
  const last = event.persisted ? rememberedTheme() : null;
  if (last === null) return;
  applyTheme(last);
  saved = last;
}

const MENU = "core-menu";
const ACCOUNT = "account-menu";
// The core header's main destinations (Clean tabs): only those that run today.
const TABS = [{ label: T.home, href: "/", icon: "home", active: "home" }] as const;
// The header's icon controls: 34px on a mouse, a 44px target on touch (Clean tabs handoff).
const control = "pointer-coarse:size-11";
const letter = $derived(shell.account?.name === undefined ? undefined : accountLetter(shell.account.name));
// A client navigation keeps the layout, drawer included, so the drawer is closed once the new page is in, as the
// Hono shell's Navigation did (shared/ui/components/Navigation/Navigation.tsx, hidePopover on navigation).
afterNavigate(() => {
  for (const id of [MENU, ACCOUNT]) {
    const popover = document.getElementById(id);
    if (popover?.matches(":popover-open")) popover.hidePopover();
  }
});
// A footer link is a 24px target (WCAG 2.2 SC 2.5.8): its 20px line plus 2px above and below.
const footerLink = "py-0.5";
// A menu row: a link drawn as a row, not as text, so it keeps the foreground colour and no underline; muted marks hover
// and the current page, since the menus' own surface is the accent colour.
const row =
  "flex items-center gap-3 rounded-md px-3 py-2 text-foreground no-underline hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium";
</script>

<svelte:window onpageshow={restoreSaved} />

<svelte:head>
  <!-- As the Hono head had them (apps/web/src/shell/head.tsx): both fonts preloaded, in anonymous CORS mode because a
       font is fetched that way even from our own origin and a preload is reused only when its mode matches (MDN
       rel="preload"); the icons as files under /_app/ (vite.config.ts inlines nothing). -->
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/SpaceGrotesk-Variable.woff2" />
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/JetBrainsMono-Variable.woff2" />
  <link rel="icon" href={favicon} sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href={appleTouchIcon} />
  {#if shell.noindex}<meta name="robots" content="noindex" />{/if}
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
    <fieldset class="inline-flex rounded-md border p-0.5">
      <legend class="sr-only">{T.theme}</legend>
      {#each PICKER as choice (choice.value)}
        <Button
          type="submit"
          name="theme"
          value={choice.value}
          variant="ghost"
          size="icon"
          aria-pressed={choice.value === current}
          title={choice.label}
          class="aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-border"
        >
          <Icon name={choice.icon} size={20} label={choice.label} />
        </Button>
      {/each}
    </fieldset>
  </form>
{/snippet}

{#snippet content()}
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
  <!-- The core shell's header (P1.20k; Alex, 2026-11-18, "Clean tabs"): the menu button and wordmark, the account menu
       at the right edge, and a row of main destinations below. Both menus are native popovers, so they open with no
       script, close on Escape or a click outside, and give focus back to their button. Only destinations that run
       today are linked: search, create, messages, notifications, Community and Explore come with their features. -->
  <header class="border-b bg-secondary">
    <div class="flex min-h-18 items-center gap-4 px-5.5 max-md:px-4 max-sm:gap-2 max-sm:px-3">
      <div class="flex items-center gap-3.5 max-md:gap-2.5 max-sm:gap-2">
        <Button variant="outline" size="icon-sm" popovertarget={MENU} popovertargetaction="toggle" class={control}>
          <Icon name="menu" size={20} label={T.menu} />
        </Button>
        <a href="/" class="font-mono text-xl font-semibold whitespace-nowrap text-foreground no-underline" aria-label={T.homeLabel}
          >{T.brandName}<span class="font-normal text-muted-foreground">{T.brandSuffix}</span></a
        >
      </div>
      <div class="ml-auto flex items-center gap-2">
        {#if shell.account !== undefined}
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
          <Button
            variant="outline"
            size="icon-sm"
            href="/me"
            class={control}
            aria-current={shell.active === "account" ? "page" : undefined}
          >
            <Icon name="profile" size={20} label={T.profile} />
          </Button>
        {/if}
      </div>
    </div>
    <nav aria-label={T.mainNav} class="flex min-h-11.5 items-stretch gap-2 px-5 max-md:px-3 max-sm:gap-1 max-sm:px-2">
      {#each TABS as tab (tab.href)}
        <a
          href={tab.href}
          aria-current={shell.active === tab.active ? "page" : undefined}
          class="relative flex items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap text-foreground no-underline transition-colors duration-120 hover:bg-muted motion-reduce:transition-none aria-[current=page]:font-semibold aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.75 aria-[current=page]:after:rounded-sm aria-[current=page]:after:bg-primary"
        >
          <Icon name={tab.icon} size={16} class="text-muted-foreground" /><span>{tab.label}</span>
        </a>
      {/each}
    </nav>
  </header>
  <nav
    id={MENU}
    popover="auto"
    aria-label={T.more}
    class="fixed inset-y-0 left-0 m-0 h-full w-72 max-w-[85vw] flex-col gap-4 border-r bg-background p-4 text-foreground open:flex"
  >
    <div class="flex items-center justify-between">
      <a href="/" class="font-mono font-semibold text-foreground no-underline" aria-label={T.homeLabel}>{T.brand}</a>
      <!-- svelte-ignore a11y_autofocus -- focus belongs inside the drawer it opens, so Escape returns it to the menu button -->
      <Button variant="ghost" size="icon" autofocus popovertarget={MENU} popovertargetaction="hide">
        <Icon name="close" size={24} label={T.closeMenu} />
      </Button>
    </div>
    <ul class="flex flex-col gap-1">
      {#each LEGAL as link (link.href)}
        <li><a href={link.href} class={row}><span>{link.label}</span></a></li>
      {/each}
    </ul>
  </nav>
  {#if shell.account !== undefined}
    <section
      id={ACCOUNT}
      popover="auto"
      aria-label={T.account}
      class="fixed top-16 right-3 bottom-auto left-auto m-0 w-72 flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md open:flex max-sm:right-2 max-sm:w-auto max-sm:left-2"
    >
      {#if shell.account.name}<p class="truncate px-3 pt-1 pb-2 font-medium" title={shell.account.name}>{shell.account.name}</p>{/if}
      <ul class="flex flex-col gap-1">
        <li>
          <!-- svelte-ignore a11y_autofocus -- focus belongs inside the menu it opens, so Escape returns it to the avatar -->
          <a href={shell.account.path} class={row} autofocus aria-current={shell.active === "account" ? "page" : undefined}>
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
        <div class="flex items-center justify-between gap-3 border-t px-3 pt-2 pb-1">
          <span class="text-sm">{T.appearance}</span>
          {@render themePicker()}
        </div>
      {/if}
      <form method="post" action="/logout" class="border-t pt-1">
        <Button type="submit" variant="ghost" class="w-full justify-start px-3">
          <Icon name="signout" size={20} /><span>{T.signOut}</span>
        </Button>
      </form>
    </section>
  {/if}
  <main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl px-4 py-8">{@render content()}</main>
{:else}
  <div class="flex min-h-svh flex-col">
    <header class="flex h-14 items-center justify-between border-b px-4">
      <a href="/" class="font-mono font-semibold text-foreground" aria-label={T.homeLabel}>{T.brand}</a>
      {#if !signedIn}<Button href={data.signInHref} size="sm">{T.signIn}</Button>{/if}
    </header>
    <main id="main" class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{@render content()}</main>
  </div>
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
