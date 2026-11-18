<!--
  The profile's side column (the profile-card mockup, Alex 2026-11-17: "Mara Lind"): the avatar, the name, the handle,
  the headline and a short list of details, then whatever the page adds (its notes, the sign-in server link and Sign
  out), in small muted text. On wide screens it is the left column; from tablet width down to phones it sits above the
  cards, the avatar beside the text on a tablet and above it on a phone. On the owner's page a small pen beside the
  name goes to Settings › Profile, and the avatar opens its editor (its shape, for now). There is no picture yet (no
  media proxy), so the avatar is the letter, as everywhere else, in the member's chosen shape.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { PROFILE_SIDE } from "../../profile/messages.ts";
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
  shape = "round",
  edit,
  children,
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
  shape?: AvatarShape;
  /** The owner's page: the pen beside the name goes to `href`, and the avatar opens its editor. */
  edit?: { readonly href: string; readonly enhance?: Enhance };
  children?: Snippet;
} = $props();

/** The avatar's box at each width; the avatar fills it. */
const box = "size-24 shrink-0 md:size-42 lg:aspect-square lg:size-auto lg:w-full";
const row = "flex gap-2 border-t py-1.5";
const term = "w-18 shrink-0 font-mono text-xs leading-[22px] tracking-wider text-muted-foreground uppercase";
const detail = "m-0 min-w-0 [overflow-wrap:anywhere]";
</script>

{#snippet avatar()}
  <Avatar.Root class="size-full {shape === 'round' ? 'rounded-full' : 'rounded-[12%]'}">
    <Avatar.Fallback
      aria-hidden="true"
      class="text-4xl font-semibold text-muted-foreground md:text-6xl lg:text-8xl {shape === 'round'
        ? 'rounded-full'
        : 'rounded-[12%]'}">{letter}</Avatar.Fallback
    >
  </Avatar.Root>
{/snippet}

<header class="flex flex-col gap-4 md:max-lg:flex-row md:max-lg:items-start md:max-lg:gap-7">
  {#if edit === undefined}
    <div class={box}>{@render avatar()}</div>
  {:else}
    <AvatarEditor {shape} enhance={edit.enhance} class={box}>{@render avatar()}</AvatarEditor>
  {/if}
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex items-start gap-1">
      <h1 class="min-w-0 text-3xl leading-8 font-bold tracking-tight [overflow-wrap:anywhere]">{name}</h1>
      {#if edit !== undefined}
        <Button
          href={edit.href}
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
        >
          <Icon name="edit" size={16} label={PROFILE_SIDE.edit} />
        </Button>
      {/if}
    </div>
    {#if handle !== null}<p class="mt-1 font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{handle}</p>{/if}
    {#if headline !== ""}<p class="mt-3 [overflow-wrap:anywhere]">{headline}</p>{/if}
    <dl class="mt-4 text-sm">
      {#if location !== ""}
        <div class={row}><dt class={term}>{PROFILE_SIDE.place}</dt><dd class={detail}>{location}</dd></div>
      {/if}
      {#if website !== null}
        <div class={row}>
          <dt class={term}>{PROFILE_SIDE.web}</dt>
          <dd class={detail}><a href={website.href} rel="me noopener noreferrer">{website.text}</a></dd>
        </div>
      {/if}
      <div class={row}>
        <dt class={term}>{PROFILE_SIDE.did}</dt>
        <dd class={detail}><code class="font-mono text-xs leading-[22px] break-all">{did}</code></dd>
      </div>
    </dl>
    {#if children !== undefined}
      <div class="mt-4 flex flex-col items-start gap-3 text-sm text-muted-foreground [&_p]:my-0">{@render children()}</div>
    {/if}
  </div>
</header>
