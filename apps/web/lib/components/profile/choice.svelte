<!-- A labelled choice of a card editor (P1.20i): the stock RadioGroup, which submits `name` through its hidden input
     (bits-ui 2.20.6 radio-group.svelte renders RadioGroupInput when `name` is set). -->
<script lang="ts">
import { Label } from "../ui/label/index.ts";
import * as RadioGroup from "../ui/radio-group/index.ts";

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
  <RadioGroup.Root {name} {value} class="flex flex-wrap gap-4">
    {#each options as option (option.value)}
      <div class="flex items-center gap-2">
        <RadioGroup.Item value={option.value} id="{id}-{option.value}" />
        <Label for="{id}-{option.value}">{option.label}</Label>
      </div>
    {/each}
  </RadioGroup.Root>
</fieldset>
