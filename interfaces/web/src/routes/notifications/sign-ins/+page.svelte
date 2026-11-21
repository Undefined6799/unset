<!--
  The Sign-in history tab (P2.27c, ADR 0082): the list the server read, in the notifications page's frame. Works with
  no script.
-->
<script lang="ts">
import SignInHistory from "@unset/apps-web/lib/components/notifications/sign-in-history.svelte";
import { SIGN_INS as T } from "@unset/apps-web/lib/notifications/messages.ts";

let { data } = $props();
</script>

<svelte:head><title>{T.title}</title></svelte:head>

<SignInHistory view={data.signIns} />
