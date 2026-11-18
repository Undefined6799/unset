<!--
  The shell of every page (P1.20d), as apps/web/src/shell/AppShell.tsx draws it today; src/lib/shell.ts says what a
  page passes. The page's own load returns `shell`; the error page and any page that passes nothing get the signed-out
  site shell. Everything here works with no script: links, plain forms, and a native popover for the menu drawer
  (https://html.spec.whatwg.org/multipage/popover.html). The `?error=` callout shows only the catalog's text.
-->
<script lang="ts">
import "@unset/apps-web/app.css";
import { Icon } from "@unset/apps-web/lib/components/icon";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import type { Snippet } from "svelte";
import { page } from "$app/state";
import { type ShellData, SITE_SHELL, SHELL_TEXT as T } from "../lib/shell.ts";
import type { LayoutData } from "./$types";

let { data, children }: { data: LayoutData; children: Snippet } = $props();

const shell: ShellData = $derived((page.data as { shell?: ShellData }).shell ?? SITE_SHELL);
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
const MENU = "core-menu";
const row =
  "flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium";
</script>

<svelte:head>
  {#if shell.noindex}<meta name="robots" content="noindex" />{/if}
</svelte:head>

{#snippet themeForm()}
  <form method="post" action="/prefs/theme" class="flex flex-col gap-2">
    <fieldset class="flex flex-col gap-1">
      <legend class="mb-1 text-sm font-medium">{T.theme}</legend>
      {#each THEMES as option (option.value)}
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="theme" value={option.value} checked={shell.prefs?.theme === option.value} />
          {option.label}
        </label>
      {/each}
    </fieldset>
    <input type="hidden" name="return" value={shell.prefs?.returnTo ?? "/"} />
    <Button type="submit" variant="outline" size="sm">{T.saveTheme}</Button>
  </form>
{/snippet}

{#snippet content()}
  {#if message !== undefined}
    <Alert.Root variant="destructive" class="mb-6"><Alert.Description>{message}</Alert.Description></Alert.Root>
  {/if}
  {#if shell.hiddenHeading !== undefined}<h1 class="sr-only">{shell.hiddenHeading}</h1>{/if}
  {@render children()}
{/snippet}

<a
  href="#main"
  class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
  >{T.skip}</a
>

{#if shell.kind === "core"}
  <header class="flex h-14 items-center gap-2 border-b px-4">
    <Button variant="ghost" size="icon" popovertarget={MENU} popovertargetaction="toggle" class="max-sm:hidden">
      <Icon name="menu" size={24} label={T.menu} />
    </Button>
    <a href="/" class="font-mono font-semibold text-foreground" aria-label={T.homeLabel}>{T.brand}</a>
  </header>
  <nav
    id={MENU}
    popover="auto"
    aria-label={T.menu}
    class="fixed inset-y-0 left-0 m-0 h-full w-72 max-w-[85vw] flex-col gap-4 border-r bg-background p-4 text-foreground open:flex"
  >
    <div class="flex items-center justify-between">
      <a href="/" class="font-mono font-semibold text-foreground" aria-label={T.homeLabel}>{T.brand}</a>
      <!-- svelte-ignore a11y_autofocus -- focus belongs inside the drawer it opens, so Escape returns it to the menu button -->
      <Button variant="ghost" size="icon" autofocus popovertarget={MENU} popovertargetaction="hide">
        <Icon name="close" size={24} label={T.closeMenu} />
      </Button>
    </div>
    <ul class="flex flex-col gap-1">
      <li>
        <a href="/" class={row} aria-current={shell.active === "home" ? "page" : undefined}>
          <Icon name="home" size={24} /><span>{T.home}</span>
        </a>
      </li>
      <li>
        <a href={shell.account?.path ?? "/me"} class={row} aria-current={shell.active === "account" ? "page" : undefined}>
          <Icon name="profile" size={24} /><span>{T.profile}</span>
          {#if shell.account?.name}<span class="truncate text-muted-foreground">{shell.account.name}</span>{/if}
        </a>
      </li>
      <li>
        <a href="/settings/profile" class={row} aria-current={shell.active === "settings" ? "page" : undefined}>
          <Icon name="settings" size={24} /><span>{T.settings}</span>
        </a>
      </li>
    </ul>
    {#if shell.account !== undefined}
      <form method="post" action="/logout" class="border-t pt-4">
        <Button type="submit" variant="ghost" class="w-full justify-start">
          <Icon name="signout" size={24} /><span>{T.signOut}</span>
        </Button>
      </form>
    {/if}
    {#if shell.prefs !== undefined}
      <div class="mt-auto border-t pt-4">{@render themeForm()}</div>
    {/if}
  </nav>
  <nav
    aria-label={T.menu}
    class="fixed inset-x-0 bottom-0 flex h-14 items-center justify-around border-t bg-background sm:hidden"
  >
    <Button variant="ghost" size="icon" popovertarget={MENU} popovertargetaction="toggle">
      <Icon name="menu" size={24} label={T.menu} />
    </Button>
    <Button variant="ghost" size="icon" href="/" aria-current={shell.active === "home" ? "page" : undefined}>
      <Icon name="home" size={24} label={T.home} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      href={shell.account?.path ?? "/me"}
      aria-current={shell.active === "account" ? "page" : undefined}
    >
      <Icon name="profile" size={24} label={T.profile} />
    </Button>
  </nav>
  <main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl px-4 py-8 max-sm:pb-20">{@render content()}</main>
{:else}
  <div class="flex min-h-svh flex-col">
    <header class="flex h-14 items-center justify-between border-b px-4">
      <a href="/" class="font-mono font-semibold text-foreground" aria-label={T.homeLabel}>{T.brand}</a>
      {#if !shell.signedIn}<Button href="/login" size="sm">{T.signIn}</Button>{/if}
    </header>
    <main
      id="main"
      class="mx-auto w-full max-w-3xl flex-1 px-4 py-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_table]:my-4 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:text-left [&_code]:font-mono"
    >
      {@render content()}
    </main>
  </div>
  <footer class="flex flex-wrap gap-8 border-t px-4 py-8 text-sm">
    <div class="flex flex-col gap-2">
      <h2 class="font-medium">{T.siteColumn}</h2>
      <a href="/">{T.home}</a>
      {#if !shell.signedIn}<a href="/login">{T.signIn}</a>{/if}
    </div>
    <div class="flex flex-col gap-2">
      <h2 class="font-medium">{T.legalColumn}</h2>
      {#each LEGAL as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
    </div>
    {#if shell.prefs !== undefined}<div>{@render themeForm()}</div>{/if}
    <p class="w-full text-muted-foreground">{T.note}</p>
  </footer>
{/if}
