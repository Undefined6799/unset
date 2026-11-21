<!--
  The profile header (ADR 0072, P1.21o; the only layout since ADR 0077, Alex 2026-11-20): the avatar and the name in
  one row above the cards. The avatar opens the profile's About panel just under it: the headline, handle, place,
  website, DID and the page's contact action. The handle sits in the panel, not under the name (Alex 2026-11-20).

  The panel is a native `popover="auto"` opened by the avatar's `popovertarget`, as the header menus are
  (docs/human/features/core-shell.md), so it works with no script, which the public page never runs: click, tap,
  Enter and Space open and close it, Escape and a click outside close it, and its Close button closes it
  (https://html.spec.whatwg.org/multipage/popover.html). It is not modal and traps no focus; the browser puts it next
  in the tab order after the avatar and gives focus back when it closes, and exposes the avatar's expanded state.
  It sits below the avatar by CSS anchor positioning (the avatar is a named anchor;
  https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning/Using), and flips to stay on screen; a browser
  without it shows the panel in the popover's default place, centred. A browser with no popover support shows it as
  a block under the header. Hover opens nothing, on the owner's page too, so the avatar behaves the same everywhere,
  with or without script (Alex 2026-11-20).

  On the owner's page the name has the pen to Settings › Profile, a separate Shape button opens the avatar's editor, so
  opening the details and editing the avatar are distinct controls, and View as public opens the public page (/@did,
  routes/@[actor]) in a new tab, so this page stays open as the way back. That route reads no session, so the owner
  gets exactly the visitor's page, signed out, with no owner controls and no script.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { PROFILE_HEADER } from "../../profile/messages.ts";
import type { AvatarShape, Enhance } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import * as Avatar from "../ui/avatar/index.ts";
import { Button } from "../ui/button/index.ts";
import AvatarEditor from "./avatar-editor.svelte";

let {
  name,
  letter,
  avatar = null,
  handle = null,
  did,
  headline = "",
  location = "",
  website = null,
  contact = null,
  message = null,
  shape = "round",
  edit,
  notes,
}: {
  name: string;
  letter: string;
  /**
   * The avatar picture, filled in by the shared image work (ADR 0070) with a media-origin URL, never a blob or store
   * URL; null shows the letter. A plain img, not Bits Avatar.Image: bits-ui 2.20.6 keeps that image at display:none
   * until its script marks it loaded (dist/bits/avatar/avatar.svelte.js), and the public page runs no script. Its alt
   * is empty, since the name sits right beside it.
   */
  avatar?: { readonly url: string; readonly width: number; readonly height: number } | null;
  /** The handle row in the About panel; null leaves it out (no profile yet). */
  handle?: string | null;
  did: string;
  headline?: string;
  location?: string;
  /** Already through safeHref (lib/profile/view.ts websiteLink). */
  website?: { readonly href: string; readonly text: string } | null;
  /** The page's contact action (lib/profile/view.ts contactAction), already through safeHref. */
  contact?: { readonly href: string; readonly label: string } | null;
  /**
   * The public page's Message link (build step 10; ADR 0082 decision 6): the chat page's `/dm/<did>`, the same for every
   * visitor, so it says nothing about the member's chat account; the chat page finds the chat after sign-in.
   */
  message?: string | null;
  shape?: AvatarShape;
  /**
   * The owner's page: the pen beside the name goes to `href`, Shape opens the avatar's editor, and View as public goes
   * to `publicHref`, the page as a visitor sees it (Alex 2026-11-20).
   */
  edit?: { readonly href: string; readonly publicHref: string; readonly enhance?: Enhance };
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
 * is named rather than implicit, so it holds however the panel was opened. Only where
 * supported, since the gap would otherwise move the centred panel. One header per page, so one name.
 */
const ANCHORED =
  "[position-anchor:--profile-avatar] [position-area:bottom_span-right] [position-try-fallbacks:flip-inline,flip-block] supports-[position-area:bottom]:mt-3";
const term = "font-mono text-xs leading-[22px] tracking-wider text-muted-foreground uppercase";
</script>

<div class="group/profile">
<header class="flex min-w-0 items-center gap-4 md:gap-5">
  <button
    type="button"
    popovertarget={panelId}
    popovertargetaction="toggle"
    aria-label={PROFILE_HEADER.open(name)}
    class="group/avatar relative size-16 [anchor-name:--profile-avatar] shrink-0 cursor-pointer {rounded} outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:size-20"
  >
    {#if avatar !== null}
      <img src={avatar.url} width={avatar.width} height={avatar.height} alt="" class="size-full object-cover {rounded}" />
    {:else}
      <Avatar.Root class="size-full {rounded}">
        <Avatar.Fallback aria-hidden="true" class="text-2xl font-semibold text-muted-foreground md:text-3xl {rounded}"
          >{letter}</Avatar.Fallback
        >
      </Avatar.Root>
    {/if}
    <!-- The disclosure cue: a small chevron on the avatar's corner, turned while the panel is open. -->
    <span
      aria-hidden="true"
      class="absolute -end-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-card text-foreground"
    >
      <Icon name="open" size={16} class="transition-transform group-has-[:popover-open]/profile:rotate-180 motion-reduce:transition-none" />
    </span>
  </button>
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-start gap-1">
      <h1 class="min-w-0 text-2xl leading-8 font-bold tracking-tight [overflow-wrap:anywhere] md:text-3xl md:leading-9">{name}</h1>
      {#if edit !== undefined}
        <Button
          href={edit.href}
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
        >
          <Icon name="edit" size={16} label={PROFILE_HEADER.edit} />
        </Button>
        <AvatarEditor {shape} enhance={edit.enhance} />
        <Button
          href={edit.publicHref}
          target="_blank"
          rel="noopener"
          variant="ghost"
          size="sm"
          class="shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">{PROFILE_HEADER.viewPublic}</Button
        >
      {/if}
    </div>
  </div>
  {#if message !== null}
    <Button href={message} variant="outline" size="sm" class="shrink-0 pointer-coarse:min-h-11">
      <Icon name="comment" size={16} />{PROFILE_HEADER.message}
    </Button>
  {/if}
</header>

<section
  id={panelId}
  popover="auto"
  aria-labelledby={titleId}
  class="{ANCHORED} m-0 w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border bg-popover p-5 text-popover-foreground shadow-md open:flex"
>
  <div class="flex items-center justify-between gap-3">
    <h2 id={titleId} class="font-mono text-xs tracking-wider text-muted-foreground uppercase">{PROFILE_HEADER.title}</h2>
    <Button
      variant="ghost"
      size="icon-sm"
      popovertarget={panelId}
      popovertargetaction="hide"
      class="-me-2 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
    >
      <Icon name="close" size={16} label={PROFILE_HEADER.close} />
    </Button>
  </div>
  {#if headline !== ""}<p class="m-0 text-lg leading-7 font-semibold [overflow-wrap:anywhere]">{headline}</p>{/if}
  <dl class="m-0 text-sm">
    {#if handle !== null}
      <div class={row}>
        <dt class={term}>{PROFILE_HEADER.handle}</dt>
        <dd class="m-0 min-w-0 font-mono [overflow-wrap:anywhere]">{handle}</dd>
      </div>
    {/if}
    {#if location !== ""}
      <div class={row}><dt class={term}>{PROFILE_HEADER.place}</dt><dd class="m-0 min-w-0">{location}</dd></div>
    {/if}
    {#if website !== null}
      <div class={row}>
        <dt class={term}>{PROFILE_HEADER.web}</dt>
        <dd class="m-0 min-w-0"><a href={website.href} rel="me nofollow ugc noopener noreferrer">{website.text}</a></dd>
      </div>
    {/if}
    <div class={row}>
      <dt class={term}>{PROFILE_HEADER.did}</dt>
      <dd class="m-0 min-w-0"><code class="font-mono text-xs leading-[22px] break-all">{did}</code></dd>
    </div>
  </dl>
  {#if contact !== null}
    <!-- A label of up to 40 graphemes wraps inside the panel on a 320px screen, as card-footer buttons do (app.css): the
         stock Button never wraps, and cn() lets these classes replace its nowrap and fixed height. -->
    <Button
      href={contact.href}
      rel="nofollow ugc noopener noreferrer"
      class="h-auto min-h-9 max-w-full self-start whitespace-normal text-left">{contact.label}</Button
    >
  {/if}
</section>
{#if notes !== undefined}
  <div class="mt-4 flex flex-col items-start gap-3 text-sm text-muted-foreground [&_p]:my-0">{@render notes()}</div>
{/if}
</div>

