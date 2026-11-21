<!--
  The chat page's shell (ADR 0088): one card for where the page stands. The words are ours alone; no screen names the
  servers or the protocol behind it. A new account saves its recovery key here before anything else (ADR 0083
  decision 2, ADR 0089), and a new browser unlocks with it (decision 3); then the conversations (build step 9, Conversations.svelte). An error
  shows only its fixed code.
  The key fields follow Chromium's documented form shape, a username field (hidden) and a password field marked
  new-password to save and current-password to fill
  (https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/, read 2026-11-21;
  HTML autofill tokens, https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill). Whether a
  password manager offers to save the shown key is unverified.
-->
<script lang="ts">
import { onMount } from "svelte";
import { boot } from "./boot.ts";
import Conversations from "./Conversations.svelte";
import type { ChatState, UnlockOutcome } from "./core/chat.ts";
import { CHECK_LENGTH, KEY_FILE_NAME, keyFileText, matchesEnd } from "./core/recovery-key.ts";
import { hopPath } from "./core/sign-in.ts";
import * as Alert from "./lib/components/ui/alert/index.js";
import { Button } from "./lib/components/ui/button/index.js";
import * as Card from "./lib/components/ui/card/index.js";
import { Input } from "./lib/components/ui/input/index.js";

let view: ChatState = $state({ kind: "signing_in" });
let ending = $state("");
let endWrong = $state(false);
let typedKey = $state("");
let unlockProblem: Exclude<UnlockOutcome, "unlocked"> | null = $state(null);
let unlocking = $state(false);

/** What a password manager files the key under. */
const KEY_NAME = "Messages recovery key";

const WORDS = {
  signing_in: { title: "Opening your messages", text: "One moment." },
  setting_up: { title: "Protecting your messages", text: "One moment." },
  save_key: {
    title: "Save your recovery key",
    text: "Your recovery key is the only way to read your messages in a new browser. Nobody else has it, and we cannot get it back for you.",
  },
  setup_elsewhere: {
    title: "Finish in your other browser",
    text: "Your messages are being set up in another browser. Finish there, or try again here in a few minutes.",
  },
  locked: {
    title: "Unlock your messages",
    text: "Enter your recovery key to read your messages in this browser.",
  },
  ready: { title: "Your messages", text: "" },
  signed_out: { title: "Signing you in again", text: "One moment." },
  error: { title: "Messages could not open", text: "Try again in a moment." },
} as const;
const words = $derived(WORDS[view.kind]);

const UNLOCK_PROBLEMS = {
  wrong_key: "That is not your recovery key. Check it and try again.",
  unfinished: "Setting up is not finished yet. Finish it in the browser where you started.",
  failed: "Your messages could not be unlocked. Try again in a moment.",
} as const;

/** The key as a text file, made here and handed to the browser's own download; it is never sent anywhere. */
function download(key: string) {
  const url = URL.createObjectURL(new Blob([keyFileText(key)], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = KEY_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

function checkEnd(event: SubmitEvent) {
  event.preventDefault();
  if (view.kind !== "save_key") return;
  endWrong = !matchesEnd(ending, view.key);
  if (endWrong) return;
  ending = "";
  view.save();
}

async function tryKey(event: SubmitEvent) {
  event.preventDefault();
  if (view.kind !== "locked" || unlocking) return;
  unlocking = true;
  const outcome = await view.unlock(typedKey);
  unlocking = false;
  unlockProblem = outcome === "unlocked" ? null : outcome;
  if (outcome === "unlocked") typedKey = "";
}

onMount(() => {
  void boot((next) => (view = next));
});
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4" aria-live="polite" data-state={view.kind}>
  <Card.Root>
    <Card.Header>
      <Card.Title><h1>{words.title}</h1></Card.Title>
      {#if view.kind !== "ready"}<Card.Description>{words.text}</Card.Description>{/if}
    </Card.Header>
    {#if view.kind === "save_key"}
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={checkEnd}>
          <input class="hidden" name="username" autocomplete="username" value={KEY_NAME} readonly tabindex="-1" />
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="recovery-key">Your recovery key</label>
            <Input
              id="recovery-key"
              name="recovery-key"
              class="font-mono"
              readonly
              autocomplete="new-password"
              spellcheck="false"
              value={view.key}
            />
            <Button type="button" variant="outline" onclick={() => view.kind === "save_key" && download(view.key)}>
              Download
            </Button>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="key-end">
              To check you have saved it, type the last {CHECK_LENGTH} characters of your key
            </label>
            <Input
              id="key-end"
              class="font-mono"
              autocomplete="off"
              spellcheck="false"
              aria-invalid={endWrong}
              aria-describedby={endWrong ? "key-end-wrong" : undefined}
              bind:value={ending}
            />
            {#if endWrong}
              <p id="key-end-wrong" class="text-sm">
                That does not match the end of your key. Check what you saved and try again.
              </p>
            {/if}
          </div>
          <Button type="submit">Continue</Button>
        </form>
      </Card.Content>
    {:else if view.kind === "locked"}
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={tryKey}>
          <input class="hidden" name="username" autocomplete="username" value={KEY_NAME} readonly tabindex="-1" />
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="unlock-key">Recovery key</label>
            <Input
              id="unlock-key"
              name="recovery-key"
              type="password"
              class="font-mono"
              autocomplete="current-password"
              spellcheck="false"
              required
              aria-invalid={unlockProblem === "wrong_key"}
              bind:value={typedKey}
            />
          </div>
          {#if unlockProblem !== null}
            <Alert.Root>
              <Alert.Description>{UNLOCK_PROBLEMS[unlockProblem]}</Alert.Description>
            </Alert.Root>
          {/if}
          <Button type="submit" disabled={unlocking}>{unlocking ? "Unlocking…" : "Unlock"}</Button>
        </form>
      </Card.Content>
    {:else if view.kind === "ready"}
      <Card.Content>
        <Conversations conversations={view.conversations} me={view.me} />
      </Card.Content>
    {:else if view.kind === "setup_elsewhere" || view.kind === "error"}
      <Card.Content class="flex flex-col items-start gap-4">
        {#if view.kind === "error"}
          <p class="text-muted-foreground font-mono text-sm">{view.code}</p>
        {/if}
        <Button href={hopPath("/")}>Try again</Button>
      </Card.Content>
    {/if}
  </Card.Root>
</main>
