<!--
  A member's public profile (P3.12s): the owner's page (routes/[did=did]) without its controls, the same side column
  and cards, drawn with no script, with the title, description, canonical link and link-preview tags
  search engines and sharing read (review plan 2026-11-18 §7.1; no image until the media proxy). Everything shown was built by +page.server.ts from the member's published records.
-->
<script lang="ts">
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";
import ProfileSide from "@unset/apps-web/lib/components/profile/profile-side.svelte";

let { data } = $props();
</script>

<svelte:head>
  <title>{data.meta.title}</title>
  {#if data.meta.description !== ""}<meta name="description" content={data.meta.description} />{/if}
  <link rel="canonical" href={data.meta.url} />
  <meta property="og:type" content="profile" />
  <meta property="og:title" content={data.meta.title} />
  {#if data.meta.description !== ""}<meta property="og:description" content={data.meta.description} />{/if}
  <meta property="og:url" content={data.meta.url} />
  <meta name="twitter:card" content="summary" />
</svelte:head>

<ProfileLayout>
  {#snippet side()}
    <ProfileSide
      name={data.name}
      letter={data.letter}
      handle={data.handle}
      did={data.did}
      headline={data.headline}
      location={data.location}
      website={data.website}
      shape={data.avatarShape}
    />
  {/snippet}

  <ProfileCards cards={data.cards} handle={data.handle} />
</ProfileLayout>
