<!--
  A card's editor (ADR 0051; from apps/web/src/screens/profile/CardFormDialog.tsx and the four editors, P1.20i): the
  stock Dialog holding one form that posts the card's kind, its width and its fields to this page's `create` or `save`
  action. List cards add rows of indexed fields (`items.2.uri`), read back into a list on the server; every stored row
  is shown, then blank rows while the editor's limit allows, so a save never drops one and clearing a row removes it.
  With script a list starts with one blank row (none when it already has rows) and an Add row button adds the next,
  up to the limit (Alex 2026-11-18); with none it offers ten. A buttons row shows only the fields of the kind it
  opens, by CSS on its checked radio, so this holds with no script too. The README editor gets Write and Preview tabs
  with script; the preview is the same parser and renderer the page uses, so what it shows is what the card will show.
  Its Write tab is the rich editor over the plain field (text-editor.svelte, P1.21u), in a wider dialog.
  With no script (staging walkthrough 2026-11-18, finding 8) the trigger is a link to the page with the editor open
  in place (`?edit=<key>`, read by the page's load), drawn here as a panel: the same form, a Cancel link back, and an
  action that keeps the query, so a refused save shows the page again with the panel, what was typed and the reason.
-->
<script lang="ts">
import { tick } from "svelte";
import { BUTTONS_EDIT, CARD_EDIT, CARD_TEXT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import { opensHere } from "../../profile/panel.ts";
import { parseReadme } from "../../profile/parse.ts";
import type {
  CardContent,
  CardPanelState,
  CardSurface,
  CardWidth,
  Enhance,
  SubmitHandler,
} from "../../profile/types.ts";
import { Icon, type IconName } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import * as Tabs from "../ui/tabs/index.ts";
import Choice from "./choice.svelte";
import Field from "./field.svelte";
import Readme from "./readme.svelte";
import TextEditor from "./text-editor.svelte";

type Kind = CardContent["kind"];
let {
  kind,
  content = null,
  width,
  surface = "filled",
  cardKey,
  newKey,
  trigger,
  icon,
  triggerClass = "",
  open = $bindable(false),
  returnFocus,
  panel,
  title,
  submit,
  max,
  textMax,
  enhance = () => undefined,
}: {
  kind: Kind;
  /** The stored card, or null to add one. */
  content?: CardContent | null;
  width: CardWidth;
  surface?: CardSurface;
  /** The card being saved; absent, the form adds a card. */
  cardKey?: string;
  /** The key a card this form adds takes (the page's newCardKey), so the form sent twice adds it once. */
  newKey?: string;
  /** The link that opens the editor: with script it opens the dialog, without it goes to `href`. */
  trigger: { readonly label: string; readonly href: string } | null;
  /** Draw the trigger as this icon alone, its label the hidden name (the card's own controls). */
  icon?: IconName;
  triggerClass?: string;
  /** Whether the editor is open. A caller that opens it itself (the add picker) binds this and passes no trigger:
   * `trigger` is then null. */
  open?: boolean;
  /** Where focus goes when the editor closes, for an editor with no trigger of its own to return to. */
  returnFocus?: () => HTMLElement | null;
  /** Draw the editor in place as a panel instead of a dialog (the page opened with it). */
  panel?: CardPanelState;
  title: string;
  submit: string;
  /** Rows a list editor writes (domains/profile CARD_EDIT_LIMITS). */
  max: number;
  /** The README's maxlength (CardEditLimits text). */
  textMax?: number;
  enhance?: Enhance;
} = $props();

/** A save is on its way: the submit button is disabled and a second press is cancelled. */
let pending = $state(false);
/**
 * A refused save, shown inside the editor: beside the field it blames when the answer names one the form holds, in
 * words for that field, else as the catalog's words above the form.
 */
type Refused = { readonly message: string; readonly field?: string; readonly fieldText?: string };
let refused: Refused | undefined = $state(fromPanel());
let summary: HTMLElement | undefined = $state();
let triggerLink: HTMLAnchorElement | undefined = $state();
/** The error to show beside the field named `name`, if the refusal blames it. */
const errorFor = (name: string) => (refused?.field === name ? refused.fieldText : undefined);
/** The value a field shows: what was typed, when a refused save showed the page again, else the stored one. */
const typedOr = (name: string, stored: string) => panel?.values?.[name] ?? stored;
/** The words for a refusal shown beside its field: its code's own, else the catalog's. */
function fieldText(code: unknown, message: string): string {
  return (typeof code === "string" ? CARD_EDIT.fieldError[code] : undefined) ?? message;
}

/** A refusal the page was shown again with (no script), as the panel starts. */
function fromPanel(): Refused | undefined {
  const failed = panel?.refusal;
  if (failed === undefined) return undefined;
  const { code, message, field } = failed;
  return field === undefined ? { message } : { message, field, fieldText: fieldText(code, message) };
}

// With script (outside review of f5cab2f, finding 1): a save closes the editor once the page has the new card, and
// focus goes back to the button that opened it (bits-ui's default on close). A refused save keeps the editor open
// with what was typed and shows the refusal inside it, not on the page behind the modal; focus goes to the field it
// blames, or to the message when it blames none, scrolled into view, so a long editor never hides it (staging
// walkthrough 2026-11-18, finding 4). A press while a save is on its way is cancelled. The action's answer for a
// refusal is `fail(status, { code, message, field? })` with message from ERROR_MESSAGES and field a form field name
// the server read (routes/[did=did]/+page.server.ts), so no request text reaches it.
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
      await showRefusal(result.data);
      return;
    }
    // A save the action never ran for and the gate could not answer as a failure (SvelteKit's own CSRF refusal, a
    // dropped connection) keeps the editor too, rather than swapping the page for the error page.
    if (result.type === "error") {
      refused = { message: CARD_EDIT.refused };
      return;
    }
    await update();
    if (result.type === "success" || result.type === "redirect") open = false;
  };
};

