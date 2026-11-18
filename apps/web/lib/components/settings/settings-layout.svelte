<!--
  The settings frame (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): a side list of the settings pages on the left
  of the wide main, the page beside it; on phones the list is a row of tabs above the page. The current one is marked
  aria-current. The page's own heading sits flush on top.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { Icon, type IconName } from "../icon/index.ts";

type Item = Readonly<{ label: string; path: string; icon: IconName }>;
let {
  label,
  navLabel,
  pages,
  current,
  children,
}: { label: string; navLabel: string; pages: readonly Item[]; current: string; children: Snippet } = $props();
</script>

<div class="grid items-start gap-6 md:grid-cols-[13rem_minmax(0,40rem)] md:gap-10 lg:gap-16">
  <nav aria-label={navLabel}>
    <p class="text-muted-foreground mb-3 font-mono text-xs tracking-wide uppercase max-md:hidden">{label}</p>
    <ul class="m-0 flex list-none gap-1 border-b p-0 md:flex-col md:border-b-0">
      {#each pages as item (item.path)}
        <li class="m-0">
          <a
            href={item.path}
            aria-current={current === item.path ? "page" : undefined}
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
