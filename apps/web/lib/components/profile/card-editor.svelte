<!--
  A card's editor (ADR 0051; from apps/web/src/screens/profile/CardFormDialog.tsx and the four editors, P1.20i): the
  stock Dialog holding one form that posts the card's kind, its width and its fields to this page's `create` or `save`
  action. List cards add rows of indexed fields (`items.2.uri`), read back into a list on the server; every stored row
  is shown, then blank rows while the editor's limit allows, so a save never drops one and clearing a row removes it.
-->
<script lang="ts">
import { BUTTONS_EDIT, CARD_EDIT, CARD_TEXT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import type { CardContent, CardWidth, Enhance, SubmitHandler } from "../../profile/types.ts";
import { Icon, type IconName } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import Choice from "./choice.svelte";
import Field from "./field.svelte";

type Kind = CardContent["kind"];
let {
  kind,
  content = null,
  width,
  cardKey,
  trigger,
  icon,
  triggerClass = "",
  open = $bindable(false),
  returnFocus,
  title,
  submit,
  max,
  enhance = () => undefined,
}: {
  kind: Kind;
  /** The stored card, or null to add one. */
  content?: CardContent | null;
  width: CardWidth;
  /** The card being saved; absent, the form adds a card. */
  cardKey?: string;
  trigger: string | null;
  /** Draw the trigger as this icon alone, `trigger` its hidden name (the card's own controls). */
  icon?: IconName;
  triggerClass?: string;
  /** Whether the editor is open. A caller that opens it itself (the add picker) binds this and passes no trigger:
   * `trigger` is then null. */
  open?: boolean;
  /** Where focus goes when the editor closes, for an editor with no trigger of its own to return to. */
  returnFocus?: () => HTMLElement | null;
  title: string;
  submit: string;
  /** Rows a list editor writes (domains/profile CARD_EDIT_LIMITS). */
  max: number;
  enhance?: Enhance;
} = $props();

/** A save is on its way: the submit button is disabled and a second press is cancelled. */
let pending = $state(false);
/** The catalog's words for a refused save, shown inside the editor. */
let refused: string | undefined = $state();

// With script (outside review of f5cab2f, finding 1): a save closes the editor once the page has the new card, and
// focus goes back to the button that opened it (bits-ui's default on close). A refused save keeps the editor open
// with what was typed and shows the action's catalog message in an alert inside it, not on the page behind the modal.
// A press while a save is on its way is cancelled. The action's answer for a refusal is `fail(status, { code,
// message })` with message from ERROR_MESSAGES (routes/[did=did]/+page.server.ts), so no request text reaches it.
const saveCard: SubmitHandler = ({ cancel }) => {
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
      refused = typeof message === "string" ? message : CARD_EDIT.refused;
      return;
    }
    await update();
    if (result.type === "success" || result.type === "redirect") open = false;
  };
};

$effect(() => {
  if (!open) refused = undefined;
});

/** Blank rows a list editor offers to add more. */
const BLANK_ROWS = 10;
const blanks = (stored: number) => Math.max(0, Math.min(BLANK_ROWS, max - stored));
const formId = $props.id();
const WIDTHS = [
  { value: "full", label: CARD_EDIT.full },
  { value: "half", label: CARD_EDIT.half },
];
const LAYOUTS = [
  { value: "list", label: LINKS_EDIT.list },
  { value: "grid", label: LINKS_EDIT.grid },
  { value: "carousel", label: LINKS_EDIT.carousel },
];
const PRESETS = (["bookCall", "hire", "subscribe", "custom"] as const).map((p) => ({ value: p, label: CARD_TEXT[p] }));
const KINDS = [
  { value: "email", label: BUTTONS_EDIT.email },
  { value: "link", label: BUTTONS_EDIT.link },
];

const readme = $derived(content?.kind === "readme" ? content : null);
const links = $derived(content?.kind === "links" ? content : null);
const collection = $derived(content?.kind === "collection" ? content : null);
const buttons = $derived(content?.kind === "buttons" ? content : null);
const linkRows = $derived([
  ...(links?.items ?? []),
  ...Array(blanks(links?.items.length ?? 0)).fill({ uri: "", label: "", description: "" }),
]);
const entryRows = $derived([
  ...(collection?.items ?? []),
  ...Array(blanks(collection?.items.length ?? 0)).fill({ title: "", tag: "", description: "", uri: "" }),
]);
/**
 * On open, focus the card's first text field (the README's text area, a list's title), not the width radios above
 * it; bits-ui 2.20.6 focuses the first tabbable element unless onOpenAutoFocus prevents it
 * (dist/bits/utilities/focus-scope/types.d.ts).
 */
function focusFirstText(event: Event) {
  const form = document.getElementById(formId);
  // The stock Input and Textarea mark themselves with data-slot; the radio groups' hidden inputs carry none.
  const field = form?.querySelector<HTMLElement>('[data-slot="input"], [data-slot="textarea"]');
  if (field == null) return;
  event.preventDefault();
  field.focus();
}
const hintId = `${formId}-hint`;
/** On close, focus goes to `returnFocus` when given (bits-ui 2.20.6 focus-scope onCloseAutoFocus), else to the trigger. */
function focusBack(event: Event) {
  const target = returnFocus?.();
  if (target == null) return;
  event.preventDefault();
  target.focus();
}
const buttonRows = $derived([
  ...(buttons?.buttons ?? []),
  ...Array(blanks(buttons?.buttons.length ?? 0)).fill({ kind: "link", preset: "custom", uri: "", label: "" }),
]);
</script>

