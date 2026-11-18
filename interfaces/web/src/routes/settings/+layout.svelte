<!--
  The settings layout (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): the settings pages in the side list of
  SettingsLayout. It links only pages that run today. The site shell around it is the root layout's.
-->
<script lang="ts">
import SettingsLayout from "@unset/apps-web/lib/components/settings/settings-layout.svelte";
import type { Snippet } from "svelte";
import { page } from "$app/state";
import { SETTINGS } from "./messages.ts";

let { children }: { children: Snippet } = $props();

const PAGES = [
  { label: SETTINGS.profile, path: "/settings/profile" },
  { label: SETTINGS.account, path: "/settings/account" },
] as const;
</script>

<SettingsLayout label={SETTINGS.label} navLabel={SETTINGS.nav} pages={PAGES} current={page.url.pathname}>
  {@render children()}
</SettingsLayout>
