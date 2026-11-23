<!--
  The Text card's text field (P1.21u, ADR 0073): the stock Label over the stock Textarea, which is what the form
  posts, with or without script. With script, once the field is on screen (the editor dialog or panel has opened),
  the Milkdown editor is loaded and drawn over it with a formatting bar at its top; every change is written back
  into the textarea as markdown, so Preview, a refused save shown again and the posted form all read one value.
  Until the editor has loaded, or if it fails to load, the textarea stays as it is. The textarea is then kept for
  the form but hidden from sight and from assistive technology, and anything that focuses it (the browser's own
  required check, a refused save naming the field) lands in the editor instead.
-->
<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import type { EditorCommand, MarkdownEditor, ToolbarState } from "../../editor/milkdown.ts";
import { TEXT_EDITOR } from "../../profile/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as DropdownMenu from "../ui/dropdown-menu/index.ts";
import { Label } from "../ui/label/index.ts";
import { Textarea } from "../ui/textarea/index.ts";

let {
  label,
  name,
  value,
  hint,
  rows,
  required = false,
  error,
  maxlength,
}: {
  label: string;
  name: string;
  value: string;
  hint?: string;
  rows: number;
  required?: boolean;
  error?: string;
  maxlength?: number;
} = $props();

const id = $props.id();
const labelId = `${id}-label`;
const described = $derived(
  [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`]
    .filter((x) => x !== "")
    .join(" ") || undefined,
);
const invalid = $derived(error === undefined ? undefined : ("true" as const));

let field: HTMLTextAreaElement | null = $state(null);
let host: HTMLDivElement | undefined = $state();
let editor: MarkdownEditor | undefined = $state();
let closed = false;
/** Whether the member has changed the text in the editor: text opened and saved untouched posts as it was stored. */
let changed = false;
/** What each button shows: on for the selection, and whether a press would change the text. */
let toolbar: ToolbarState = $state({ active: new Set(), enabled: new Set() });
/** Undo and Redo show no on state; the others are toggles. */
const pressed = (command: EditorCommand) =>
  command === "undo" || command === "redo" ? undefined : toolbar.active.has(command);

/** The text styles the Heading menu offers: the page shows headings of three sizes. */
const STYLES: readonly { readonly command: EditorCommand; readonly label: string }[] = [
  { command: "paragraph", label: TEXT_EDITOR.paragraph },
  { command: "heading1", label: TEXT_EDITOR.heading1 },
  { command: "heading2", label: TEXT_EDITOR.heading2 },
  { command: "heading3", label: TEXT_EDITOR.heading3 },
];
const TOOLS: readonly { readonly command: EditorCommand; readonly label: string; readonly icon: IconName }[] = [
  { command: "strong", label: TEXT_EDITOR.strong, icon: "bold" },
  { command: "emphasis", label: TEXT_EDITOR.emphasis, icon: "italic" },
  { command: "bullets", label: TEXT_EDITOR.bullets, icon: "list" },
  { command: "numbers", label: TEXT_EDITOR.numbers, icon: "numbered-list" },
  { command: "quote", label: TEXT_EDITOR.quote, icon: "quote" },
  { command: "code", label: TEXT_EDITOR.code, icon: "inline-code" },
  { command: "codeBlock", label: TEXT_EDITOR.codeBlock, icon: "code-block" },
  { command: "undo", label: TEXT_EDITOR.undo, icon: "undo" },
  { command: "redo", label: TEXT_EDITOR.redo, icon: "redo" },
];

onMount(async () => {
  try {
    const { mountMarkdownEditor } = await import("../../editor/milkdown.ts");
    if (closed || host === undefined || field === null) return;
    const textarea = field;
    const mounted = await mountMarkdownEditor(host, {
      value: textarea.value,
      labelledBy: labelId,
      // Marked at once, so a save sent before the next frame still reads the editor (formdata below). An empty field
      // is filled at once too: the browser checks `required` before formdata runs, and the first edit of a new card is
      // only a few characters to write.
      onEdit: () => {
        changed = true;
        if (textarea.value === "" && editor !== undefined) textarea.value = editor.markdown();
      },
      onChange: (markdown) => {
        textarea.value = markdown;
      },
      onToolbar: (state) => {
        toolbar = state;
      },
    });
    // Closed while it loaded: nothing was drawn for the member, so drop it.
    if (closed) {
      await mounted.destroy();
      return;
    }
    // The form reads the editor itself as it is sent, so a save pressed in the frame after typing posts that text.
    textarea.form?.addEventListener("formdata", (event) => {
      if (editor === undefined || !changed) return;
      textarea.value = editor.markdown();
      event.formData.set(name, textarea.value);
    });
    const hadFocus = document.activeElement === textarea;
    editor = mounted;
    await tick();
    if (hadFocus) mounted.focus();
  } catch {
    // The editor could not load (a dropped connection, an old browser): the textarea is still there and still posts.
  }
});
onDestroy(() => {
  closed = true;
  void editor?.destroy();
});

// The editable area carries the field's state: invalid and described by its error after a refused save.
$effect(() => {
  const area = editor === undefined ? null : (host?.querySelector("[contenteditable]") ?? null);
  if (area === null) return;
  if (invalid === undefined) area.removeAttribute("aria-invalid");
  else area.setAttribute("aria-invalid", invalid);
  if (described === undefined) area.removeAttribute("aria-describedby");
  else area.setAttribute("aria-describedby", described);
});

function run(command: EditorCommand) {
  editor?.run(command);
  editor?.focus();
}
function keepFocus(event: MouseEvent) {
  if (editor !== undefined) event.preventDefault();
}
/** The menu gives focus back to the text, not to its trigger, so typing goes on where it was. */
function backToText(event: Event) {
  event.preventDefault();
  editor?.focus();
}
</script>

<div class="grid gap-2">
  <Label id={labelId} for={id}>{label}</Label>
  <div class="grid rounded-md border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 {editor === undefined ? 'hidden' : ''}" aria-invalid={invalid}>
    <!-- The bar sticks under the site header on the page (?edit=, app.css --site-header-height) and at the top of the
         dialog, which scrolls on its own. -->
    <div role="toolbar" aria-label={TEXT_EDITOR.toolbar} class="sticky top-(--site-header-height) z-10 in-data-[slot=dialog-content]:top-0 flex flex-wrap gap-1 border-b bg-background p-1">
      <!-- A press keeps the editor's focus and selection (mousedown is not let move focus to the bar), so it acts on
           the words the member chose and, on a phone, the keyboard stays open. -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "icon" })} onmousedown={keepFocus}
          ><Icon name="heading" label={TEXT_EDITOR.heading} /></DropdownMenu.Trigger
        >
        <!-- The tick follows the editor only: the item's own toggle on select is dropped (bits-ui CheckboxItem). -->
        <DropdownMenu.Content align="start" preventScroll={false} onCloseAutoFocus={backToText}>
          {#each STYLES as style (style.command)}
            <DropdownMenu.CheckboxItem
              bind:checked={() => toolbar.active.has(style.command), () => {}}
              disabled={!toolbar.enabled.has(style.command) && !toolbar.active.has(style.command)}
              onSelect={() => editor?.run(style.command)}>{style.label}</DropdownMenu.CheckboxItem
            >
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {#each TOOLS as tool (tool.command)}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={pressed(tool.command)}
          disabled={!toolbar.enabled.has(tool.command)}
          class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          onmousedown={keepFocus}
          onclick={() => run(tool.command)}><Icon name={tool.icon} label={tool.label} /></Button
        >
      {/each}
    </div>
    <div
      bind:this={host}
      class="min-h-64 px-3 py-2 text-base md:text-sm [&_.markdown-editor]:min-h-60 [&_.markdown-editor]:outline-none [&_.markdown-editor]:flex [&_.markdown-editor]:flex-col [&_.markdown-editor]:gap-3 [&_h2]:mt-2 [&_h2]:text-4xl [&_h2]:leading-tight [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-3xl [&_h3]:leading-tight [&_h3]:font-bold [&_h3]:tracking-tight [&_h4]:mt-1 [&_h4]:text-2xl [&_h4]:leading-snug [&_h4]:font-semibold [&_h5]:mt-1 [&_h5]:text-xl [&_h5]:font-semibold [&_h6[data-level=5]]:text-lg [&_h6[data-level=5]]:font-semibold [&_h6[data-level=6]]:font-bold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-3 [&_blockquote]:border-input [&_blockquote]:ps-3.5 [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_:is(th,td)]:border-b [&_:is(th,td)]:border-input [&_:is(th,td)]:px-3 [&_:is(th,td)]:py-1.5 [&_th]:font-semibold [&_:is(th,td)>p]:my-0 [&_li[data-item-type=task]]:-ms-5 [&_li[data-item-type=task]]:list-none [&_li[data-item-type=task]]:before:me-1.5 [&_li[data-item-type=task]]:before:inline-block [&_li[data-item-type=task]]:before:size-3.5 [&_li[data-item-type=task]]:before:cursor-pointer [&_li[data-item-type=task]]:before:rounded-sm [&_li[data-item-type=task]]:before:border [&_li[data-item-type=task]]:before:border-input [&_li[data-item-type=task]]:before:align-middle [&_li[data-item-type=task]]:before:content-[''] [&_li[data-checked=true]]:before:border-primary [&_li[data-checked=true]]:before:bg-primary [&_del]:line-through [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline"
    ></div>
  </div>
  <Textarea
    bind:ref={field}
    {id}
    {name}
    {value}
    {rows}
    {required}
    {maxlength}
    class={editor === undefined ? "" : "sr-only"}
    tabindex={editor === undefined ? undefined : -1}
    aria-hidden={editor === undefined ? undefined : "true"}
    aria-invalid={invalid}
    aria-describedby={described}
    onfocus={() => editor?.focus()}
  />
  {#if hint !== undefined}<p id="{id}-hint" class="text-muted-foreground text-sm">{hint}</p>{/if}
  {#if error !== undefined}<p id="{id}-error" class="text-destructive text-sm">{error}</p>{/if}
</div>
