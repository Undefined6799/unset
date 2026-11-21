<!--
  The bell's notifications as rows (P2.27, ADR 0079 and 0081). Each row is drawn from its reason's row in REASON_SCREENS
  and nothing else, so a new reason needs no change here. Every row is a plain link to its detail on the notifications
  page; following it changes nothing, so it works with no script and a reload is always safe.
-->
<script lang="ts">
import { onMount } from "svelte";
import { reasonScreen } from "../../notifications/reasons.ts";
import { type NotificationView, timeText } from "../../notifications/view.ts";
import { Icon, type IconName } from "../icon/index.ts";

let { entries }: { entries: readonly NotificationView[] } = $props();

// With script, times are shown in the device's own zone; the server's text, in UTC, stays for a page with none.
let local = $state(false);
onMount(() => {
  local = true;
});

const shown = $derived(
  entries.flatMap((entry) => {
    const screen = reasonScreen(entry.reason);
    return screen === undefined ? [] : [{ entry, screen }];
  }),
);
const row =
  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-foreground hover:bg-muted focus-visible:bg-muted";
</script>

<ul class="m-0 flex list-none flex-col gap-1 p-0">
  {#each shown as { entry, screen } (entry.id)}
    <li>
      <a href="/notifications?n={entry.id}" class={row}>
        <Icon name={screen.icon as IconName} size={20} class="mt-0.5 shrink-0" />
        <span class="flex min-w-0 flex-col">
          <span class="font-medium">{screen.title}</span>
          <span class="text-muted-foreground text-sm"
            ><time datetime={entry.sentAt}>{timeText(entry.sentAt, local)}</time>. {screen.hint}</span
          >
        </span>
      </a>
    </li>
  {/each}
</ul>