async function showRefusal(data: Record<string, unknown> | undefined) {
  const message = typeof data?.message === "string" ? data.message : CARD_EDIT.refused;
  const field = typeof data?.field === "string" ? data.field : undefined;
  const code = data?.code;
  const form = document.getElementById(formId);
  const target = field === undefined || !(form instanceof HTMLFormElement) ? null : form.elements.namedItem(field);
  const text = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  refused = text === null ? { message } : { message, field, fieldText: fieldText(code, message) };
  // A refusal that blames the README text shows it on the Write tab, where the field can take focus.
  if (text !== null) tab = "write";
  await tick();
  const shown = text ?? summary;
  shown?.focus();
  shown?.scrollIntoView({ block: "center" });
}

$effect(() => {
  if (!open && panel === undefined) refused = undefined;
});
$effect(() => {
  if (open) tab = "write";
});

/** Blank rows a list editor offers with no script, where it cannot add one on request. */
const BLANK_ROWS = 10;
/** Whether the page runs script: false while the server renders and until the first effect runs in the browser. */
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});
/** Rows added with Add row since the editor opened. */
let added = $state(0);
$effect(() => {
  if (open) added = 0;
});
/** Blank rows after the stored ones: one to start an empty list, then one per Add row, while the limit allows. */
const blanks = (stored: number) =>
  Math.max(0, Math.min(hydrated ? (stored === 0 ? 1 : 0) + added : BLANK_ROWS, max - stored));
