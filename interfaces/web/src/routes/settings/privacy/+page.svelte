<!--
  Settings › Privacy (P1.21y): who may find the member's public page, the Search and AI form (ADR 0062) with its
  search result preview. It needs no script: the form posts to /settings/search-and-ai and comes back here.
-->
<script lang="ts">
import SearchAiForm from "@unset/apps-web/lib/components/settings/search-ai-form.svelte";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";

let {
  data,
}: {
  data: {
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
<SearchAiForm
  values={data.discoverability}
  limits={data.limits}
  siteOff={data.searchListingOff}
  saved={data.saved}
  page={data.page}
/>
