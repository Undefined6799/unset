<!--
  The page for every error answered with HTML (P1.25; P1.20d), in the site shell (signed in when the route's
  gate read a live session, +layout.server.ts). It shows only the code
  handleError (hooks.server.ts) returned and, for internal.error, the request id the log line carries: no path, query
  or header reaches it, so nothing the caller sent is echoed. A form post refused whole (too large to send, or a profile
  save with no script) also says how to get back to what was typed: the browser's Back button, which keeps a form's
  text (https://html.spec.whatwg.org/multipage/history.html#persisted-user-state-restoration), and names the field a
  profile save blamed by its label (staging walkthrough 2026-11-18 round two).
-->
<script lang="ts">
import { PROFILE_SETTINGS } from "@unset/apps-web/lib/settings/messages.ts";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import { page } from "$app/state";

const code = $derived(page.error?.message ?? "internal.error");
const text = $derived(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code);
/** The profile fields a refused save may blame, by their form names (routes/profile). */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  displayName: PROFILE_SETTINGS.displayName,
  headline: PROFILE_SETTINGS.headline,
  location: PROFILE_SETTINGS.location,
  website: PROFILE_SETTINGS.website,
};
const field = $derived(page.error?.field === undefined ? undefined : FIELD_LABELS[page.error.field]);
const fromForm = $derived(code === "http.payload_too_large" || code.startsWith("profile."));
</script>

<svelte:head><title>{text}</title></svelte:head>

<h1>{text}</h1>
{#if field !== undefined}<p>Check {field}.</p>{/if}
{#if fromForm}
  <p>Use your browser's Back button to return to the form. What you typed is usually still there.</p>
{/if}
<p>Error code <code>{code}</code></p>
{#if page.error?.reqId !== undefined}
  <p>Request id, if you contact us: <code>{page.error.reqId}</code></p>
{/if}
<p><a href="/">Go to the home page</a></p>
