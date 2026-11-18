<!--
  The owner's avatar as a button (the profile-card mockup, Alex 2026-11-17): hovering or focusing it shows "Change"
  over it, on touch a small pen sits on its corner, and pressing it opens the stock Dialog with the shape choice
  (sh.unset.profile avatarShape: round or rounded square), posted to the page's `avatar` action. There is no upload:
  showing a picture needs the media proxy (CLAUDE.md, Blobs), so the dialog says it comes later. As with the card
  editors, a refused save keeps the dialog open with the reason inside; the dialog needs script.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { AVATAR_EDIT } from "../../profile/messages.ts";
import type { AvatarShape, Enhance, SubmitHandler } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import Choice from "./choice.svelte";

let {
  shape,
  enhance = () => undefined,
  class: className = "",
  children,
}: { shape: AvatarShape; enhance?: Enhance; class?: string; children: Snippet } = $props();

let open = $state(false);
let pending = $state(false);
let refused: string | undefined = $state();
const formId = $props.id();
const SHAPES = [
  { value: "round", label: AVATAR_EDIT.round },
  { value: "roundedSquare", label: AVATAR_EDIT.roundedSquare },
];

// As card-editor.svelte's saveCard: one save at a time; a refusal shows the action's catalog message in the dialog.
const save: SubmitHandler = ({ cancel }) => {
  if (pending) {
    cancel();
    return async () => undefined;
  }
  pending = true;
  refused = undefined;
  return async ({ result, update }) => {
    pending = false;
    if (result.type === "failure") {
      const message = result.data?.message;
      refused = typeof message === "string" ? message : AVATAR_EDIT.refused;
      return;
    }
    await update();
    if (result.type === "success" || result.type === "redirect") open = false;
  };
};

$effect(() => {
  if (!open) refused = undefined;
});
const rounded = $derived(shape === "round" ? "rounded-full" : "rounded-[12%]");
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger
    class="group/avatar relative block {rounded} outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 {className}"
  >
    {@render children()}
    <span
      aria-hidden="true"
      class="absolute inset-0 flex items-center justify-center gap-1.5 {rounded} bg-background/70 font-mono text-xs tracking-wider text-foreground uppercase opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 motion-reduce:transition-none pointer-coarse:hidden"
    >
      <Icon name="edit" size={16} />{AVATAR_EDIT.change}
    </span>
    <span
      aria-hidden="true"
      class="absolute right-0 bottom-0 hidden size-8 items-center justify-center rounded-full bg-primary text-primary-foreground pointer-coarse:flex"
    >
      <Icon name="edit" size={16} />
    </span>
    <span class="sr-only">{AVATAR_EDIT.trigger}</span>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{AVATAR_EDIT.title}</Dialog.Title>
      <Dialog.Description>{AVATAR_EDIT.description}</Dialog.Description>
    </Dialog.Header>
    {#if refused !== undefined}
      <Alert.Root variant="destructive"><Alert.Description>{refused}</Alert.Description></Alert.Root>
    {/if}
    <form id={formId} method="POST" action="?/avatar" use:enhance={save}>
      <Choice label={AVATAR_EDIT.shape} name="avatarShape" value={shape} options={SHAPES} />
    </form>
    <Dialog.Footer>
      <Dialog.Close class={buttonVariants({ variant: "outline" })}>{AVATAR_EDIT.cancel}</Dialog.Close>
      <Button type="submit" form={formId} disabled={pending}>{AVATAR_EDIT.save}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
