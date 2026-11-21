<!--
  The chat page's shell (ADR 0088): one card for where the page stands. The words are ours alone; no screen names the
  servers behind it. Unlocking with the recovery key is build step 8, conversations step 9: the locked and ready cards
  hold their places until then. An error shows only its fixed code.
-->
<script lang="ts">
import { onMount } from "svelte";
import { boot } from "./boot.ts";
import type { ChatState } from "./core/chat.ts";
import { hopPath } from "./core/sign-in.ts";
import { Button } from "./lib/components/ui/button/index.js";
import * as Card from "./lib/components/ui/card/index.js";

let state: ChatState = $state({ kind: "signing_in" });

const WORDS = {
  signing_in: { title: "Opening your messages", text: "One moment." },
  locked: {
    title: "Unlock your messages",
    text: "This browser needs your recovery key before it can show your messages.",
  },
  ready: { title: "Your messages", text: "No conversations yet." },
  signed_out: { title: "Signing you in again", text: "One moment." },
  error: { title: "Messages could not open", text: "Try again in a moment." },
} as const;
const words = $derived(WORDS[state.kind]);

onMount(() => {
  void boot((next) => (state = next));
});
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4" aria-live="polite" data-state={state.kind}>
  <Card.Root>
    <Card.Header>
      <Card.Title><h1>{words.title}</h1></Card.Title>
      <Card.Description>{words.text}</Card.Description>
    </Card.Header>
    {#if state.kind === "error"}
      <Card.Content class="flex flex-col items-start gap-4">
        <p class="text-muted-foreground font-mono text-sm">{state.code}</p>
        <Button href={hopPath("/")}>Try again</Button>
      </Card.Content>
    {/if}
  </Card.Root>
</main>
