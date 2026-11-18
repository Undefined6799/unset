<!--
  The settings layout (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): a side list of the settings pages on the left
  of the wide main, the page beside it; on phones the list is a row of tabs above the page. It links only pages that
  run today; the current one is marked aria-current. The site shell around it is the root layout's.
-->
<script lang="ts">
import { Icon, type IconName } from "@unset/apps-web/lib/components/icon";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import type { Snippet } from "svelte";
import { page } from "$app/state";

let { children }: { children: Snippet } = $props();

const PAGES: readonly { label: string; path: string; icon: IconName }[] = [
  { label: SETTINGS.profile, path: "/settings/profile", icon: "profile" },
  { label: SETTINGS.account, path: "/settings/account", icon: "private" },
];
</script>

<div class="grid items-start gap-6 md:grid-cols-[13rem_minmax(0,40rem)] md:gap-10 lg:gap-16">
  <nav aria-label={SETTINGS.nav}>
    <p class="text-muted-foreground mb-3 font-mono text-xs tracking-wide uppercase max-md:hidden">{SETTINGS.label}</p>
    <ul class="m-0 flex list-none gap-1 border-b p-0 md:flex-col md:border-b-0">
      {#each PAGES as item (item.path)}
        <li class="m-0">
          <a
            href={item.path}
            aria-current={page.url.pathname === item.path ? "page" : undefined}
            class="text-muted-foreground hover:text-foreground hover:bg-accent aria-[current=page]:text-foreground aria-[current=page]:bg-accent -mb-px flex min-h-10 items-center gap-2.5 border-b-2 border-transparent px-3 text-sm font-medium no-underline aria-[current=page]:border-foreground md:mb-0 md:rounded-md md:border-b-0 md:aria-[current=page]:border-transparent pointer-coarse:min-h-11"
          >
            <Icon name={item.icon} size={16} />{item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="grid min-w-0 gap-6 [&>h1]:m-0">
    {@render children()}
  </div>
</div>
