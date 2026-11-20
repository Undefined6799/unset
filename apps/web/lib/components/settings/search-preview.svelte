<!--
  Settings › Privacy › the search result preview (P1.21y; review plan 2026-11-18 §7.2: "a short 'what this page looks
  like in search' preview built from the same values ... our own rendering, labelled as an example"). It draws what
  the public page publishes (routes/@[actor]/+page.server.ts `meta`): the title, the description and the page's
  address, in the shape of a search result, cut by CSS as results are cut. The picture is the letter avatar until
  profile pictures are served from the media origin (ADR 0070); the page then gains og:image and this preview the
  same picture, never a PDS blob URL. Nothing here is a link: it is a picture of a result, not one.
-->
<script lang="ts">
import { SEARCH_AI_SETTINGS as T } from "../../settings/messages.ts";
import * as Avatar from "../ui/avatar/index.ts";

let {
  title,
  description,
  url,
  letter,
  listed,
}: {
  title: string;
  description: string;
  /** The public page's canonical address, as its canonical link gives it. */
  url: string;
  letter: string;
  /** "Search engines may list my page" is on, as the form shows it now. */
  listed: boolean;
} = $props();

const id = $props.id();
const address = $derived.by(() => {
  const parsed = URL.parse(url);
  return parsed === null ? { site: url, path: "" } : { site: parsed.host, path: parsed.pathname };
});
</script>

<figure class="m-0 grid gap-2" aria-labelledby="{id}-caption">
  <figcaption id="{id}-caption" class="text-sm font-medium">{T.preview}</figcaption>
  <div class="bg-background flex items-start gap-4 rounded-md border p-4" data-search-preview>
    <div class="grid min-w-0 flex-1 gap-1">
      <p class="m-0 min-w-0 text-sm">
        <span class="block truncate">{address.site}</span>
        <span class="text-muted-foreground block truncate text-xs">{address.site}{address.path ? ` › ${address.path.replace(/^\//, "")}` : ""}</span>
      </p>
      <p class="text-primary m-0 line-clamp-1 text-lg leading-snug font-medium break-words" data-preview-title>{title}</p>
      {#if description !== ""}
        <p class="text-muted-foreground m-0 line-clamp-2 text-sm" data-preview-description>{description}</p>
      {/if}
    </div>
    <Avatar.Root class="size-16 shrink-0 rounded-md">
      <Avatar.Fallback aria-hidden="true" class="rounded-md text-2xl font-semibold text-muted-foreground"
        >{letter}</Avatar.Fallback
      >
    </Avatar.Root>
  </div>
  <p class="text-muted-foreground m-0 text-sm">{T.previewNote}</p>
  {#if !listed}
    <p class="text-muted-foreground m-0 text-sm" data-preview-unlisted>{T.previewUnlisted}</p>
  {/if}
</figure>
