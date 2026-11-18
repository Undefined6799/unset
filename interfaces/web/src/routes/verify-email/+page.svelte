<script lang="ts">
// Confirming the account email (P2.11). The server already read the PDS; this page never sends mail, the member
// confirms it on the sign-in server. P2.11h: every state ends in this browser's sign-out.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { VERIFY_EMAIL as T } from "../welcome/messages.ts";
import SignOut from "../welcome/sign-out.svelte";

let { data } = $props();
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header><Card.Title><h1>{T.title}</h1></Card.Title></Card.Header>
  {#if data.state === "confirmed"}
    <Card.Content><p>{T.confirmed}</p></Card.Content>
    <Card.Footer><Button href="/me">{T.continue}</Button></Card.Footer>
  {:else if data.state === "unconfirmed"}
    <Card.Content>
      <p>You are going to {data.pdsHost}, our sign-in server; it is the only place you type your password.</p>
      <p>{T.openAccount}</p>
    </Card.Content>
    <Card.Footer>
      {#if data.account !== null}
        <Button href={data.account} target="_blank" rel="noopener noreferrer">
          Your account on {data.pdsHost} (opens in a new tab)
        </Button>
      {/if}
      <Button href="/verify-email" variant="outline">{T.checkAgain}</Button>
    </Card.Footer>
  {:else if data.state === "needs_consent"}
    <Card.Content><p>{T.needsConsent}</p></Card.Content>
    <Card.Footer><form method="POST" action="?/reconsent"><Button type="submit">{T.allow}</Button></form></Card.Footer>
  {:else}
    <Card.Content><p>{T.unavailable(data.pdsHost)}</p></Card.Content>
    <Card.Footer><Button href="/verify-email" variant="outline">{T.tryAgain}</Button></Card.Footer>
  {/if}
</Card.Root>
<SignOut />
