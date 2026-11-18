<!-- One labelled text field of a card editor (P1.20i): the stock Label over the stock Input or Textarea. -->
<script lang="ts">
import { Input } from "../ui/input/index.ts";
import { Label } from "../ui/label/index.ts";
import { Textarea } from "../ui/textarea/index.ts";

let {
  label,
  name,
  value,
  hint,
  rows,
  type = "text",
  required = false,
  inputmode,
  autocomplete,
}: {
  label: string;
  name: string;
  value: string;
  hint?: string;
  /** Set for a multi-line field. */
  rows?: number;
  type?: "text" | "email";
  required?: boolean;
  inputmode?: "url";
  autocomplete?: "url" | "email";
} = $props();
const id = $props.id();
</script>

<div class="grid gap-2">
  <Label for={id}>{label}</Label>
  {#if rows === undefined}
    <Input {id} {name} {type} {value} {required} {inputmode} {autocomplete} />
  {:else}
    <Textarea {id} {name} {value} {rows} {required} aria-describedby={hint === undefined ? undefined : `${id}-hint`} />
  {/if}
  {#if hint !== undefined}<p id="{id}-hint" class="text-muted-foreground text-sm">{hint}</p>{/if}
</div>
