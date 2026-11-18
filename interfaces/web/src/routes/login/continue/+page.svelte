<script lang="ts">
// Between the sign-in form and the authorization server (P2.05; P1.08): a meta refresh, outside the form's redirect
// chain that `form-action 'self'` covers, and a link for a browser that does not follow it. No script.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";

let { data } = $props();
</script>

<svelte:head>
  <title>Continue signing in</title>
  <meta http-equiv="refresh" content={`0;url=${data.target}`} />
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>You are going to <strong>{data.host}</strong></h1></Card.Title>
    {#if data.ours}
      <Card.Description>This is our sign-in server; it is the only place you type your password.</Card.Description>
    {/if}
  </Card.Header>
  <Card.Footer><Button href={data.target}>Continue to {data.host}</Button></Card.Footer>
</Card.Root>
