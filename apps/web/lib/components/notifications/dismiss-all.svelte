<!--
  "Dismiss all" (P2.27, ADR 0081): a plain form that names the newest entry the list showed, so the server deletes it
  and every older one, never one sent after the list was drawn. Sending it twice changes nothing more.
-->
<script lang="ts">
import { NOTIFICATIONS as T } from "../../notifications/messages.ts";
import type { NotificationView } from "../../notifications/view.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";

let {
  entries,
  returnTo,
  variant = "ghost",
}: { entries: readonly NotificationView[]; returnTo: string; variant?: "ghost" | "outline" } = $props();
const newest = $derived(entries[0]?.id);
</script>

{#if newest !== undefined}
  <form method="POST" action="/notifications?/dismissAll">
    <input type="hidden" name="upTo" value={newest} />
    <input type="hidden" name="return" value={returnTo} />
    <Button type="submit" {variant} size="sm"><Icon name="done" size={16} />{T.dismissAll}</Button>
  </form>
{/if}
