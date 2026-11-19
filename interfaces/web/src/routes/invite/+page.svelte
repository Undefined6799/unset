<!--
  The Invite page (book P2.10): a form that asks for one invite, and the member's invites of the last 30 days, each as
  a read-only join link to select and copy. Plain forms, so it works with no script.
-->
<script lang="ts">
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Input } from "@unset/apps-web/lib/components/ui/input";
import { Label } from "@unset/apps-web/lib/components/ui/label";
import { INVITE as T } from "./messages.ts";

let { data } = $props();
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.title}</h1></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if data.left !== null}<p>{T.left(data.left)}</p>{/if}
    <form method="POST" action="?/issue" id="issue">
      <input type="hidden" name="submissionId" value={data.submissionId} />
      {#if data.countryRule}<Label><input type="checkbox" name="countryAck" value="yes" /> {T.country}</Label>{/if}
    </form>
  </Card.Content>
  <Card.Footer><Button type="submit" form="issue">{T.create}</Button></Card.Footer>
</Card.Root>

<section aria-labelledby="yours">
  <h2 id="yours">{T.yours}</h2>
  {#if data.invites.length === 0}
    <p>{T.none}</p>
  {:else}
    <ul>
      {#each data.invites as invite (invite.id)}
        <li>
          {#if invite.link === null}
            <p>{T.unavailable}</p>
          {:else}
            <Label for="invite-{invite.id}">{T.linkLabel}</Label>
            <Input id="invite-{invite.id}" readonly value={invite.link} />
          {/if}
          <time datetime={invite.createdAt}>{invite.createdAt.slice(0, 10)}</time>
          <form method="POST" action="?/hide">
            <input type="hidden" name="id" value={invite.id} />
            <Button type="submit" variant="ghost" aria-label={T.hideLabel}>{T.hide}</Button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</section>
