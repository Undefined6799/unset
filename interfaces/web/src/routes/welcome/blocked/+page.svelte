<script lang="ts">
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { WELCOME as T } from "../messages.ts";

let { data } = $props();
</script>

<svelte:head><title>{T.blockedTitle}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.blockedTitle}</h1></Card.Title>
    <Card.Description>{T.blockedLead}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if data.appeal === null}<p>{T.appealUnpublished}</p>{:else}<p><a href={data.appeal}>{T.appeal}</a></p>{/if}
  </Card.Content>
</Card.Root>
