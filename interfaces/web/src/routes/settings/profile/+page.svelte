<!--
  Settings › Profile (P2.13c): the profile's fields, as the member's PDS holds them, in the settings form that posts to
  /profile, the one profile save. When the PDS could not be read the page says so and offers no form, so a save never
  starts from fields that were not loaded.
-->
<script lang="ts">
import ProfileForm from "@unset/apps-web/lib/components/settings/profile-form.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { PROFILE_SETTINGS, SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import { enhance } from "$app/forms";

type Values = { displayName: string; headline: string; location: string; website: string };
let {
  data,
}: {
  data: {
    profile: Values | null;
    limits: { displayName: number; headline: number; location: number };
    pagePath: string;
  };
} = $props();

const messageFor = (code: string | undefined): string | undefined =>
  code !== undefined && code in ERROR_MESSAGES ? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] : undefined;
</script>

<svelte:head>
  <title>{SETTINGS.profile}</title>
</svelte:head>

<h1>{SETTINGS.profile}</h1>
{#if data.profile === null}
  <Alert.Root>
    <Alert.Title>{PROFILE_SETTINGS.unavailableTitle}</Alert.Title>
    <Alert.Description>{PROFILE_SETTINGS.unavailable}</Alert.Description>
  </Alert.Root>
{:else}
  <ProfileForm values={data.profile} limits={data.limits} pagePath={data.pagePath} {messageFor} {enhance} />
{/if}
