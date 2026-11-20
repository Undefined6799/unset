<!--
  The member's own page (P2.13, ADR 0051; from apps/web/src/screens/Me.tsx, P1.20g, P1.20i; laid out as the
  profile-card mockup, Alex 2026-11-17): the side column with the account at a glance, then the cards with their controls and an editor for each new kind. Everything shown was built by +page.server.ts; card forms post to this page's actions. Sign out and
  the link to the sign-in server live in the account menu and Settings › Account, not here (Alex 2026-11-18). With no script an editor opens in place at the top of the cards
  (CardPanel, from the page's query).
-->
<script lang="ts">
import AddCard from "@unset/apps-web/lib/components/profile/add-card.svelte";
import CardControls from "@unset/apps-web/lib/components/profile/card-controls.svelte";
import CardPanel from "@unset/apps-web/lib/components/profile/card-panel.svelte";
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";
import ProfileSide from "@unset/apps-web/lib/components/profile/profile-side.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { OWN_PAGE } from "@unset/apps-web/lib/profile/messages.ts";
import { enhanceInPlace as enhance } from "../../lib/enhance-in-place.ts";

let { data, form } = $props();
const setUp = $derived(data.profile === null && !data.profileUnavailable);
// The tab names the member: their display name, else their verified handle. An unverified handle reads as
// `handle.invalid` (the protocol's INVALID_HANDLE, @atproto/syntax 0.7.7
// dist/handle.js), which is no name (walkthrough 2026-11-18, finding 6).
const title = $derived(data.account.verified || data.name !== data.account.handle ? data.name : OWN_PAGE.title);
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<ProfileLayout>
  {#snippet notices()}
    {#if form?.message && data.cardPanel === null}
      <Alert.Root variant="destructive" role="alert">
        <Alert.Description>{form.message}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet side()}
    <ProfileSide
      name={data.name}
      letter={data.letter}
      handle={data.profile === null ? null : data.account.handle}
      did={data.account.did}
      headline={data.profile?.headline}
      location={data.profile?.location}
      website={data.profile?.website}
      shape={data.avatarShape}
      edit={data.profile === null ? undefined : { href: "/settings/profile", enhance }}
    >
      {#if data.account.handleUnavailable}<p>{OWN_PAGE.handleUnavailable}</p>{/if}
      {#if data.profileUnavailable}<p>{OWN_PAGE.profileUnavailable}</p>{/if}
      {#if data.cardsIncomplete}<p>{OWN_PAGE.cardsIncomplete}</p>{/if}
      {#if data.cardsOverflow}<p>{OWN_PAGE.cardsOverflow}</p>{/if}
    </ProfileSide>
  {/snippet}

  {#if data.cardPanel !== null}
    <CardPanel
      request={data.cardPanel}
      cards={data.cards}
      limits={data.cardEditLimits}
      shape={data.avatarShape}
      here={`/${data.account.did}`}
      refusal={form}
      {enhance}
    />
  {/if}
  {#if data.profile === null}
    <ProfileCards cards={data.cards} />
  {:else}
    <ProfileCards cards={data.cards}>
      {#snippet controls(index: number)}
        <CardControls cards={data.cards} {index} limits={data.cardEditLimits} {enhance} />
      {/snippet}
      {#snippet add()}
        <AddCard limits={data.cardEditLimits} {enhance} />
      {/snippet}
    </ProfileCards>
  {/if}

  {#if setUp}
    <Card.Root>
      <Card.Header>
        <Card.Description>{OWN_PAGE.setUpEyebrow}</Card.Description>
        <Card.Title>{OWN_PAGE.setUpTitle}</Card.Title>
      </Card.Header>
      <Card.Content><p>{OWN_PAGE.setUpBody}</p></Card.Content>
      <Card.Footer><Button href="/settings/profile">{OWN_PAGE.editProfile}</Button></Card.Footer>
    </Card.Root>
  {/if}
</ProfileLayout>
