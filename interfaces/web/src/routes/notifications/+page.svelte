<!--
  The notifications page (P2.27b, ADR 0081): the inbox component, given the list and the entry the address names
  (`?n=`), if any. Works with no script.
-->
<script lang="ts">
import Inbox from "@unset/apps-web/lib/components/notifications/inbox.svelte";
import { NOTIFICATIONS as T } from "@unset/apps-web/lib/notifications/messages.ts";
import { page } from "$app/state";

let { data } = $props();
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Inbox view={data.notifications} chosen={page.url.searchParams.get("n")} />
