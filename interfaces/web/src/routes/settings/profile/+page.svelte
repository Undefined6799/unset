<!--
  Settings › Profile (P2.13c): the profile's fields, as the member's PDS holds them, in the settings form that posts to
  /profile, the one profile save (submit handler: submit.ts, P1.20s), then Search and AI (ADR 0062). When the PDS
  could not be read the page says so and offers no form, so a save never starts from fields that were not loaded.
-->
<script lang="ts">
import ProfileForm from "@unset/apps-web/lib/components/settings/profile-form.svelte";
import SearchAiForm from "@unset/apps-web/lib/components/settings/search-ai-form.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { PROFILE_SETTINGS, SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import type { ProfileFormStatus } from "@unset/apps-web/lib/settings/profile-form.ts";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import type { Action } from "svelte/action";
import { enhance } from "$app/forms";
import { profileSubmit } from "./submit.ts";

type Values = { displayName: string; headline: string; location: string; website: string };
let {
  data,
}: {
  data: {
    profile: Values | null;
    limits: { displayName: number; headline: number; location: number };
    pagePath: string;
    discoverability: { searchEngines: boolean; aiSearch: boolean; title: string; description: string };
    discoverabilityLimits: { title: number; description: number };
    saved: boolean;
  };
} = $props();

const messageFor = (code: string | undefined): string | undefined =>
  code !== undefined && code in ERROR_MESSAGES ? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] : undefined;

// The submit handler's status once the member has submitted; before that, saved when the page is a save's return.
let submitted: ProfileFormStatus | undefined = $state(undefined);
const status: ProfileFormStatus = $derived(submitted ?? (data.saved ? { kind: "saved" } : { kind: "editing" }));
const save: Action<HTMLFormElement> = (form) =>
  enhance(
    form,
    profileSubmit((next) => {
      submitted = next;
    }),
  );
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
  <ProfileForm values={data.profile} limits={data.limits} pagePath={data.pagePath} {messageFor} enhance={save} {status} />
{/if}
<SearchAiForm values={data.discoverability} limits={data.discoverabilityLimits} />
