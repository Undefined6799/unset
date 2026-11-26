<!--
  Who a chat partner is, part of the chat page's shell (ADR 0099; ADR 0055 point 2): their public profile name with
  their handle under it in muted text, or the handle alone while the door has not answered and when it has no name for
  them (ADR 0107: hidden, erased, or no profile). The name was cleaned and cut by core/public-name.ts; both are the
  member's own text, which Svelte escapes, and nothing here renders markup.
-->
<script lang="ts">
let { chatId, handle, names }: { chatId: string; handle: string; names: (chatId: string) => Promise<string | null> } =
  $props();

let name: string | null = $state(null);
$effect(() => {
  let current = true;
  name = null;
  void names(chatId).then((found) => {
    if (current) name = found;
  });
  return () => {
    current = false;
  };
});
</script>

<span class="flex min-w-0 flex-col text-start" data-person={name === null ? "handle" : "name"}>
  {#if name === null}
    <span class="truncate">{handle}</span>
  {:else}
    <span class="truncate" data-name>{name}</span>
    <span class="text-muted-foreground truncate text-xs font-normal" data-handle>{handle}</span>
  {/if}
</span>
