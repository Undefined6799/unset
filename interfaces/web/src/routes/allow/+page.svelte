<script lang="ts">
// A sign-in from before a permission the app now asks for (allow/+page.server.ts). It needs no script: the button
// posts the reconsent form.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { ALLOW_ACCESS as T } from "../welcome/messages.ts";
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<Card.Root>
  <Card.Header><Card.Title><h1>{T.title}</h1></Card.Title></Card.Header>
  <Card.Content>
    <p>{T.why}</p>
    <p>{T.kept}</p>
  </Card.Content>
  <Card.Footer><form method="POST" action="?/reconsent"><Button type="submit">{T.allow}</Button></form></Card.Footer>
</Card.Root>
