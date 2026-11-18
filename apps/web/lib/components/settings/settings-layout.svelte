<!--
  The settings frame (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): a side list of the settings pages beside the
  page, a row above it on phones; the current one is marked aria-current. The page's own heading sits flush on top.
-->
<script lang="ts">
import type { Snippet } from "svelte";

type Item = Readonly<{ label: string; path: string }>;
let {
  label,
  navLabel,
  pages,
  current,
  children,
}: { label: string; navLabel: string; pages: readonly Item[]; current: string; children: Snippet } = $props();
</script>

<p class="text-muted-foreground mb-6 font-mono text-xs tracking-wide uppercase">{label}</p>
<div class="grid items-start gap-6 md:grid-cols-[200px_minmax(0,560px)] md:gap-12">
  <nav aria-label={navLabel}>
    <ul class="flex border-b md:flex-col md:gap-1 md:border-b-0">
      {#each pages as item (item.path)}
        <li>
          <a
            href={item.path}
            aria-current={current === item.path ? "page" : undefined}
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
