<script lang="ts">
// After signing out (P2.08s): one box asking whether to sign out of the atproto account too. Signing out there ends
// only that browser's session on the PDS; other apps' grants stay until removed there, so the box says so. The link
// opens a new tab, so unset.sh stays open behind it (P2.08k).
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";

let { data } = $props();
</script>

<svelte:head><title>Signed out</title></svelte:head>

<Card.Root role="region" aria-labelledby="signed-out-title">
  <Card.Header>
    <Card.Title><h1 id="signed-out-title">You are signed out of unset</h1></Card.Title>
    <Card.Description>
      Also sign out of your atproto account? Apps you allowed stay signed in until you remove them there.
    </Card.Description>
  </Card.Header>
  {#if data.link?.ours}
    <Card.Content>
      <p>You are going to {data.link.host}, our sign-in server; it is the only place you type your password.</p>
    </Card.Content>
  {/if}
  <Card.Footer>
    {#if data.link !== null}
      <Button href={data.link.href} target="_blank" rel="noopener noreferrer">
        {data.link.ours ? `Your account on ${data.link.host}` : `your sign-in server (${data.link.host})`}
        (opens in a new tab)
      </Button>
    {/if}
    <form method="POST"><Button type="submit" variant="outline">No thanks</Button></form>
  </Card.Footer>
</Card.Root>
