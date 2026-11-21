<!--
  A member's public profile (P3.12s): the owner's page (routes/[did=did]) without its controls, the same profile
  header and cards (ADR 0077), drawn with no script, with the title, description, canonical link and link-preview tags
  search engines and sharing read (review plan 2026-11-18 §7.1; no image until the media proxy). Everything shown was built by +page.server.ts from the member's published records.
  When the member's choice leaves the viewer out (ADR 0078), the limited page: one centered card with only the avatar,
  name, handle and DID and one sentence, no cards and no link-preview tags. A page shown to fewer than everyone says
  so above it, and gives link previews nothing.
-->
<script lang="ts">
import LimitedProfile from "@unset/apps-web/lib/components/profile/limited-profile.svelte";
import PageAudience from "@unset/apps-web/lib/components/profile/page-audience.svelte";
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileHeader from "@unset/apps-web/lib/components/profile/profile-header.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";

let { data } = $props();
</script>

<svelte:head>
  {#if data.limited !== undefined || data.meta === null}
    <title>{data.name}</title>
  {:else}
  <title>{data.meta.title}</title>
  {#if data.meta.description !== ""}<meta name="description" content={data.meta.description} />{/if}
  <link rel="canonical" href={data.meta.url} />
  <meta property="og:type" content="profile" />
  <meta property="og:title" content={data.meta.title} />
  {#if data.meta.description !== ""}<meta property="og:description" content={data.meta.description} />{/if}
  <meta property="og:url" content={data.meta.url} />
  <meta name="twitter:card" content="summary" />
  {/if}
</svelte:head>

{#if data.limited !== undefined}
  <LimitedProfile
    name={data.name}
    letter={data.letter}
    handle={data.handle}
    did={data.did}
    shape={data.avatarShape}
    signIn={data.limited.signIn}
    signUp={data.limited.signUp}
  />
{:else}

<ProfileLayout>
  {#snippet notices()}
    {#if data.audience !== null}<PageAudience audience={data.audience} />{/if}
  {/snippet}
  {#snippet header()}
    <ProfileHeader
      name={data.name}
      letter={data.letter}
      handle={data.handle}
      did={data.did}
      headline={data.headline}
      location={data.location}
      website={data.website}
      contact={data.contact}
      shape={data.avatarShape}
    />
  {/snippet}

  <ProfileCards cards={data.cards} />
</ProfileLayout>
{/if}
