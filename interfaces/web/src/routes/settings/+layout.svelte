<!--
  The settings layout (P2.13c; Alex, 2026-10-23 01:11:22Z, "Side list"): the settings pages in the side list of
  SettingsLayout. It links only pages that run today. The site shell around it is the root layout's.
-->
<script lang="ts">
import type { IconName } from "@unset/apps-web/lib/components/icon";
import SettingsLayout from "@unset/apps-web/lib/components/settings/settings-layout.svelte";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import type { Snippet } from "svelte";
import { page } from "$app/state";

let { children }: { children: Snippet } = $props();

const PAGES: readonly { label: string; path: string; icon: IconName }[] = [
  { label: SETTINGS.profile, path: "/settings/profile", icon: "profile" },
  { label: SETTINGS.privacy, path: "/settings/privacy", icon: "hide" },
  { label: SETTINGS.account, path: "/settings/account", icon: "private" },
];
</script>

<SettingsLayout label={SETTINGS.label} navLabel={SETTINGS.nav} pages={PAGES} current={page.url.pathname}>
  {@render children()}
</SettingsLayout>
