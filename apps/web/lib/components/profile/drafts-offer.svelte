<!--
  Unsaved words this device kept from an earlier visit (ADR 0074 item 4), offered back on the owner's page under the
  header: bring them back as unsaved changes, or throw them away. Never merged on their own.
-->
<script lang="ts">
import { UNSAVED_BAR } from "../../profile/messages.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";

let { count, onrestore, ondrop }: { count: number; onrestore: () => void; ondrop: () => void } = $props();
</script>

{#if count > 0}
  <Alert.Root role="region" aria-label={UNSAVED_BAR.draftsLabel}>
    <Alert.Description>
      <p>{UNSAVED_BAR.drafts(count)}</p>
      <div class="mt-2 flex gap-2">
        <Button type="button" size="sm" onclick={onrestore}>{UNSAVED_BAR.restore}</Button>
        <Button type="button" size="sm" variant="outline" onclick={ondrop}>{UNSAVED_BAR.dropDrafts}</Button>
      </div>
    </Alert.Description>
  </Alert.Root>
{/if}
