<!--
  Above the member's own public page (/@handle) when the member is the one looking: this is how others see it, and a
  plain link back to the page they edit (/did, routes/[did=did]). A link, not a control, so the public page still runs
  no script. The server sends it only to the signed-in owner, on a copy that is private and never stored.
-->
<script lang="ts">
import { OWN_PUBLIC_VIEW } from "../../profile/messages.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";

let { href }: { href: string } = $props();
</script>

<Alert.Root data-own-public-view>
  <Alert.Title>{OWN_PUBLIC_VIEW.title}</Alert.Title>
  <Alert.Description><Button {href} variant="outline" size="sm">{OWN_PUBLIC_VIEW.edit}</Button></Alert.Description>
</Alert.Root>
