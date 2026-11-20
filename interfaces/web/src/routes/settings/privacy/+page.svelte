<!--
  Settings › Privacy (P1.21y): who sees the member's page (ADR 0078, P1.22a), then, while it is public, who may find it:
  the Search and AI form (ADR 0062) with its search result preview. A page not shown to everyone is never listed, so
  the Search and AI form is left out until it is public again; the choices stay saved. It needs no script: each form
  posts and comes back here.
-->
<script lang="ts">
import PageVisibilityForm from "@unset/apps-web/lib/components/settings/page-visibility-form.svelte";
import SearchAiForm from "@unset/apps-web/lib/components/settings/search-ai-form.svelte";
import type { ProfileVisibility } from "@unset/apps-web/lib/profile/types.ts";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";

let {
  data,
}: {
  data: {
    visibility: ProfileVisibility | "noProfile" | "unreadable";
    visibilitySaved: boolean;
    discoverability: { searchEngines: boolean; aiSearch: boolean; title: string; description: string };
    limits: { title: number; description: number };
    page: { url: string; name: string; headline: string; letter: string };
    saved: boolean;
    searchListingOff: boolean;
  };
} = $props();
</script>

<svelte:head>
  <title>{SETTINGS.privacy}</title>
</svelte:head>

<h1>{SETTINGS.privacy}</h1>
<PageVisibilityForm value={data.visibility} saved={data.visibilitySaved} />
{#if data.visibility !== "signedIn" && data.visibility !== "ownerOnly"}
  <SearchAiForm
    values={data.discoverability}
    limits={data.limits}
    siteOff={data.searchListingOff}
    saved={data.saved}
    page={data.page}
  />
{/if}
