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
import { SETTINGS } from "../messages.ts";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

const withHost = (text: string, host: string) => text.replace("{pdsHost}", host);
</script>

<svelte:head>
  <title>{SETTINGS.account}</title>
  <meta name="robots" content="noindex" />
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
{#if data.link}
  <section>
    <p>{SETTINGS.accountLead}</p>
    {#if data.link.ours}
      <p>{withHost(SETTINGS.accountInterstitial, data.link.host)}</p>
    {/if}
    <a href={data.link.href} target="_blank" rel="noopener noreferrer">
      {withHost(data.link.ours ? SETTINGS.accountOurs : SETTINGS.accountForeign, data.link.host)}
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
