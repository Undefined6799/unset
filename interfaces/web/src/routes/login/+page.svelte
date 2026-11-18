<script lang="ts">
// The sign-in page (P2.05m: "the sign in should only be a modal"): the sign-in box alone, as a page region, not an
// aria-modal dialog, because with no script it cannot trap focus. Close goes back to the page before. The shell shows
// the `?error=` callout (catalog text only, routes/+layout.ts).
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";

let { data } = $props();
</script>

<svelte:head><title>Sign in</title></svelte:head>

<Card.Root role="region" aria-labelledby="sign-in-title">
  <Card.Header>
    <Card.Title><h1 id="sign-in-title">Sign in</h1></Card.Title>
    <Card.Action><Button href={data.close} variant="ghost" size="sm">Close</Button></Card.Action>
  </Card.Header>
  <Card.Content>
    <p>You sign in on <strong>{data.pdsHost}</strong>, our sign-in server. It is the only place you type your password.</p>
  </Card.Content>
  <Card.Footer>
    <form method="POST">
      {#if data.next !== null}<input type="hidden" name="next" value={data.next} />{/if}
      <Button type="submit" name="intent" value="chooser">Sign in with AtProto</Button>
    </form>
  </Card.Footer>
</Card.Root>
