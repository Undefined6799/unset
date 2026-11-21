<!--
  Above a member's page that is not shown to everyone (ADR 0078): who else sees it, so the owner, or a signed-in member
  on a page for members, knows it is not public.
-->
<script lang="ts">
import { PAGE_AUDIENCE } from "../../profile/messages.ts";
import * as Alert from "../ui/alert/index.ts";

let { audience }: { audience: "signedIn" | "ownerOnly" } = $props();
</script>

<Alert.Root data-page-audience={audience}><Alert.Title>{PAGE_AUDIENCE[audience]}</Alert.Title></Alert.Root>
