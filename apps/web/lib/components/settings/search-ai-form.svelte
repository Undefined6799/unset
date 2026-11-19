<!--
  Settings › Profile › Search and AI (ADR 0062): two switches, both off until the member turns them on, and an optional
  title and description for search results. A plain form that posts to /settings/search-and-ai and comes back here; it
  needs no script. The switches are native checkboxes, so they work with no script, as the card editor's native
  radios do. Each says what it does and what it cannot do (review plan 2026-11-18 §7.2). With listing switched off on
  the whole site (P1.21b, `siteOff`), it says so above the switches, which still save the member's choices.
-->
<script lang="ts">
import { SEARCH_AI_SETTINGS as T } from "../../settings/messages.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { Input } from "../ui/input/index.ts";
import { Label } from "../ui/label/index.ts";

let {
  values,
  limits,
  siteOff,
}: {
  values: {
    readonly searchEngines: boolean;
    readonly aiSearch: boolean;
    readonly title: string;
    readonly description: string;
  };
  limits: { readonly title: number; readonly description: number };
  siteOff: boolean;
} = $props();

const id = $props.id();
const box = "size-6 shrink-0 accent-primary";
</script>

<Card.Root id="search-and-ai">
  <Card.Header>
    <Card.Title><h2>{T.title}</h2></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6">
    {#if siteOff}
      <Alert.Root>
        <Alert.Title>{T.siteOffTitle}</Alert.Title>
        <Alert.Description>{T.siteOff}</Alert.Description>
      </Alert.Root>
    {/if}
    <form method="post" action="/settings/search-and-ai" class="grid gap-6">
      {#each [
        { name: "searchEngines", label: T.searchEngines, hint: T.searchEnginesHint, checked: values.searchEngines },
        { name: "aiSearch", label: T.aiSearch, hint: T.aiSearchHint, checked: values.aiSearch },
      ] as choice (choice.name)}
        <div class="flex items-start gap-3">
          <input
            class={box}
            type="checkbox"
            id="{id}-{choice.name}"
            name={choice.name}
            checked={choice.checked}
            aria-describedby="{id}-{choice.name}-hint"
          />
          <div class="grid gap-1">
            <Label for="{id}-{choice.name}">{choice.label}</Label>
            <p id="{id}-{choice.name}-hint" class="text-muted-foreground text-sm">{choice.hint}</p>
          </div>
        </div>
      {/each}
      <div class="grid gap-2">
        <Label for="{id}-title">{T.searchTitle}</Label>
        <Input id="{id}-title" name="title" value={values.title} autocomplete="off" aria-describedby="{id}-title-hint" />
        <p id="{id}-title-hint" class="text-muted-foreground text-sm">{T.searchTitleHint(limits.title)}</p>
      </div>
      <div class="grid gap-2">
        <Label for="{id}-description">{T.searchDescription}</Label>
        <Input
          id="{id}-description"
          name="description"
          value={values.description}
          autocomplete="off"
          aria-describedby="{id}-description-hint"
        />
        <p id="{id}-description-hint" class="text-muted-foreground text-sm">
          {T.searchDescriptionHint(limits.description)}
        </p>
      </div>
      <p class="text-muted-foreground m-0 text-sm">{T.training}</p>
      <div><Button type="submit">{T.save}</Button></div>
    </form>
  </Card.Content>
</Card.Root>
