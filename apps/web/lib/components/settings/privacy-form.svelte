<!--
  Settings › Privacy (ADR 0078, ADR 0062): who sees the member's page, Public, Signed-in members only or Only me, as
  native radios, and under Public the Search and AI fields (search-ai-fields.svelte), shown only while Public is
  ticked (Alex, 2026-11-20 20:26Z: "collapse it under the public option ... It will only appear once you check it").
  CSS shows them from the checked radio (`:has`), so this holds with no script; hidden, they still post, and the server
  keeps the stored Search and AI choices while the page is not public. One plain form, one Save, posted to
  /settings/search-and-ai, which comes back here. The words are PAGE_VISIBILITY's alone. The disclaimer stays in view;
  each choice's question mark opens that choice's one line (Alex, 20:26Z: what is written under the option, nothing
  longer) in a native `popover="auto"`, as the profile header's panel opens (profile-header.svelte): click, tap, Enter
  and Space open it, Escape, a click outside and its Close button close it, with no script
  (https://html.spec.whatwg.org/multipage/popover.html). With no popover support it shows as a block.
  With no profile yet, or a profile the PDS did not return, there is no choice to show: only Search and AI.
-->
<script lang="ts">
import type { PageVisibility } from "../../profile/types.ts";
import { PAGE_VISIBILITY as T } from "../../settings/messages.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { Label } from "../ui/label/index.ts";
import SearchAiFields from "./search-ai-fields.svelte";

let {
  visibility,
  search,
  saved,
  catchingUp = false,
}: {
  /** The stored choice; `noProfile` when there is no page yet, `unreadable` when the PDS did not answer. */
  visibility: PageVisibility | "noProfile" | "unreadable";
  /** search-ai-fields.svelte's props. */
  search: {
    readonly values: {
      readonly searchEngines: boolean;
      readonly aiSearch: boolean;
      readonly title: string;
      readonly description: string;
    };
    readonly limits: { readonly title: number; readonly description: number };
    readonly siteOff: boolean;
    readonly page: { readonly url: string; readonly name: string; readonly headline: string; readonly letter: string };
  };
  /** The page is a save's 303 back here. */
  saved: boolean;
  /** The save answered before the public page followed the new choice (it follows within seconds). */
  catchingUp?: boolean;
} = $props();

const id = $props.id();
const CHOICES: readonly PageVisibility[] = ["public", "signedIn", "ownerOnly"];
const known = $derived(visibility !== "noProfile" && visibility !== "unreadable");
</script>

{#snippet fields()}
  <SearchAiFields values={search.values} limits={search.limits} siteOff={search.siteOff} page={search.page} />
{/snippet}

<Card.Root id="privacy">
  <Card.Header>
    <Card.Title><h2>{T.title}</h2></Card.Title>
    <Card.Description>{T.lead}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form method="post" action="/settings/search-and-ai" class="grid gap-6">
      {#if saved}
        <Alert.Root>
          <Alert.Title>{T.saved}</Alert.Title>
          {#if catchingUp}<Alert.Description>{T.catchingUp}</Alert.Description>{/if}
        </Alert.Root>
      {/if}
      {#if !known}
        <p class="m-0 text-sm text-muted-foreground">{visibility === "noProfile" ? T.noProfile : T.unreadable}</p>
        {@render fields()}
      {:else}
        <fieldset class="m-0 grid min-w-0 gap-4 border-0 p-0">
          <legend class="sr-only">{T.title}</legend>
          {#each CHOICES as choice (choice)}
            <div class="group/choice grid gap-4" data-visibility-choice={choice}>
              <div class="flex items-center gap-3">
                <input
                  class="size-6 shrink-0 accent-primary"
                  type="radio"
                  name="visibility"
                  value={choice}
                  id="{id}-{choice}"
                  checked={visibility === choice}
                  data-visibility-radio
                />
                <Label for="{id}-{choice}">{T.options[choice].label}</Label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  popovertarget="{id}-{choice}-help"
                  popovertargetaction="toggle"
                  class="-ms-2 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                >
                  <Icon name="help" size={16} label={T.help.open(T.options[choice].label)} />
                </Button>
              </div>
              {#if choice === "public"}
                <!-- Shown while the Public radio is ticked, by CSS, so no script is needed; keyed on the radio, never on any
                     checked input, so a ticked switch inside does not keep it shown. -->
                <div class="ms-9 hidden min-w-0 group-has-[[data-visibility-radio]:checked]/choice:grid" data-search-under-public>
                  {@render fields()}
                </div>
              {/if}
            </div>
            <section
              id="{id}-{choice}-help"
              popover="auto"
              aria-labelledby="{id}-{choice}-help-title"
              class="m-auto w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border bg-popover p-5 text-sm text-popover-foreground shadow-md open:flex"
              data-visibility-help={choice}
            >
              <div class="flex items-center justify-between gap-3">
                <h3 id="{id}-{choice}-help-title" class="m-0 text-base font-semibold">{T.options[choice].label}</h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  popovertarget="{id}-{choice}-help"
                  popovertargetaction="hide"
                  class="-me-2 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                >
                  <Icon name="close" size={16} label={T.help.close} />
                </Button>
              </div>
              <p class="m-0">{T.options[choice].hint}</p>
            </section>
          {/each}
        </fieldset>
        <p class="m-0 text-sm text-muted-foreground">{T.disclaimer}</p>
      {/if}
      <div><Button type="submit">{T.save}</Button></div>
    </form>
  </Card.Content>
</Card.Root>
