<!--
  The page for every error answered with HTML (P1.25; P1.20d), in the core shell (P1.20k; signed in, in the member's
  theme, when the gate read a live session, which it does for a path no route matches too: route-table.ts UNMATCHED). It shows only the code
  handleError (hooks.server.ts) returned and, for internal.error, the request id the log line carries: no path, query
  or header reaches it, so nothing the caller sent is echoed.
-->
<script lang="ts">
import { ERROR_MESSAGES } from "@unset/shared-errors";
import { page } from "$app/state";

const code = $derived(page.error?.message ?? "internal.error");
const text = $derived(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code);
</script>

<svelte:head><title>{text}</title></svelte:head>

<h1>{text}</h1>
<p>Error code <code>{code}</code></p>
{#if page.error?.reqId !== undefined}
  <p>Request id, if you contact us: <code>{page.error.reqId}</code></p>
{/if}
<p><a href="/">Go to the home page</a></p>
