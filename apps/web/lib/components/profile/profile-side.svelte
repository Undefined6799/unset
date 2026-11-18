<!--
  The profile's side column (the profile-card mockup, Alex 2026-11-17: "Mara Lind"): the avatar, the name, the handle,
  the headline and a short list of details, the owner's edit link, then whatever the page adds (its notes, the sign-in
  server link and Sign out), in small muted text. On wide screens it is the left column; from tablet width down to
  phones it sits above the cards, the avatar beside the text on a tablet and above it on a phone. There is no picture yet (no media proxy), so the avatar is the letter, as
  everywhere else.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { PROFILE_SIDE } from "../../profile/messages.ts";
import { Icon } from "../icon/index.ts";
import * as Avatar from "../ui/avatar/index.ts";

let {
  name,
  letter,
  handle = null,
  did,
  headline = "",
  location = "",
  website = null,
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
  /** The owner's link to edit these fields, and its words. */
  edit?: { readonly href: string; readonly label: string };
  children?: Snippet;
} = $props();

const row = "flex gap-2 border-t py-1.5";
const term = "w-18 shrink-0 font-mono text-xs leading-[22px] tracking-wider text-muted-foreground uppercase";
const detail = "m-0 min-w-0 [overflow-wrap:anywhere]";
</script>

<header class="flex flex-col gap-4 md:max-lg:flex-row md:max-lg:items-start md:max-lg:gap-7">
  <Avatar.Root class="size-24 md:size-42 lg:aspect-square lg:size-auto lg:w-full">
    <Avatar.Fallback aria-hidden="true" class="text-4xl font-semibold text-muted-foreground md:text-6xl lg:text-8xl"
      >{letter}</Avatar.Fallback
    >
  </Avatar.Root>
  <div class="flex min-w-0 flex-1 flex-col">
    <h1 class="text-3xl leading-8 font-bold tracking-tight [overflow-wrap:anywhere]">{name}</h1>
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
    {#if edit !== undefined}
      <p class="mt-4 font-mono text-xs">
        <a href={edit.href} class="inline-flex min-h-6 items-center gap-1.5"><Icon name="edit" size={16} />{edit.label}</a>
      </p>
    {/if}
    {#if children !== undefined}
      <div class="mt-4 flex flex-col items-start gap-3 text-sm text-muted-foreground [&_p]:my-0">{@render children()}</div>
    {/if}
  </div>
</header>
