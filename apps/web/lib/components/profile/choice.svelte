<!--
  A labelled choice of a card editor (P1.20i): native radio inputs under a fieldset, so the choice works and posts
  with no script (the stock RadioGroup draws its radios as buttons and submits only a hidden input, bits-ui 2.20.6
  radio-group.svelte, so with no script its value cannot change; staging walkthrough 2026-11-18, finding 8). Coloured
  by the theme's primary token through accent-color.
-->
<script lang="ts">
import { Label } from "../ui/label/index.ts";

let {
  label,
  name,
  value,
  options,
}: { label: string; name: string; value: string; options: readonly { value: string; label: string }[] } = $props();
const id = $props.id();
</script>

<fieldset class="grid gap-2">
  <legend class="text-sm font-medium">{label}</legend>
  <div class="flex flex-wrap gap-4">
    {#each options as option (option.value)}
      <div class="flex items-center gap-2">
        <input
          type="radio"
          {name}
          value={option.value}
          id="{id}-{option.value}"
          checked={option.value === value}
          class="size-4 shrink-0 accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <Label for="{id}-{option.value}">{option.label}</Label>
      </div>
    {/each}
  </div>
</fieldset>
