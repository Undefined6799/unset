<script lang="ts">
// The same-site step to the signed-out page (routes/logout/done/+page.server.ts): a meta refresh, no script; the button
// is for a browser that does not follow it.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
</script>

<svelte:head>
  <title>Signing out</title>
  <meta http-equiv="refresh" content="0;url=/signed-out" />
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>Signing you out</h1></Card.Title>
  </Card.Header>
  <Card.Footer><Button href="/signed-out">Continue</Button></Card.Footer>
</Card.Root>
