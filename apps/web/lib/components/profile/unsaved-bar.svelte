<!--
  The owner's unsaved changes (ADR 0074 item 4): one bar above the name and avatar, sticky under the site header at
  var(--site-header-height) (app.css), shown only while a card has changes or a Save has something to say. It holds
  the count, Save and Discard; the page does the work. A Save's answer is read out (role status), a refusal as an alert.
  It never asks before the member leaves the page (Alex 2026-11-20): unsaved words stay on the device as drafts.
-->
<script lang="ts">
import { UNSAVED_BAR } from "../../profile/messages.ts";
import { Button } from "../ui/button/index.ts";

let {
  count,
  saving,
  message,
  refused,
  onsave,
  ondiscard,
}: {
  count: number;
  saving: boolean;
  /** What the last Save came to, if anything is left to say. */
  message?: string;
  /** Whether that message is a refusal. */
  refused: boolean;
  onsave: () => void;
  ondiscard: () => void;
} = $props();

const shown = $derived(count > 0 || message !== undefined);

/**
 * What the member is looking at: the field they type in, else the first card on the screen. The bar takes its room
 * in the page above the cards, so showing or hiding it moves them by its height. Chromium and Firefox keep the words
 * in place with CSS scroll anchoring; WebKit has none, so on an iPhone the line being typed on jumped down by the
 * bar's height at the first change, off the screen near the bottom (staging, 2026-11-21). Measured before the bar
 * comes or goes and put back after, the words stay where they were in every browser; where the browser already kept
 * them, nothing has moved and nothing is scrolled.
 */
function lookedAt(): { element: Element; top: number } | undefined {
  const active = document.activeElement;
  const typing = active !== null && active !== document.body && active.closest("[data-unsaved-bar]") === null;
  const element = typing
    ? active
    : [...document.querySelectorAll("[data-slot='card']")].find((card) => card.getBoundingClientRect().bottom > 0);
  return element === undefined ? undefined : { element, top: element.getBoundingClientRect().top };
}

let before: ReturnType<typeof lookedAt>;
// $effect.pre runs before this component's own DOM is updated (svelte 5.57 `$effect.pre`), $effect after it.
$effect.pre(() => {
  void shown;
  before = lookedAt();
});
$effect(() => {
  void shown;
  if (before === undefined || !before.element.isConnected) return;
  const moved = before.element.getBoundingClientRect().top - before.top;
  if (moved !== 0) scrollBy(0, moved);
});
</script>

{#if shown}
  <div
    role="region"
    aria-label={UNSAVED_BAR.label}
    data-unsaved-bar
    class="sticky top-[var(--site-header-height)] z-20 flex flex-wrap items-center gap-3 rounded-sm border bg-background p-3 shadow-md"
  >
    <div class="min-w-0 flex-1 text-sm">
      {#if message !== undefined}
        <p role={refused ? "alert" : "status"} class={refused ? "text-destructive" : ""}>{message}</p>
      {/if}
      {#if count > 0}<p class={message === undefined ? "" : "text-muted-foreground"}>{UNSAVED_BAR.count(count)}</p>{/if}
    </div>
    {#if count > 0}
      <div class="flex gap-2">
        <Button type="button" variant="outline" disabled={saving} onclick={ondiscard}>{UNSAVED_BAR.discard}</Button>
        <Button type="button" disabled={saving} aria-busy={saving} onclick={onsave}
          >{saving ? UNSAVED_BAR.saving : UNSAVED_BAR.save}</Button
        >
      </div>
    {/if}
  </div>
{/if}
