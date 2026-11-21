<script lang="ts">
// The chat step of signup (book P6.17; ADR 0095 decision 2): +page.server.ts says which of its three cards shows.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { WELCOME as T } from "../messages.ts";
import SignOut from "../sign-out.svelte";

let { data } = $props();
const CARDS = {
  getting_ready: { title: T.chatWaitTitle, lead: T.chatWaitLead },
  set_up: { title: T.chatTitle, lead: T.chatLead },
  done: { title: T.chatDoneTitle, lead: T.chatDoneLead },
} as const;
const card = $derived(CARDS[data.view]);
</script>

<svelte:head><title>{card.title}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{card.title}</h1></Card.Title>
    <Card.Description>{card.lead}</Card.Description>
  </Card.Header>
  <Card.Footer>
    {#if data.view === "done"}
      <form method="POST"><Button type="submit">{T.continue}</Button></form>
    {:else if data.view === "set_up"}
      <Button href={data.setUpHref}>{T.chatSetUp}</Button>
    {:else}
      <Button href="/welcome/chat" variant="outline">{T.chatTryAgain}</Button>
    {/if}
  </Card.Footer>
</Card.Root>
<SignOut />
