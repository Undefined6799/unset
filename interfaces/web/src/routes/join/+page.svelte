<!--
  The join page (book P2.10): the invite code, what happens next, and Create account, which starts a sign-up at our
  PDS. A plain form, with script or without; the code field is read-only so it can be selected and copied.
-->
<script lang="ts">
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Input } from "@unset/apps-web/lib/components/ui/input";
import { Label } from "@unset/apps-web/lib/components/ui/label";
import { JOIN as T } from "./messages.ts";

let { data } = $props();
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.title}</h1></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if data.code !== null}
      <Label for="code">{T.codeLabel}</Label>
      <Input id="code" readonly value={data.code} />
    {:else if data.malformed}
      <p>{T.malformed}</p>
    {:else}
      <p>{T.noCode}</p>
      <p>{T.noInvite} <a href="/request-invite">{T.request}</a></p>
    {/if}
    {#if data.signedIn}
      <p>{T.signedIn}</p>
    {:else}
      <p>{T.next(data.pdsHost)}</p>
      {#if data.countryRule}<p>{T.country}</p>{/if}
      <form method="POST" id="join"></form>
    {/if}
  </Card.Content>
  {#if !data.signedIn}<Card.Footer><Button type="submit" form="join">{T.create}</Button></Card.Footer>{/if}
</Card.Root>
