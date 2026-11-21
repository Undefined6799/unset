<!--
  The invite-request page (book P2.10r; ADR 0080): one email field and the confirmations the sign-up asks for, or what
  happened. No script. The trap field is `hidden`, so people and screen readers never meet it; a bot that fills every
  field gives itself away.
-->
<script lang="ts">
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Input } from "@unset/apps-web/lib/components/ui/input";
import { Label } from "@unset/apps-web/lib/components/ui/label";
import { REQUEST_INVITE as T } from "./messages.ts";

let { data } = $props();
const showForm = $derived(data.open && !data.signedIn && !data.received);
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.title}</h1></Card.Title>
    <!-- The lead asks for an address, so it shows only with the form (staging test 2026-11-21, u7). -->
    {#if showForm}<Card.Description>{T.lead}</Card.Description>{/if}
  </Card.Header>
  <Card.Content>
    {#if data.signedIn}
      <p>{T.signedIn}</p>
    {:else if data.received}
      <p role="status">{T.received}</p>
    {:else if !data.open}
      <p>{T.closed}</p>
    {:else}
      <form method="POST" id="request-invite">
        <!-- Each field in a paragraph, so the shell's paragraph spacing keeps them apart (no classes in pages). -->
        <p>
          <Label for="email">{T.emailLabel}</Label>
          <Input id="email" name="email" type="email" autocomplete="email" required maxlength={254} />
        </p>
        <p><Label><input type="checkbox" name="ageAck" value="yes" required /> {T.age(data.minAge)}</Label></p>
        {#if data.countryRule}
          <p><Label><input type="checkbox" name="countryAck" value="yes" required /> {T.country}</Label></p>
        {/if}
        <div hidden>
          <label for="website">{T.trapLabel}</label>
          <input id="website" name="website" type="text" tabindex="-1" autocomplete="off" />
        </div>
      </form>
      <!-- Fine print: smaller than the form, as the card's lead is. -->
      <p><small>{T.privacy} <a href="/legal/privacy">{T.notice}</a></small></p>
    {/if}
  </Card.Content>
  {#if showForm}
    <Card.Footer><Button type="submit" form="request-invite">{T.send}</Button></Card.Footer>
  {:else if data.signedIn}
    <Card.Footer><Button href="/invite">{T.invitePage}</Button></Card.Footer>
  {/if}
</Card.Root>
