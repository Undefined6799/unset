<!--
  The settings layout (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): a side list of the settings pages beside the
  page, a row above it on phones. It links only pages that run today; the current one is marked aria-current. The
  site shell around it is the root layout's.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { page } from "$app/state";
import { SETTINGS } from "./messages.ts";

let { children }: { children: Snippet } = $props();

const PAGES = [
  { label: SETTINGS.profile, path: "/settings/profile" },
  { label: SETTINGS.account, path: "/settings/account" },
] as const;
</script>

<p class="text-muted-foreground mb-6 font-mono text-xs tracking-wide uppercase">{SETTINGS.label}</p>
<div class="grid items-start gap-6 md:grid-cols-[200px_minmax(0,560px)] md:gap-12">
  <nav aria-label={SETTINGS.nav}>
    <ul class="flex border-b md:flex-col md:gap-1 md:border-b-0">
      {#each PAGES as item (item.path)}
        <li>
          <a
            href={item.path}
            aria-current={page.url.pathname === item.path ? "page" : undefined}
            class="text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:border-foreground block border-b-2 border-transparent px-3 py-2 no-underline md:border-b-0 md:border-l-2"
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="[&>h1]:mt-0">
    {@render children()}
  </div>
</div>
