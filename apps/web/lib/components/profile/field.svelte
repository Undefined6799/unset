<!--
  One labelled text field of a card editor (P1.20i): the stock Label over the stock Input or Textarea. A refused save
  that blames this field shows `error` under it, marks it invalid (the stock inputs style aria-invalid) and reads the
  error with it.
-->
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
  error,
  maxlength,
}: {
  label: string;
  name: string;
  value: string;
  hint?: string;
  /** Set for a multi-line field. */
  rows?: number;
  type?: "text" | "email";
  required?: boolean;
  inputmode?: "url" | "email";
  autocomplete?: "url" | "email";
  error?: string;
  /** Only where the limit is one maxlength can keep: see CardEditLimits text. */
  maxlength?: number;
} = $props();
const id = $props.id();
const described = $derived(
  [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`]
    .filter((x) => x !== "")
    .join(" ") || undefined,
);
const invalid = $derived(error === undefined ? undefined : ("true" as const));
</script>

<div class="grid gap-2">
  <Label for={id}>{label}</Label>
  {#if rows === undefined}
    <Input {id} {name} {type} {value} {required} {inputmode} {autocomplete} aria-invalid={invalid} aria-describedby={described} />
  {:else}
    <Textarea {id} {name} {value} {rows} {required} {maxlength} aria-invalid={invalid} aria-describedby={described} />
  {/if}
  {#if hint !== undefined}<p id="{id}-hint" class="text-muted-foreground text-sm">{hint}</p>{/if}
  {#if error !== undefined}<p id="{id}-error" class="text-destructive text-sm">{error}</p>{/if}
</div>
