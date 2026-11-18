<!-- Settings › Profile (P2.13c): what will be edited here, and that the profile stays private until published. -->
<script lang="ts">
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { SETTINGS } from "../messages.ts";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{SETTINGS.profile}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if data.privacyNotice}
  <Alert.Root>
    <Alert.Title>{SETTINGS.privacyNoticeTitle}</Alert.Title>
    <Alert.Description><a href="/legal/privacy">{SETTINGS.privacyNotice}</a></Alert.Description>
  </Alert.Root>
{/if}
<h1>{SETTINGS.profile}</h1>
<Card.Root>
  <Card.Header>
    <Card.Description>{SETTINGS.setUpEyebrow}</Card.Description>
    <Card.Title>{SETTINGS.setUpTitle}</Card.Title>
  </Card.Header>
  <Card.Content>{SETTINGS.setUpBody}</Card.Content>
</Card.Root>
