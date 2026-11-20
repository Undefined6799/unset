<!--
  Settings › Privacy › Search and AI (ADR 0062; P1.21y moved it here from Settings › Profile): two switches, both off
  until the member turns them on, then "Advanced": the optional search title and description and a preview of the
  search result they make (Alex, 2026-11-20 19:21Z: the preview goes inside Advanced). A plain form that posts to
  /settings/search-and-ai and comes back here; it needs no script. The switches are native checkboxes and "Advanced"
  is a native details element, so both work with no script; shadcn-svelte's Collapsible (Bits) opens only once its
  script runs. With no script the preview shows what is saved; where the client runs it follows the fields as the
  member types. Each switch says what it does and what it cannot do (review plan 2026-11-18 §7.2). With listing
  switched off on the whole site (P1.21b, `siteOff`), it says so above the switches, which still save the member's
  choices.
-->
<script lang="ts">
import { untrack } from "svelte";
import { SEARCH_AI_SETTINGS as T } from "../../settings/messages.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { Input } from "../ui/input/index.ts";
import { Label } from "../ui/label/index.ts";
import SearchPreview from "./search-preview.svelte";

let {
  values,
  limits,
  siteOff,
  saved,
  page,
}: {
  values: {
    readonly searchEngines: boolean;
    readonly aiSearch: boolean;
    readonly title: string;
    readonly description: string;
  };
  limits: { readonly title: number; readonly description: number };
  siteOff: boolean;
  /** The page is a save's 303 back here. */
  saved: boolean;
  /** What the public page shows when the overrides are empty: its address, name, headline and letter. */
  page: { readonly url: string; readonly name: string; readonly headline: string; readonly letter: string };
} = $props();

const id = $props.id();
const box = "size-6 shrink-0 accent-primary";
// The fields as the member edits them, for the preview, starting from what is saved: a save is a full page load that
// comes back here, so the form never needs to follow `values` afterwards. The form posts the inputs themselves.
const start = untrack(() => values);
let searchEngines = $state(start.searchEngines);
let title = $state(start.title);
let description = $state(start.description);
</script>

<Card.Root id="search-and-ai">
  <Card.Header>
    <Card.Title><h2>{T.title}</h2></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6">
    {#if saved}
      <Alert.Root>
        <Alert.Title>{T.saved}</Alert.Title>
      </Alert.Root>
    {/if}
    {#if siteOff}
      <Alert.Root>
        <Alert.Title>{T.siteOffTitle}</Alert.Title>
        <Alert.Description>{T.siteOff}</Alert.Description>
      </Alert.Root>
    {/if}
    <form method="post" action="/settings/search-and-ai" class="grid gap-6">
      <div class="flex items-start gap-3">
        <input
          class={box}
          type="checkbox"
          id="{id}-searchEngines"
          name="searchEngines"
          bind:checked={searchEngines}
          aria-describedby="{id}-searchEngines-hint"
        />
        <div class="grid gap-1">
          <Label for="{id}-searchEngines">{T.searchEngines}</Label>
          <p id="{id}-searchEngines-hint" class="text-muted-foreground text-sm">{T.searchEnginesHint}</p>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <input
          class={box}
          type="checkbox"
          id="{id}-aiSearch"
          name="aiSearch"
          checked={values.aiSearch}
          aria-describedby="{id}-aiSearch-hint"
        />
        <div class="grid gap-1">
          <Label for="{id}-aiSearch">{T.aiSearch}</Label>
          <p id="{id}-aiSearch-hint" class="text-muted-foreground text-sm">{T.aiSearchHint}</p>
        </div>
      </div>
      <p class="text-muted-foreground m-0 text-sm">{T.training}</p>
      <!-- Open when an override is set, so a saved one is never hidden from the member. -->
      <details class="group rounded-md border" open={values.title !== "" || values.description !== ""}>
        <summary
          class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden"
        >
          {T.advanced}
          <Icon name="down" size={16} class="transition-transform group-open:rotate-180" />
        </summary>
        <div class="grid gap-6 border-t p-4">
          <div class="grid gap-2">
            <Label for="{id}-title">{T.searchTitle}</Label>
            <Input id="{id}-title" name="title" bind:value={title} autocomplete="off" aria-describedby="{id}-title-hint" />
            <p id="{id}-title-hint" class="text-muted-foreground text-sm">{T.searchTitleHint(limits.title)}</p>
          </div>
          <div class="grid gap-2">
            <Label for="{id}-description">{T.searchDescription}</Label>
            <Input
              id="{id}-description"
              name="description"
              bind:value={description}
              autocomplete="off"
              aria-describedby="{id}-description-hint"
            />
            <p id="{id}-description-hint" class="text-muted-foreground text-sm">
              {T.searchDescriptionHint(limits.description)}
            </p>
          </div>
          <SearchPreview
            title={title.trim() || page.name}
            description={description.trim() || page.headline}
            url={page.url}
            letter={page.letter}
            listed={searchEngines}
          />
        </div>
      </details>
      <div><Button type="submit">{T.save}</Button></div>
    </form>
  </Card.Content>
</Card.Root>
