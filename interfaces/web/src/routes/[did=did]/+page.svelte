<!--
  The member's own page (P2.13, ADR 0051; from apps/web/src/screens/Me.tsx, P1.20g, P1.20i; laid out as the
  profile-card mockup, Alex 2026-11-17): the side column with the account at a glance, the link to the sign-in server
  and sign-out, then the cards with their controls and an editor for each new kind. Everything shown was built by +page.server.ts; card forms post to this page's actions.
-->
<script lang="ts">
import { Icon } from "@unset/apps-web/lib/components/icon";
import CardControls from "@unset/apps-web/lib/components/profile/card-controls.svelte";
import CardEditor from "@unset/apps-web/lib/components/profile/card-editor.svelte";
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";
import ProfileSide from "@unset/apps-web/lib/components/profile/profile-side.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import {
  BUTTONS_EDIT,
  CARD_EDIT,
  COLLECTION_EDIT,
  LINKS_EDIT,
  OWN_PAGE,
} from "@unset/apps-web/lib/profile/messages.ts";
import { enhance } from "$app/forms";

let { data, form } = $props();
const link = $derived(data.account.accountLink);
const withHost = (text: string, host: string) => text.replace("{pdsHost}", host);
const setUp = $derived(data.profile === null && !data.profileUnavailable);
const readmeHandle = $derived(data.account.verified ? data.account.handle : null);
</script>

<svelte:head>
  <title>{data.account.handle}</title>
</svelte:head>

<ProfileLayout>
  {#snippet notices()}
    {#if data.privacyNotice}
      <Alert.Root>
        <Alert.Title>{OWN_PAGE.privacyNoticeTitle}</Alert.Title>
        <Alert.Description><a href="/legal/privacy">{OWN_PAGE.privacyNotice}</a></Alert.Description>
      </Alert.Root>
    {/if}
    {#if form?.message}
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
      edit={data.profile === null ? undefined : { href: "/settings/profile", label: OWN_PAGE.editProfile }}
    >
      {#if data.account.handleUnavailable}<p>{OWN_PAGE.handleUnavailable}</p>{/if}
      {#if data.profileUnavailable}<p>{OWN_PAGE.profileUnavailable}</p>{/if}
      {#if data.cardsIncomplete}<p>{OWN_PAGE.cardsIncomplete}</p>{/if}
      {#if link !== null}
        {#if link.ours}<p>{withHost(OWN_PAGE.accountInterstitial, link.host)}</p>{/if}
        <p>
          <a href={link.href} target="_blank" rel="noopener noreferrer"
            >{withHost(link.ours ? OWN_PAGE.accountOurs : OWN_PAGE.accountForeign, link.host)}
            <Icon name="external" size={16} label={` ${OWN_PAGE.newTab}`} /></a
          >
        </p>
      {/if}
      <form method="POST" action="/logout">
        <Button type="submit" variant="outline" size="sm">{OWN_PAGE.signOut}</Button>
      </form>
    </ProfileSide>
  {/snippet}

  {#if data.profile === null}
    <ProfileCards cards={data.cards} handle={readmeHandle} />
  {:else}
    <ProfileCards cards={data.cards} handle={readmeHandle}>
      {#snippet controls(index: number)}
        <CardControls cards={data.cards} {index} limits={data.cardEditLimits} {enhance} />
      {/snippet}
      {#snippet add()}
        <CardEditor
          kind="readme"
          width="full"
          trigger={CARD_EDIT.addReadme}
          title={CARD_EDIT.addReadme}
          submit={CARD_EDIT.add}
          max={0}
          {enhance}
        />
        <CardEditor
          kind="links"
          width="full"
          trigger={LINKS_EDIT.add}
          title={LINKS_EDIT.add}
          submit={CARD_EDIT.add}
          max={data.cardEditLimits.links}
          {enhance}
        />
        <CardEditor
          kind="collection"
          width="full"
          trigger={COLLECTION_EDIT.add}
          title={COLLECTION_EDIT.add}
          submit={CARD_EDIT.add}
          max={data.cardEditLimits.collection}
          {enhance}
        />
        <CardEditor
          kind="buttons"
          width="half"
          trigger={BUTTONS_EDIT.add}
          title={BUTTONS_EDIT.add}
          submit={CARD_EDIT.add}
          max={data.cardEditLimits.buttons}
          {enhance}
        />
      {/snippet}
    </ProfileCards>
    <noscript><p>{CARD_EDIT.noScript}</p></noscript>
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
