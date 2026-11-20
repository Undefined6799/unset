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
import type { EditorCommand, MarkdownEditor } from "../../editor/milkdown.ts";
import { TEXT_EDITOR } from "../../profile/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
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

const TOOLS: readonly { readonly command: EditorCommand; readonly label: string; readonly icon: IconName }[] = [
  { command: "heading", label: TEXT_EDITOR.heading, icon: "heading" },
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
      onChange: (markdown) => {
        changed = true;
        textarea.value = markdown;
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
</script>

<div class="grid gap-2">
  <Label id={labelId} for={id}>{label}</Label>
  <div class="grid rounded-md border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 {editor === undefined ? 'hidden' : ''}" aria-invalid={invalid}>
    <div role="toolbar" aria-label={TEXT_EDITOR.toolbar} class="sticky top-0 z-10 flex flex-wrap gap-1 border-b bg-background p-1">
      {#each TOOLS as tool (tool.command)}
        <Button type="button" variant="ghost" size="icon" onclick={() => run(tool.command)}><Icon name={tool.icon} label={tool.label} /></Button>
      {/each}
    </div>
    <div
      bind:this={host}
      class="min-h-64 px-3 py-2 text-base md:text-sm [&_.markdown-editor]:min-h-60 [&_.markdown-editor]:outline-none [&_.markdown-editor]:flex [&_.markdown-editor]:flex-col [&_.markdown-editor]:gap-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-3 [&_blockquote]:border-input [&_blockquote]:ps-3.5 [&_blockquote]:text-muted-foreground [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline"
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
