<!--
  The Text card's blocks (readme.svelte) with a Copy button in each code block's corner once script runs (Alex
  2026-11-23, "script adds Copy"): the server draws no button that could do nothing. The button is the stock one and
  writes the code to the clipboard as plain text. readme.svelte itself imports no component, so its markup test can
  compile it alone (readme-render.test.ts).
-->
<script lang="ts">
import { onMount } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import type { Block } from "../../profile/types.ts";
import { Button } from "../ui/button/index.ts";
import Readme from "./readme.svelte";

let { blocks }: { blocks: readonly Block[] } = $props();
let scripted = $state(false);
onMount(() => {
  scripted = true;
});
const copy = (text: string) => void navigator.clipboard?.writeText(text);
</script>

{#snippet copyButton(code: string)}<Button
    variant="outline"
    size="sm"
    class="absolute top-2 right-2 h-7 px-2.5 text-xs"
    aria-label={CARD_TEXT.copyCode}
    onclick={() => copy(code)}>{CARD_TEXT.copy}</Button
  >{/snippet}

<Readme {blocks} codeTools={scripted ? copyButton : undefined} />
