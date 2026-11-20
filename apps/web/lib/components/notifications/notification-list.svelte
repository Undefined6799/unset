<!--
  The notifications as rows (P2.27, ADR 0079), for the bell's panel and the notifications page alike, so each kind has
  one way to be drawn (rule SE-3). Every row is a plain form button that posts to /notifications?/open: the server marks
  it opened (it is then gone) and sends the browser to what it is about. Viewing changes nothing; only the post does,
  so it works with no script and a reload is always safe.
-->
<script lang="ts">
import { onMount } from "svelte";
import { NOTIFICATIONS as T } from "../../notifications/messages.ts";
import { type NotificationView, timeText } from "../../notifications/view.ts";
import { Icon } from "../icon/index.ts";

let { entries }: { entries: readonly NotificationView[] } = $props();

// With script, times are shown in the device's own zone; the server's text, in UTC, stays for a page with none.
let local = $state(false);
onMount(() => {
  local = true;
});

const key = (entry: NotificationView): string => (entry.kind === "sign_in" ? `s${entry.at}` : `p${entry.version}`);
const row =
  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-foreground hover:bg-muted focus-visible:bg-muted";
</script>

<ul class="m-0 flex list-none flex-col gap-1 p-0">
  {#each entries as entry (key(entry))}
    <li>
      <form method="POST" action="/notifications?/open">
        <input type="hidden" name="kind" value={entry.kind} />
        {#if entry.kind === "sign_in"}
          <input type="hidden" name="at" value={entry.at} />
          <button type="submit" class={row}>
            <Icon name="devices" size={20} class="mt-0.5 shrink-0" />
            <span class="flex min-w-0 flex-col">
              <span class="font-medium">{T.signIn}</span>
              <span class="text-muted-foreground text-sm"
                ><time datetime={entry.at}>{timeText(entry.at, local)}</time>. {T.signInHint}</span
              >
            </span>
          </button>
        {:else}
          <input type="hidden" name="version" value={entry.version} />
          <button type="submit" class={row}>
            <Icon name="info" size={20} class="mt-0.5 shrink-0" />
            <span class="flex min-w-0 flex-col">
              <span class="font-medium">{T.privacyNotice}</span>
              <span class="text-muted-foreground text-sm">{T.privacyNoticeHint}</span>
            </span>
          </button>
        {/if}
      </form>
    </li>
  {/each}
</ul>
