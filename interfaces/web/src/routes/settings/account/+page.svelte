<!--
  Settings › Account (P2.13c): the account, the sign-in server link and the two sign-out forms, drawn by the settings
  component. The changed privacy notice banner is the shell's (+layout.svelte, P2.12b).
-->
<script lang="ts">
import AccountSettings from "@unset/apps-web/lib/components/settings/account-settings.svelte";
import { SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import type { AccountView } from "../../../lib/server/account.ts";

let { data }: { data: AccountView } = $props();
</script>

<svelte:head>
  <title>{SETTINGS.account}</title>
</svelte:head>

<h1>{SETTINGS.account}</h1>
<AccountSettings
  handle={data.handle}
  did={data.did}
  handleUnavailable={data.handleUnavailable}
  accountLink={data.accountLink}
/>