/** Add a blank row and put focus in its first field. */
async function addRow() {
  added += 1;
  await tick();
  const rows = document.getElementById(formId)?.querySelectorAll<HTMLElement>("[data-row]");
  rows?.[rows.length - 1]?.querySelector<HTMLElement>("input")?.focus();
}
/** The README editor's open tab, and the text its preview shows, read from the field when Preview opens. */
let tab = $state("write");
let previewText = $state("");
function showTab(value: string) {
  if (value === "preview") {
    const field = document.getElementById(formId)?.querySelector<HTMLTextAreaElement>('textarea[name="text"]');
    previewText = field?.value ?? "";
  }
  tab = value;
}
const previewBlocks = $derived(tab === "preview" ? parseReadme(previewText) : []);
const formId = $props.id();
/** The Text editor's dialog (P1.21u): wide on a desktop, the whole screen on a phone, by the stock Dialog's own classes. */
const TEXT_DIALOG = "sm:max-w-3xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none max-sm:border-0";
// The width and layout choices are icons with their words (Alex 2026-11-18 12:24Z; the profile-card mockup).
const WIDTHS = [
  { value: "full", label: CARD_EDIT.full, icon: "full" },
  { value: "half", label: CARD_EDIT.half, icon: "half" },
] as const;
const SURFACES = [
  { value: "filled", label: CARD_EDIT.filled },
  { value: "outlined", label: CARD_EDIT.outlined },
  { value: "plain", label: CARD_EDIT.plain },
] as const;
const LAYOUTS = [
  { value: "list", label: LINKS_EDIT.list, icon: "list" },
  { value: "grid", label: LINKS_EDIT.grid, icon: "apps" },
  { value: "carousel", label: LINKS_EDIT.carousel, icon: "carousel" },
] as const;
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
  // The stock Input and Textarea mark themselves with data-slot; the radios carry none.
  const field = form?.querySelector<HTMLElement>('[data-slot="input"], [data-slot="textarea"]');
  if (field == null) return;
  event.preventDefault();
  field.focus();
}
const hintId = `${formId}-hint`;
/** The action, keeping the panel's query so a refused save with no script shows the panel again. */
const action = $derived(
  `${cardKey === undefined ? "?/create" : "?/save"}${panel === undefined ? "" : `&${panel.stay}#${panel.anchor}`}`,
);
/** On close, focus goes to `returnFocus` when given (bits-ui 2.20.6 focus-scope onCloseAutoFocus), else to the trigger link. */
function focusBack(event: Event) {
  const target = returnFocus?.() ?? triggerLink;
  if (target == null) return;
  event.preventDefault();
  target.focus();
}
const buttonRows = $derived([
  ...(buttons?.buttons ?? []),
  ...Array(blanks(buttons?.buttons.length ?? 0)).fill({ kind: "link", preset: "custom", uri: "", label: "" }),
]);
</script>

