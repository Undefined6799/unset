<!--
  "Mark all as read" (P2.27): a plain form that names what the list showed, the newest sign-in and the notice version,
  so the server marks those and every older sign-in, never one that arrived after the list was drawn. Sending it twice
  changes nothing more.
-->
<script lang="ts">
import { NOTIFICATIONS as T } from "../../notifications/messages.ts";
import { listedNotice, type NotificationView, newestSignIn } from "../../notifications/view.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";

let { entries, returnTo }: { entries: readonly NotificationView[]; returnTo: string } = $props();
const at = $derived(newestSignIn(entries));
const version = $derived(listedNotice(entries));
</script>

<form method="POST" action="/notifications?/readAll">
  {#if at !== null}<input type="hidden" name="at" value={at} />{/if}
  {#if version !== null}<input type="hidden" name="version" value={version} />{/if}
  <input type="hidden" name="return" value={returnTo} />
  <Button type="submit" variant="ghost" size="sm"><Icon name="done" size={16} />{T.markAll}</Button>
</form>
