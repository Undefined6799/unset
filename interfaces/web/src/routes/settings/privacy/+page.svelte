<!--
  Settings › Privacy (P1.21y; ADR 0078, P1.22a): who sees the member's page and, under Public, the Search and AI
  choices (ADR 0062) with their search result preview, in one form (privacy-form.svelte). It needs no script: the
  form posts to /settings/search-and-ai and comes back here.
-->
<script lang="ts">
import PrivacyForm from "@unset/apps-web/lib/components/settings/privacy-form.svelte";
import type { ProfileVisibility } from "@unset/apps-web/lib/profile/types.ts";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";

let {
  data,
}: {
  data: {
    visibility: ProfileVisibility | "noProfile" | "unreadable";
    discoverability: { searchEngines: boolean; aiSearch: boolean; title: string; description: string };
    limits: { title: number; description: number };
    page: { url: string; name: string; headline: string; letter: string };
    saved: boolean;
    catchingUp: boolean;
    searchListingOff: boolean;
  };
} = $props();
</script>

<svelte:head>
  <title>{SETTINGS.privacy}</title>
</svelte:head>

<h1>{SETTINGS.privacy}</h1>
<PrivacyForm
  visibility={data.visibility}
  search={{ values: data.discoverability, limits: data.limits, siteOff: data.searchListingOff, page: data.page }}
  saved={data.saved}
  catchingUp={data.catchingUp}
/>