<Dialog.Root bind:open>
  {#if trigger === null}
    <!-- Opened by the caller. -->
  {:else if icon === undefined}
    <Dialog.Trigger class="{buttonVariants({ variant: 'outline' })} {triggerClass}">{trigger}</Dialog.Trigger>
  {:else}
    <Dialog.Trigger class="{buttonVariants({ variant: 'ghost', size: 'icon-sm' })} {triggerClass}"
      ><Icon name={icon} size={20} label={trigger} /></Dialog.Trigger
    >
  {/if}
  <Dialog.Content class="max-h-[90vh] overflow-y-auto" onOpenAutoFocus={focusFirstText} onCloseAutoFocus={focusBack}>
    <Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header>
    {#if refused !== undefined}
      <Alert.Root variant="destructive"><Alert.Description>{refused}</Alert.Description></Alert.Root>
    {/if}
    <form id={formId} method="POST" action={cardKey === undefined ? "?/create" : "?/save"} class="grid gap-4" use:enhance={saveCard}>
      {#if cardKey !== undefined}<input type="hidden" name="key" value={cardKey} />{/if}
      <input type="hidden" name="kind" value={kind} />
      <Choice label={CARD_EDIT.width} name="width" value={width} options={WIDTHS} />
      {#if kind === "readme"}
        <Field label={CARD_EDIT.readme} hint={CARD_EDIT.readmeHint} name="text" value={readme?.text ?? ""} rows={12} required />
      {:else if kind === "links"}
        <Field label={LINKS_EDIT.title} name="title" value={links?.title ?? ""} />
        <Choice label={LINKS_EDIT.layout} name="layout" value={links?.layout ?? "list"} options={LAYOUTS} />
        <p id={hintId}>{LINKS_EDIT.hint(max)}</p>
        {#each linkRows as link, i (i)}
          <fieldset class="grid gap-2" aria-describedby={hintId}>
            <legend class="font-medium">{LINKS_EDIT.row(i + 1)}</legend>
            <Field label={LINKS_EDIT.uri} name="items.{i}.uri" value={link.uri} inputmode="url" autocomplete="url" />
            <Field label={LINKS_EDIT.label} name="items.{i}.label" value={link.label} />
            <Field label={LINKS_EDIT.description} name="items.{i}.description" value={link.description} />
          </fieldset>
        {/each}
      {:else if kind === "collection"}
        <Field label={COLLECTION_EDIT.title} name="title" value={collection?.title ?? ""} />
        <Choice label={LINKS_EDIT.layout} name="layout" value={collection?.layout ?? "carousel"} options={LAYOUTS} />
        <p id={hintId}>{COLLECTION_EDIT.hint(max)}</p>
        {#each entryRows as entry, i (i)}
          <fieldset class="grid gap-2" aria-describedby={hintId}>
            <legend class="font-medium">{COLLECTION_EDIT.row(i + 1)}</legend>
            <Field label={COLLECTION_EDIT.entryTitle} name="items.{i}.title" value={entry.title} />
            <Field label={COLLECTION_EDIT.tag} name="items.{i}.tag" value={entry.tag} />
            <Field label={COLLECTION_EDIT.description} name="items.{i}.description" value={entry.description} />
            <Field label={COLLECTION_EDIT.uri} name="items.{i}.uri" value={entry.uri} inputmode="url" autocomplete="url" />
          </fieldset>
        {/each}
      {:else}
        <Field label={BUTTONS_EDIT.heading} name="heading" value={buttons?.heading ?? ""} required />
        <Field label={BUTTONS_EDIT.text} name="text" value={buttons?.text ?? ""} rows={3} />
        <p id={hintId}>{BUTTONS_EDIT.hint(max)}</p>
        {#each buttonRows as button, i (i)}
          <fieldset class="grid gap-2" aria-describedby={hintId}>
            <legend class="font-medium">{BUTTONS_EDIT.row(i + 1)}</legend>
            <Choice label={BUTTONS_EDIT.kind} name="buttons.{i}.kind" value={button.kind} options={KINDS} />
            <Field
              label={BUTTONS_EDIT.address}
              name="buttons.{i}.address"
              value={button.kind === "email" ? button.address : ""}
              type="email"
              autocomplete="email"
            />
            <Choice
              label={BUTTONS_EDIT.preset}
              name="buttons.{i}.preset"
              value={button.kind === "link" ? button.preset : "custom"}
              options={PRESETS}
            />
            <Field
              label={BUTTONS_EDIT.uri}
              name="buttons.{i}.uri"
              value={button.kind === "link" ? button.uri : ""}
              inputmode="url"
              autocomplete="url"
            />
            <Field label={BUTTONS_EDIT.label} name="buttons.{i}.label" value={button.kind === "link" ? button.label : ""} />
          </fieldset>
        {/each}
      {/if}
    </form>
    <Dialog.Footer>
      <Dialog.Close class={buttonVariants({ variant: "outline" })}>{CARD_EDIT.cancel}</Dialog.Close>
      <Button type="submit" form={formId} disabled={pending}>{submit}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
