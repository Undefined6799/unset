<script lang="ts">
// The terms step (P2.12): short summaries and the checkboxes, native so the form works with no script.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Label } from "@unset/apps-web/lib/components/ui/label";
import { WELCOME as T } from "../messages.ts";
import SignOut from "../sign-out.svelte";

let { data } = $props();
</script>

<svelte:head><title>{T.termsTitle}</title></svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title><h1>{T.termsTitle}</h1></Card.Title>
    <Card.Description>{T.termsLead}</Card.Description>
  </Card.Header>
  <Card.Content>
    <!-- A list of their own, so the two links do not run into the sentence before them (staging audit 2026-11-19). -->
    <ul>
      <li><a href="/legal/terms">{T.termsLink}</a></li>
      <li><a href="/legal/privacy">{T.privacyLink}</a></li>
    </ul>
    <form method="POST" id="terms">
      <input type="hidden" name="terms_version" value={data.termsVersion} />
      <input type="hidden" name="privacy_version" value={data.privacyVersion} />
      {#if data.next !== null}<input type="hidden" name="next" value={data.next} />{/if}
      <Label><input type="checkbox" name="accept" value="yes" /> {T.accept}</Label>
      {#if data.countryRule}<Label><input type="checkbox" name="country" value="yes" /> {T.country}</Label>{/if}
    </form>
  </Card.Content>
  <Card.Footer><Button type="submit" form="terms">{T.continue}</Button></Card.Footer>
</Card.Root>
<SignOut />
