<!--
  The Text card's blocks (readme.svelte) with a copy button in each code block's corner once script runs (Alex
  2026-11-23, "script adds Copy"; just the copy icon, "just a copy icon would be fine no?"): the server draws no button that could do nothing. The button is the stock one and
  writes the code to the clipboard as plain text. readme.svelte itself imports no component, so its markup test can
  compile it alone (readme-render.test.ts).
-->
<script lang="ts">
import { onMount } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import type { Block, TableLines } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import Readme from "./readme.svelte";

let { blocks, lines }: { blocks: readonly Block[]; lines?: TableLines } = $props();
let scripted = $state(false);
onMount(() => {
  scripted = true;
});
const copy = (text: string) => void navigator.clipboard?.writeText(text);
</script>

{#snippet copyButton(code: string)}<Button
    variant="outline"
    size="icon-sm"
    class="absolute top-2 right-2"
    aria-label={CARD_TEXT.copyCode}
    onclick={() => copy(code)}><Icon name="copy" size={16} /></Button
  >{/snippet}

<Readme {blocks} {lines} codeTools={scripted ? copyButton : undefined} />
