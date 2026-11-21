<script lang="ts">
// On the way out (ADR 0083 decision 5): a meta refresh to unset.cc's sign-out page, which removes messages from this
// browser and comes back to the signed-out page. No script; the button is for a browser that does not follow it.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";

let { data } = $props();
</script>

<svelte:head>
  <title>Signing out</title>
  <meta http-equiv="refresh" content={`0;url=${data.target}`} />
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>Signing you out</h1></Card.Title>
    <Card.Description>Removing your messages from this browser.</Card.Description>
  </Card.Header>
  <Card.Footer><Button href={data.target}>Continue</Button></Card.Footer>
</Card.Root>
