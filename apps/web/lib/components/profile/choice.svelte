<!--
  A labelled choice of a card editor (P1.20i): native radio inputs under a fieldset, so the choice works and posts
  with no script (the stock RadioGroup draws its radios as buttons and submits only a hidden input, bits-ui 2.20.6
  radio-group.svelte, so with no script its value cannot change; staging walkthrough 2026-11-18, finding 8). Coloured
  by the theme's primary token through accent-color. Options with an icon are drawn as tiles, the icon over its word,
  as the profile-card mockup's layout picker (Alex 2026-11-18 12:24Z): the radio stays a native input, transparent
  over the whole tile, so the word is its name, the keyboard and a form with no script work as before, and the tile shows the
  checked and focused states.
-->
<script lang="ts">
import { Icon, type IconName } from "../icon/index.ts";
import { Label } from "../ui/label/index.ts";

let {
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: readonly { value: string; label: string; icon?: IconName }[];
} = $props();
const id = $props.id();
const tiles = $derived(options.every((option) => option.icon !== undefined));
</script>

<fieldset class="grid gap-2">
  <legend class="text-sm font-medium">{label}</legend>
  {#if tiles}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
      {#each options as option (option.value)}
        <label
          class="relative flex cursor-pointer flex-col items-center gap-1.5 rounded-sm border p-3 text-sm text-muted-foreground has-checked:border-foreground has-checked:text-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
        >
          <input type="radio" {name} value={option.value} checked={option.value === value}
            class="absolute inset-0 size-full cursor-pointer appearance-none rounded-sm opacity-0"
          />
          {#if option.icon !== undefined}<Icon name={option.icon} size={24} />{/if}
          {option.label}
        </label>
      {/each}
    </div>
  {:else}
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
  {/if}
</fieldset>
