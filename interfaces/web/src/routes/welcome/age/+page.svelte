<script lang="ts">
// The age step (P2.12). The confirm view only repeats the date the person sent; it lives only in this page's form.
// Both forms post to the step's own path, never to the URL they were shown at: a refused date comes back as
// ?error=, and posting there kept the old error above the next answer's confirm view (staging audit 2026-11-19).
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Input } from "@unset/apps-web/lib/components/ui/input";
import { Label } from "@unset/apps-web/lib/components/ui/label";
import { WELCOME as T } from "../messages.ts";
import SignOut from "../sign-out.svelte";

let { form } = $props();

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const confirm = $derived(form?.confirm);
</script>

<svelte:head><title>{confirm === undefined ? T.ageTitle : T.ageConfirmTitle}</title></svelte:head>

<Card.Root>
  {#if confirm === undefined}
    <Card.Header><Card.Title><h1>{T.ageTitle}</h1></Card.Title></Card.Header>
    <Card.Content>
      <form method="POST" action="/welcome/age" id="age">
        {#each [["day", T.day], ["month", T.month], ["year", T.year]] as [name, label] (name)}
          <Label for={name}>{label}</Label>
          <Input id={name} {name} type="text" inputmode="numeric" autocomplete="off" />
        {/each}
      </form>
    </Card.Content>
    <Card.Footer><Button type="submit" form="age">{T.continue}</Button></Card.Footer>
  {:else}
    <Card.Header>
      <Card.Title><h1>{T.ageConfirmTitle}</h1></Card.Title>
      <Card.Description>
        {T.ageConfirmLead} {LONG_DATE.format(new Date(Date.UTC(confirm.year, confirm.month - 1, confirm.day)))}.
      </Card.Description>
    </Card.Header>
    <Card.Footer>
      <form method="POST" action="/welcome/age">
        <input type="hidden" name="day" value={confirm.day} />
        <input type="hidden" name="month" value={confirm.month} />
        <input type="hidden" name="year" value={confirm.year} />
        <input type="hidden" name="confirmed" value="yes" />
        <Button type="submit">{T.ageConfirm}</Button>
      </form>
      <Button href="/welcome/age" variant="link">{T.ageChange}</Button>
    </Card.Footer>
  {/if}
</Card.Root>
<SignOut />
