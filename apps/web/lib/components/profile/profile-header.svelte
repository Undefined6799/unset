<!--
  The compact profile header (ADR 0072, P1.21o; Alex's approved avatar-panel direction, 2026-11-20): the avatar, the
  name and the handle in one row above the cards. The avatar opens the profile's details in a panel just under it:
  the headline, place, website, DID and the page's contact action, the same fields the side column shows.

  The panel is a native `popover="auto"` opened by the avatar's `popovertarget`, as the header menus are
  (docs/human/features/core-shell.md), so it works with no script, which the public page never runs: click, tap,
  Enter and Space open and close it, Escape and a click outside close it, and its Close button closes it
  (https://html.spec.whatwg.org/multipage/popover.html). It is not modal and traps no focus; the browser puts it next
  in the tab order after the avatar and gives focus back when it closes, and exposes the avatar's expanded state.
  It sits below the avatar by CSS anchor positioning (the avatar is a named anchor;
  https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning/Using), and flips to stay on screen; a browser
  without it shows the panel in the popover's default place, centred. A browser with no popover support shows it as
  a block under the header.

  Where the client runs (the owner's page), a mouse resting on the avatar opens the panel after a short delay and
  leaving both closes it, unless a click pinned it open. The public page has no script, so it has no hover.

  On the owner's page the name has the pen to Settings › Profile and a separate Shape button opens the avatar's editor,
  so opening the details and editing the avatar are distinct controls.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { PROFILE_PANEL, PROFILE_SIDE } from "../../profile/messages.ts";
import type { AvatarShape, Enhance } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import * as Avatar from "../ui/avatar/index.ts";
import { Button } from "../ui/button/index.ts";
import AvatarEditor from "./avatar-editor.svelte";

let {
  name,
  letter,
  handle = null,
  did,
  headline = "",
  location = "",
  website = null,
  contact = null,
  shape = "round",
  edit,
  notes,
}: {
  name: string;
  letter: string;
  /** The handle line; null leaves it out (no profile yet). */
  handle?: string | null;
  did: string;
  headline?: string;
  location?: string;
  /** Already through safeHref (lib/profile/view.ts websiteLink). */
  website?: { readonly href: string; readonly text: string } | null;
  /** The page's contact action (lib/profile/view.ts contactAction), already through safeHref. */
  contact?: { readonly href: string; readonly label: string } | null;
  shape?: AvatarShape;
  /** The owner's page: the pen beside the name goes to `href`, and Shape opens the avatar's editor. */
  edit?: { readonly href: string; readonly enhance?: Enhance };
  /** The owner page's notes on what could not be read, in small muted text under the header. */
  notes?: Snippet;
} = $props();

const id = $props.id();
const panelId = `${id}-details`;
const titleId = `${id}-details-title`;
const rounded = $derived(shape === "round" ? "rounded-full" : "rounded-[12%]");
const row = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-t py-1.5";
/**
 * Under the avatar, its start edge on the avatar's, flipped to the other side or above when it would leave the screen
 * (CSS Anchor Positioning: position-area and position-try-fallbacks, Baseline 2026 on MDN, read 2026-11-20). The anchor
 * is named rather than implicit: showPopover() from the hover script has no invoker, so no implicit anchor. Only where
 * supported, since the gap would otherwise move the centred panel. One header per page, so one name.
 */
const ANCHORED =
  "[position-anchor:--profile-avatar] [position-area:bottom_span-right] [position-try-fallbacks:flip-inline,flip-block] supports-[position-area:bottom]:mt-3";
const term = "font-mono text-xs leading-[22px] tracking-wider text-muted-foreground uppercase";

// Hover, where the client runs: open after OPEN_DELAY with a mouse or pen on the avatar, close CLOSE_DELAY after the
// pointer has left both the avatar and the panel, unless a click pinned it. Touch has no hover, so a tap is a click.
const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;
let panel: HTMLElement | undefined = $state();
let timer: ReturnType<typeof setTimeout> | undefined;
let byHover = false;
const isOpen = () => panel?.matches(":popover-open") === true;

function hoverIn(event: PointerEvent): void {
  if (event.pointerType === "touch") return;
  clearTimeout(timer);
  if (isOpen()) return;
  timer = setTimeout(() => {
    panel?.showPopover();
    byHover = true;
  }, OPEN_DELAY);
}
function hoverOut(event: PointerEvent): void {
  if (event.pointerType === "touch") return;
  clearTimeout(timer);
  if (!byHover) return;
  timer = setTimeout(() => {
    if (byHover && panel?.contains(document.activeElement) !== true) panel?.hidePopover();
  }, CLOSE_DELAY);
}
// A click on the avatar while hover holds the panel open pins it there, rather than closing it under the pointer.
function pin(event: MouseEvent): void {
  clearTimeout(timer);
  if (!byHover || !isOpen()) return;
  event.preventDefault();
  byHover = false;
}
function toggled(event: ToggleEvent): void {
  if (event.newState === "closed") byHover = false;
}
</script>

<div class="group/profile">
<header class="flex min-w-0 items-center gap-4 md:gap-5">
  <button
    type="button"
    popovertarget={panelId}
    popovertargetaction="toggle"
    aria-label={PROFILE_PANEL.open(name)}
    class="group/avatar relative size-16 [anchor-name:--profile-avatar] shrink-0 cursor-pointer {rounded} outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:size-20"
    onpointerenter={hoverIn}
    onpointerleave={hoverOut}
    onclick={pin}
  >
    <Avatar.Root class="size-full {rounded}">
      <Avatar.Fallback aria-hidden="true" class="text-2xl font-semibold text-muted-foreground md:text-3xl {rounded}"
        >{letter}</Avatar.Fallback
      >
    </Avatar.Root>
    <!-- The disclosure cue: a small chevron on the avatar's corner, turned while the panel is open. -->
    <span
      aria-hidden="true"
      class="absolute -end-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-card text-foreground"
    >
      <Icon name="open" size={16} class="transition-transform group-has-[:popover-open]/profile:rotate-180 motion-reduce:transition-none" />
    </span>
  </button>
  <div class="min-w-0 flex-1">
    <div class="flex items-start gap-1">
      <h1 class="min-w-0 text-2xl leading-8 font-bold tracking-tight [overflow-wrap:anywhere] md:text-3xl md:leading-9">{name}</h1>
      {#if edit !== undefined}
        <Button
          href={edit.href}
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
        >
          <Icon name="edit" size={16} label={PROFILE_SIDE.edit} />
        </Button>
        <AvatarEditor {shape} enhance={edit.enhance} look="button" />
      {/if}
    </div>
    {#if handle !== null}<p class="mt-0.5 font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{handle}</p>{/if}
  </div>
</header>

<section
  bind:this={panel}
  id={panelId}
  popover="auto"
  aria-labelledby={titleId}
  class="{ANCHORED} m-0 w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border bg-popover p-5 text-popover-foreground shadow-md open:flex"
  onpointerenter={() => clearTimeout(timer)}
  onpointerleave={hoverOut}
  ontoggle={toggled}
>
  <div class="flex items-center justify-between gap-3">
    <h2 id={titleId} class="font-mono text-xs tracking-wider text-muted-foreground uppercase">{PROFILE_PANEL.title}</h2>
    <Button
      variant="ghost"
      size="icon-sm"
      popovertarget={panelId}
      popovertargetaction="hide"
      class="-me-2 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
    >
      <Icon name="close" size={16} label={PROFILE_PANEL.close} />
    </Button>
  </div>
  {#if headline !== ""}<p class="m-0 text-lg leading-7 font-semibold [overflow-wrap:anywhere]">{headline}</p>{/if}
  <dl class="m-0 text-sm">
    {#if location !== ""}
      <div class={row}><dt class={term}>{PROFILE_SIDE.place}</dt><dd class="m-0 min-w-0">{location}</dd></div>
    {/if}
    {#if website !== null}
      <div class={row}>
        <dt class={term}>{PROFILE_SIDE.web}</dt>
        <dd class="m-0 min-w-0"><a href={website.href} rel="me nofollow ugc noopener noreferrer">{website.text}</a></dd>
      </div>
    {/if}
    <div class={row}>
      <dt class={term}>{PROFILE_SIDE.did}</dt>
      <dd class="m-0 min-w-0"><code class="font-mono text-xs leading-[22px] break-all">{did}</code></dd>
    </div>
  </dl>
  {#if contact !== null}
    <Button href={contact.href} rel="nofollow ugc noopener noreferrer" class="self-start">{contact.label}</Button>
  {/if}
</section>
{#if notes !== undefined}
  <div class="mt-4 flex flex-col items-start gap-3 text-sm text-muted-foreground [&_p]:my-0">{@render notes()}</div>
{/if}
</div>

