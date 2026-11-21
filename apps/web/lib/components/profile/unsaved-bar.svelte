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
</script>

{#if count > 0 || message !== undefined}
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
