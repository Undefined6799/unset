<!--
  The Sign-in history tab (P2.27c, ADR 0082), in the notifications page's frame: it fills the window below the header
  and its list scrolls in its own box under a header row that stays. Each row is a sign-in's date and time, how long
  ago it was, and a Delete form; the checkboxes post with Delete selected, and Delete all names the newest row listed,
  so a sign-in after the page was drawn stays. Only the time is kept, which the note under the list says.

  With no script every part is a plain form and the times read in UTC; with script they read in the device's zone, and
  "how long ago" and Select all appear.
-->
<script lang="ts">
import { onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { NOTIFICATIONS, SIGN_INS as T } from "../../notifications/messages.ts";
import { howLongAgo, type SignInsView, timeText } from "../../notifications/view.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import Tabs from "./tabs.svelte";

let { view }: { view: SignInsView | undefined } = $props();

const HOME = "/notifications/sign-ins";
const FORM = "sign-ins-delete-selected";

const entries = $derived(view?.state === "ready" ? view.entries : []);
let now: Date | undefined = $state();
const ticked = new SvelteSet<string>();
const allTicked = $derived(entries.length > 0 && entries.every((entry) => ticked.has(entry.id)));

onMount(() => {
  now = new Date();
});

function tick(id: string, on: boolean) {
  if (on) ticked.add(id);
  else ticked.delete(id);
}

function tickAll(on: boolean) {
  for (const entry of entries) tick(entry.id, on);
}

// On a phone the "How long ago" column goes, so the whole time fits (staging test 2026-11-21, u8).
const row =
  "grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]";
const agoCell = "max-sm:hidden";
// 24 px: the smallest target WCAG 2.2 SC 2.5.8 allows (tests/e2e/a11y.spec.ts target_size).
const checkbox = "size-6 accent-primary";
</script>

<section
  class="flex h-[calc(100svh-var(--site-header-height)-4rem)] min-h-[26rem] flex-col gap-3 max-md:h-auto max-md:min-h-[calc(100svh-var(--site-header-height)-4rem)]"
  aria-labelledby="sign-ins-title"
>
  <h1 class="text-3xl leading-tight font-semibold">{NOTIFICATIONS.title}</h1>
  <Tabs current="sign-ins" />
  <h2 id="sign-ins-title" class="sr-only">{T.title}</h2>

  {#if view === undefined || view.state === "failed"}
    <p role="alert" class="text-muted-foreground">{T.failed}</p>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      {#if entries.length === 0}
        <div class="grid flex-1 place-content-center justify-items-center gap-1.5 p-12 text-center text-muted-foreground">
          <span class="grid size-13 place-items-center rounded-md bg-muted"><Icon name="devices" size={24} /></span>
          <p class="font-medium text-foreground">{T.none}</p>
          <p>{T.noneHint}</p>
        </div>
      {:else}
        <div class="flex flex-wrap items-center gap-2 border-b bg-secondary px-3 py-2 text-sm">
          {#if now !== undefined}
            <input
              type="checkbox"
              class={checkbox}
              aria-label={T.selectAll}
              checked={allTicked}
              onchange={(e) => tickAll(e.currentTarget.checked)}
            />
          {/if}
          <form id={FORM} method="POST" action="{HOME}?/delete">
            <Button type="submit" variant="ghost" size="sm" disabled={now !== undefined && ticked.size === 0}>
              <Icon name="delete" size={16} />{T.deleteSelected}
            </Button>
          </form>
          <form method="POST" action="{HOME}?/deleteAll">
            <input type="hidden" name="upTo" value={entries[0]?.id} />
            <Button type="submit" variant="outline" size="sm"><Icon name="delete" size={16} />{T.deleteAll}</Button>
          </form>
          <!-- On a phone the count goes, so the toolbar stays one line. -->
          <span class="ml-auto text-muted-foreground max-sm:hidden">{T.count(entries.length, view.more)}</span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <div class="{row} sticky top-0 z-10 min-h-9 bg-card text-xs font-medium text-muted-foreground" aria-hidden="true">
            <span></span><span>{T.when}</span><span class={agoCell}>{T.ago}</span><span class="sr-only">{T.delete}</span>
          </div>
          <ul class="m-0 list-none p-0" aria-label={T.title}>
            {#each entries as entry (entry.id)}
              {@const when = timeText(entry.at, now !== undefined)}
              <li class="{row} hover:bg-muted">
                <input
                  type="checkbox"
                  name="id"
                  value={entry.id}
                  form={FORM}
                  class={checkbox}
                  aria-label={T.select(when)}
                  checked={ticked.has(entry.id)}
                  onchange={(e) => tick(entry.id, e.currentTarget.checked)}
                />
                <!-- With script the time is the device's own; the tooltip keeps UTC (staging test 2026-11-21). -->
                <time datetime={entry.at} class="truncate" title={now === undefined ? undefined : timeText(entry.at, false)}
                  >{when}</time
                >
                <span class="truncate text-sm text-muted-foreground {agoCell}">{now === undefined ? "" : howLongAgo(entry.at, now)}</span>
                <form method="POST" action="{HOME}?/delete">
                  <input type="hidden" name="id" value={entry.id} />
                  <Button type="submit" variant="ghost" size="icon-sm" aria-label={T.deleteOne(when)}>
                    <Icon name="delete" size={16} />
                  </Button>
                </form>
              </li>
            {/each}
          </ul>
          {#if view.more}<p class="px-3.5 py-3 text-sm text-muted-foreground">{T.more}</p>{/if}
        </div>
      {/if}
    </div>
    <p class="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon name="private" size={16} class="mt-0.5 shrink-0" />
      <span>{T.kept} {T.notYou} <a href="/settings/account">{T.settings}</a></span>
    </p>
  {/if}
</section>
