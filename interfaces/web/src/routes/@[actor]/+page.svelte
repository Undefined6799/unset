<!--
  A member's public profile (P3.12s): the owner's page (routes/[did=did]) without its controls, the same side column
  and cards, drawn with no script. Everything shown was built by +page.server.ts from the member's published records.
-->
<script lang="ts">
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";
import ProfileSide from "@unset/apps-web/lib/components/profile/profile-side.svelte";

let { data } = $props();
</script>

<svelte:head>
  <title>{data.name}</title>
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