{#snippet refusal()}
  {#if refused !== undefined && (refused.field === undefined || panel !== undefined)}
    <div bind:this={summary} tabindex="-1" class="outline-none">
      <Alert.Root variant="destructive"><Alert.Description>{refused.message}</Alert.Description></Alert.Root>
    </div>
  {/if}
{/snippet}

{#snippet addRowButton(rows: number, label: string)}
  {#if hydrated && rows < max}
    <Button type="button" variant="outline" class="justify-self-start" onclick={addRow}><Icon name="add" size={16} />{label}</Button>
  {/if}
{/snippet}

{#snippet fields()}
  <form id={formId} method="POST" {action} class="grid gap-4" use:enhance={saveCard} oninvalidcapture={() => showTab("write")}>
    {#if cardKey !== undefined}<input type="hidden" name="key" value={cardKey} />{:else if newKey !== undefined}<input type="hidden" name="newKey" value={newKey} />{/if}
    <input type="hidden" name="kind" value={kind} />
    <Choice label={CARD_EDIT.width} name="width" value={typedOr("width", width)} options={WIDTHS} />
    <Choice label={CARD_EDIT.surface} name="surface" value={typedOr("surface", surface)} options={SURFACES} />
    {#if kind === "readme" && hydrated}
      <Tabs.Root value={tab} onValueChange={showTab}>
        <Tabs.List>
          <Tabs.Trigger value="write">{CARD_EDIT.write}</Tabs.Trigger>
          <Tabs.Trigger value="preview">{CARD_EDIT.preview}</Tabs.Trigger>
        </Tabs.List>
        <!-- An inactive tab's panel stays in the page, hidden (bits-ui 2.20.6 tabs-content.svelte), so the text still posts. -->
        <Tabs.Content value="write">
          <TextEditor label={CARD_EDIT.readme} hint={CARD_EDIT.readmeHint} name="text" error={errorFor("text")} value={typedOr("text", readme?.text ?? "")} rows={12} maxlength={textMax} required />
        </Tabs.Content>
        <Tabs.Content value="preview" class="min-h-40 rounded-sm border px-4 py-3">
          {#if previewBlocks.length === 0}<p class="text-muted-foreground">{CARD_EDIT.previewEmpty}</p>{:else}<Readme blocks={previewBlocks} />{/if}
        </Tabs.Content>
      </Tabs.Root>
    {:else if kind === "readme"}
      <Field label={CARD_EDIT.readme} hint={CARD_EDIT.readmeHint} name="text" error={errorFor("text")} value={typedOr("text", readme?.text ?? "")} rows={12} maxlength={textMax} required />
    {:else if kind === "links"}
      <Field label={LINKS_EDIT.title} name="title" error={errorFor("title")} value={typedOr("title", links?.title ?? "")} />
      <Choice label={LINKS_EDIT.layout} name="layout" value={typedOr("layout", links?.layout ?? "list")} options={LAYOUTS} />
      <p id={hintId}>{LINKS_EDIT.hint(max)}</p>
      {#each linkRows as link, i (i)}
        <fieldset data-row class="grid gap-2" aria-describedby={hintId}>
          <legend class="font-medium">{LINKS_EDIT.row(i + 1)}</legend>
          <Field label={LINKS_EDIT.uri} name="items.{i}.uri" error={errorFor(`items.${i}.uri`)} value={typedOr(`items.${i}.uri`, link.uri)} inputmode="url" autocomplete="url" />
          <Field label={LINKS_EDIT.label} name="items.{i}.label" error={errorFor(`items.${i}.label`)} value={typedOr(`items.${i}.label`, link.label)} />
          <Field label={LINKS_EDIT.description} name="items.{i}.description" error={errorFor(`items.${i}.description`)} value={typedOr(`items.${i}.description`, link.description)} />
        </fieldset>
      {/each}
      {@render addRowButton(linkRows.length, LINKS_EDIT.addRow)}
    {:else if kind === "collection"}
      <Field label={COLLECTION_EDIT.title} name="title" error={errorFor("title")} value={typedOr("title", collection?.title ?? "")} />
      <Choice label={LINKS_EDIT.layout} name="layout" value={typedOr("layout", collection?.layout ?? "carousel")} options={LAYOUTS} />
      <p id={hintId}>{COLLECTION_EDIT.hint(max)}</p>
      {#each entryRows as entry, i (i)}
        <fieldset data-row class="grid gap-2" aria-describedby={hintId}>
          <legend class="font-medium">{COLLECTION_EDIT.row(i + 1)}</legend>
          <Field label={COLLECTION_EDIT.entryTitle} name="items.{i}.title" error={errorFor(`items.${i}.title`)} value={typedOr(`items.${i}.title`, entry.title)} />
          <Field label={COLLECTION_EDIT.tag} name="items.{i}.tag" error={errorFor(`items.${i}.tag`)} value={typedOr(`items.${i}.tag`, entry.tag)} />
          <Field label={COLLECTION_EDIT.description} name="items.{i}.description" error={errorFor(`items.${i}.description`)} value={typedOr(`items.${i}.description`, entry.description)} />
          <Field label={COLLECTION_EDIT.uri} name="items.{i}.uri" error={errorFor(`items.${i}.uri`)} value={typedOr(`items.${i}.uri`, entry.uri)} inputmode="url" autocomplete="url" />
        </fieldset>
      {/each}
      {@render addRowButton(entryRows.length, COLLECTION_EDIT.addRow)}
    {:else}
      <Field label={BUTTONS_EDIT.heading} name="heading" error={errorFor("heading")} value={typedOr("heading", buttons?.heading ?? "")} required />
      <Field label={BUTTONS_EDIT.text} name="text" error={errorFor("text")} value={typedOr("text", buttons?.text ?? "")} rows={3} />
      <p id={hintId}>{BUTTONS_EDIT.hint(max)}</p>
      {#each buttonRows as button, i (i)}
        <fieldset data-row class="group/row grid gap-2" aria-describedby={hintId}>
          <legend class="font-medium">{BUTTONS_EDIT.row(i + 1)}</legend>
          <Choice label={BUTTONS_EDIT.kind} name="buttons.{i}.kind" value={typedOr(`buttons.${i}.kind`, button.kind)} options={KINDS} />
          <div class="grid gap-2 group-has-[[value=link]:checked]/row:hidden">
          <Field
            label={BUTTONS_EDIT.address}
            name="buttons.{i}.address" error={errorFor(`buttons.${i}.address`)}
            value={typedOr(`buttons.${i}.address`, button.kind === "email" ? button.address : "")}
            inputmode="email"
            autocomplete="email"
          />
          </div>
          <div class="grid gap-2 group-has-[[value=email]:checked]/row:hidden">
          <Choice
            label={BUTTONS_EDIT.preset}
            name="buttons.{i}.preset"
            value={typedOr(`buttons.${i}.preset`, button.kind === "link" ? button.preset : "custom")}
            options={PRESETS}
          />
          <Field
            label={BUTTONS_EDIT.uri}
            name="buttons.{i}.uri" error={errorFor(`buttons.${i}.uri`)}
            value={typedOr(`buttons.${i}.uri`, button.kind === "link" ? button.uri : "")}
            inputmode="url"
            autocomplete="url"
          />
          <Field label={BUTTONS_EDIT.label} name="buttons.{i}.label" error={errorFor(`buttons.${i}.label`)} value={typedOr(`buttons.${i}.label`, button.kind === "link" ? button.label : "")} />
          </div>
        </fieldset>
      {/each}
      {@render addRowButton(buttonRows.length, BUTTONS_EDIT.addRow)}
    {/if}
  </form>
{/snippet}

{#if panel !== undefined}
  <Card.Root id={panel.anchor} class="gap-4 rounded-sm">
    <Card.Header><Card.Title><h2 class="text-xl font-semibold">{title}</h2></Card.Title></Card.Header>
    <Card.Content class="grid gap-4">{@render refusal()}{@render fields()}</Card.Content>
    <Card.Footer class="flex justify-end gap-2">
      <Button href={panel.cancel} variant="outline">{CARD_EDIT.cancel}</Button>
      <Button type="submit" form={formId} disabled={pending}>{submit}</Button>
    </Card.Footer>
  </Card.Root>
{:else}
  <Dialog.Root bind:open>
    {#if trigger !== null}
      <a
        bind:this={triggerLink}
        href={trigger.href}
        aria-haspopup="dialog"
        class="{icon === undefined ? buttonVariants({ variant: 'outline' }) : buttonVariants({ variant: 'ghost', size: 'icon-sm' })} {triggerClass}"
        onclick={(event) => {
          if (opensHere(event)) open = true;
        }}
        >{#if icon === undefined}{trigger.label}{:else}<Icon name={icon} size={20} label={trigger.label} />{/if}</a
      >
    {/if}
    <Dialog.Content class="max-h-[90vh] overflow-y-auto {kind === 'readme' ? TEXT_DIALOG : ''}" onOpenAutoFocus={focusFirstText} onCloseAutoFocus={focusBack}>
      <Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header>
      {@render refusal()}
      {@render fields()}
      <Dialog.Footer>
        <Dialog.Close class={buttonVariants({ variant: "outline" })}>{CARD_EDIT.cancel}</Dialog.Close>
        <Button type="submit" form={formId} disabled={pending}>{submit}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
