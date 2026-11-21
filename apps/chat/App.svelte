<!--
  The chat page's shell (ADR 0099): one card for where the page stands. The words are ours alone; no screen names the
  servers or the protocol behind it. A new account saves its recovery key here before anything else (ADR 0095
  decision 2, ADR 0100), and a new browser unlocks with it (decision 3); then the conversations (build step 9, Conversations.svelte). An error
  shows only its fixed code. A second tab says the messages are open in the other one and offers to use them here
  (core/tab-lock.ts, as Element's ConfirmSessionLockTheftView does). There is no Log out here: unset.sh's Log out
  signs this browser out of messages too (Alex 2026-11-21), and this card only says so while it runs.
  Saving the key takes two cards (Alex, 2026-11-21, from the mock-up thread): the first shows the key to save or
  download; on the second the key is hidden and the member types its last characters, the check Element makes before
  it writes the vault (ADR 0100 decision 3); "Show my key again" goes back. The page is still in save_key throughout,
  so nothing is stored until the check passes.
  Opened from signup's chat step (book P6.17), at /welcome, a ready page offers the way back to unset.sh, through the
  door's fixed /welcome/done, instead of the conversations.
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
/** The key whose last characters are being asked (the second card); any other key, or none, shows the first. */
let checkingKey: string | null = $state(null);
// `view as ChatState`: read at the top level, TypeScript would narrow it to its first value.
const checking = $derived.by(() => {
  const now = view as ChatState;
  return now.kind === "save_key" && checkingKey === now.key;
});
/** Opened from signup's chat step: the door serves the page there and takes the tab back from WELCOME_DONE. */
const WELCOME_PATH = "/welcome";
const WELCOME_DONE = "/welcome/done";
const welcoming = $derived((view as ChatState).kind === "ready" && window.location.pathname === WELCOME_PATH);

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
  signing_out: {
    title: "Signing you out",
    text: "Saving your keys so you can read your messages in another browser, then removing them from this one. This can take a few seconds.",
  },
  signed_out: { title: "Signing you in again", text: "One moment." },
  open_elsewhere: {
    title: "Your messages are open in another tab",
    text: "Your messages open in one tab at a time. Go back to that tab, or use them here instead, which closes them there.",
  },
  error: { title: "Messages could not open", text: "Try again in a moment." },
} as const;
const CHECK_WORDS = {
  title: "Check your recovery key",
  text: `To check you have saved it, type the last ${CHECK_LENGTH} characters of your recovery key.`,
} as const;
const WELCOME_WORDS = {
  title: "Your messages are set up",
  text: "Your recovery key is saved. Go back to unset.sh to finish signing up.",
} as const;
const words = $derived(checking ? CHECK_WORDS : welcoming ? WELCOME_WORDS : WORDS[view.kind]);

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

/** The first card's submit: the key is saved, so the second card asks for its end. */
function saved(event: SubmitEvent) {
  event.preventDefault();
  if (view.kind !== "save_key") return;
  ending = "";
  endWrong = false;
  checkingKey = view.key;
}

function checkEnd(event: SubmitEvent) {
  event.preventDefault();
  if (view.kind !== "save_key") return;
  endWrong = !matchesEnd(ending, view.key);
  if (endWrong) return;
  ending = "";
  checkingKey = null;
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
      {#if view.kind !== "ready" || welcoming}<Card.Description>{words.text}</Card.Description>{/if}
    </Card.Header>
    {#if view.kind === "save_key" && !checking}
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={saved}>
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
          <Button type="submit">I have saved my key</Button>
        </form>
      </Card.Content>
    {:else if view.kind === "save_key"}
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={checkEnd}>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="key-end">Last {CHECK_LENGTH} characters of your key</label>
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
          <Button type="button" variant="outline" onclick={() => (checkingKey = null)}>Show my key again</Button>
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
    {:else if welcoming}
      <Card.Content>
        <Button href={WELCOME_DONE}>Continue</Button>
      </Card.Content>
    {:else if view.kind === "ready"}
      <Card.Content>
        <Conversations conversations={view.conversations} names={view.names} me={view.me} />
      </Card.Content>
    {:else if view.kind === "open_elsewhere"}
      <Card.Content>
        <Button onclick={() => view.kind === "open_elsewhere" && view.useHere()}>Use here</Button>
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
