<!--
  The notifications page (P2.27, ADR 0079): the member's notifications, newest first, each a plain form that opens it,
  and Mark all as read. Works with no script; with script, times show in the device's zone.
-->
<script lang="ts">
import MarkAllRead from "@unset/apps-web/lib/components/notifications/mark-all-read.svelte";
import NotificationList from "@unset/apps-web/lib/components/notifications/notification-list.svelte";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { NOTIFICATIONS as T } from "@unset/apps-web/lib/notifications/messages.ts";

let { data } = $props();
const view = $derived(data.notifications);
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.title}</h1></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if view === undefined || view.state === "failed"}
      <p role="alert">{T.failed}</p>
    {:else if view.entries.length === 0}
      <p>{T.none}</p>
    {:else}
      <NotificationList entries={view.entries} />
      {#if view.more}<p>{T.more}</p>{/if}
    {/if}
  </Card.Content>
  {#if view?.state === "ready" && view.entries.length > 0}
    <Card.Footer><MarkAllRead entries={view.entries} returnTo="/notifications" /></Card.Footer>
  {/if}
</Card.Root>
