<!--
  The owner's avatar as a button (the profile-card mockup, Alex 2026-11-17): hovering or focusing it shows "Shape"
  over it, on touch a small pen sits on its corner, and pressing it opens the stock Dialog with the shape choice
  (sh.unset.profile avatarShape: round or rounded square), posted to the page's `avatar` action. There is no upload:
  showing a picture needs the media proxy (CLAUDE.md, Blobs), so the link and dialog are named for the shape and say
  uploads come later (staging walkthrough 2026-11-18 round two, finding 4); no-underline keeps the letter clean (finding 3). As with the card
  editors, a refused save keeps the dialog open with the reason inside, and with no script the avatar is a link to the
  page with the choice in place (`?avatar`, drawn by card-panel.svelte with `panel`). In the compact header (ADR 0072)
  the avatar opens the profile's details instead, so `look="button"` makes the trigger a small "Shape" button of its
  own beside the name, with the same dialog and no-script link.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { AVATAR_EDIT } from "../../profile/messages.ts";
import { opensHere, PANEL_ANCHOR } from "../../profile/panel.ts";
import type { AvatarShape, CardPanelState, Enhance, SubmitHandler } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import Choice from "./choice.svelte";

let {
  shape,
  enhance = () => undefined,
  class: className = "",
  children,
  panel,
  look = "avatar",
}: {
  shape: AvatarShape;
  enhance?: Enhance;
  class?: string;
  /** The avatar the trigger shows; absent with `panel`. */
  children?: Snippet;
  /** Draw the choice in place instead (the page opened with `?avatar`). */
  panel?: CardPanelState;
  /** The avatar itself is the trigger, or a pen button beside the name (the compact header). */
  look?: "avatar" | "button";
} = $props();

let open = $state(false);
let pending = $state(false);
let refused: string | undefined = $state(initialRefusal());
function initialRefusal() {
  return panel?.refusal?.message;
}
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
  if (!open && panel === undefined) refused = undefined;
});
const rounded = $derived(shape === "round" ? "rounded-full" : "rounded-[12%]");
</script>

{#snippet refusal()}
  {#if refused !== undefined}
    <Alert.Root variant="destructive"><Alert.Description>{refused}</Alert.Description></Alert.Root>
  {/if}
{/snippet}

{#snippet choice()}
  <form id={formId} method="POST" action="?/avatar{panel === undefined ? '' : `&${panel.stay}#${panel.anchor}`}" use:enhance={save}>
    <Choice label={AVATAR_EDIT.shape} name="avatarShape" value={shape} options={SHAPES} />
  </form>
{/snippet}

{#if panel !== undefined}
  <Card.Root id={panel.anchor} class="gap-4 rounded-sm">
    <Card.Header>
      <Card.Title><h2 class="text-xl font-semibold">{AVATAR_EDIT.title}</h2></Card.Title>
      <Card.Description>{AVATAR_EDIT.description}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">{@render refusal()}{@render choice()}</Card.Content>
    <Card.Footer class="flex justify-end gap-2">
      <Button href={panel.cancel} variant="outline">{AVATAR_EDIT.cancel}</Button>
      <Button type="submit" form={formId} disabled={pending}>{AVATAR_EDIT.save}</Button>
    </Card.Footer>
  </Card.Root>
{:else}
  <Dialog.Root bind:open>
    {#if look === "button"}
      <a
        href="?avatar#{PANEL_ANCHOR}"
        aria-haspopup="dialog"
        data-slot="button"
        aria-label={AVATAR_EDIT.trigger}
        class="{buttonVariants({ variant: 'ghost', size: 'sm' })} shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 {className}"
        onclick={(event) => {
          if (opensHere(event)) open = true;
        }}
      >
        <Icon name="profile" size={16} />{AVATAR_EDIT.change}
      </a>
    {:else}
    <a
      href="?avatar#{PANEL_ANCHOR}"
      aria-haspopup="dialog"
      class="group/avatar relative block {rounded} no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 {className}"
      onclick={(event) => {
        if (opensHere(event)) open = true;
      }}
    >
      {@render children?.()}
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
    </a>
    {/if}
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{AVATAR_EDIT.title}</Dialog.Title>
        <Dialog.Description>{AVATAR_EDIT.description}</Dialog.Description>
      </Dialog.Header>
      {@render refusal()}
      {@render choice()}
      <Dialog.Footer>
        <Dialog.Close class={buttonVariants({ variant: "outline" })}>{AVATAR_EDIT.cancel}</Dialog.Close>
        <Button type="submit" form={formId} disabled={pending}>{AVATAR_EDIT.save}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
