<!--
  Settings › Account (P2.13c): the handle (shown only when it resolves back to the DID, P2.02), the DID, the link to
  the sign-in server recorded at sign-in (P2.08b), where the password, email and deletion live, and two sign-out
  forms that post with no script: this browser (/logout), and every browser, this one too (/logout/everywhere,
  P2.08j). The account link opens a new tab, so unset.sh stays open behind it (P2.08k).
-->
<script lang="ts">
import { Icon } from "@unset/apps-web/lib/components/icon";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import type { AccountView } from "../../../lib/server/account.ts";
import { SETTINGS } from "../messages.ts";

let { data }: { data: AccountView & { privacyNotice: boolean } } = $props();

const withHost = (text: string, host: string) => text.replace("{pdsHost}", host);
</script>

<svelte:head>
  <title>{SETTINGS.account}</title>
</svelte:head>

{#if data.privacyNotice}
  <Alert.Root>
    <Alert.Title>{SETTINGS.privacyNoticeTitle}</Alert.Title>
    <Alert.Description><a href="/legal/privacy">{SETTINGS.privacyNotice}</a></Alert.Description>
  </Alert.Root>
{/if}
<h1>{SETTINGS.account}</h1>
<dl>
  <dt>{SETTINGS.handle}</dt>
  <dd><code>{data.handle}</code></dd>
  <dt>{SETTINGS.did}</dt>
  <dd><code>{data.did}</code></dd>
</dl>
{#if data.handleUnavailable}
  <p>{SETTINGS.handleUnavailable}</p>
{/if}
{#if data.accountLink}
  <section>
    <p>{SETTINGS.accountLead}</p>
    {#if data.accountLink.ours}
      <p>{withHost(SETTINGS.accountInterstitial, data.accountLink.host)}</p>
    {/if}
    <a href={data.accountLink.href} target="_blank" rel="noopener noreferrer">
      {withHost(data.accountLink.ours ? SETTINGS.accountOurs : SETTINGS.accountForeign, data.accountLink.host)}
      <Icon name="external" size={16} label={SETTINGS.newTab} />
    </a>
  </section>
{/if}
<form method="post" action="/logout">
  <p>{SETTINGS.signOutNote}</p>
  <Button type="submit">{SETTINGS.signOut}</Button>
</form>
<form method="post" action="/logout/everywhere">
  <p>{SETTINGS.signOutEverywhereNote}</p>
  <Button type="submit">{SETTINGS.signOutEverywhere}</Button>
</form>
