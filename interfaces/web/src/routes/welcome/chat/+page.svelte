<script lang="ts">
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { WELCOME as T } from "../messages.ts";
import SignOut from "../sign-out.svelte";
</script>

<svelte:head><title>{T.chatTitle}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.chatTitle}</h1></Card.Title>
    <Card.Description>{T.chatLead}</Card.Description>
  </Card.Header>
  <Card.Footer><form method="POST"><Button type="submit">{T.continue}</Button></form></Card.Footer>
</Card.Root>
<SignOut />
