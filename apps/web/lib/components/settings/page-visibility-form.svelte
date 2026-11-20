<!--
  Settings › Privacy › who sees the page (ADR 0078): Public, Signed-in members only or Only me, as native radios in a
  plain form that posts the one field to /profile and comes back here, so it needs no script. The words are
  PAGE_VISIBILITY's alone. The short disclaimer stays in view under the choices; each choice's question mark opens
  its whole story (Alex, 2026-11-20 19:55Z) in a native `popover="auto"`, as the profile header's panel opens
  (profile-header.svelte): click, tap, Enter and Space open it, Escape, a click outside and its Close button close it,
  with no script (https://html.spec.whatwg.org/multipage/popover.html). With no popover support it shows as a block.
-->
<script lang="ts">
import type { ProfileVisibility } from "../../profile/types.ts";
import { PAGE_VISIBILITY as T } from "../../settings/messages.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { Label } from "../ui/label/index.ts";

let {
  value,
  saved,
}: {
  /** The stored choice; `noProfile` when there is no page yet, `unreadable` when the PDS did not answer. */
  value: ProfileVisibility | "noProfile" | "unreadable";
  /** The page is a save's 303 back here. */
  saved: boolean;
} = $props();

const id = $props.id();
const CHOICES: readonly ProfileVisibility[] = ["public", "signedIn", "ownerOnly"];
const help = (choice: ProfileVisibility) =>
  choice === "public" ? T.help.public : [...T.help[choice], ...T.help.network];
</script>

<Card.Root id="page-visibility">
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
    {#if value === "noProfile"}
      <p class="m-0 text-sm text-muted-foreground">{T.noProfile}</p>
    {:else if value === "unreadable"}
      <p class="m-0 text-sm text-muted-foreground">{T.unreadable}</p>
    {:else}
      <form method="post" action="/profile" class="grid gap-6">
        <input type="hidden" name="next" value="/settings/privacy" />
        <fieldset class="m-0 grid gap-4 border-0 p-0">
          <legend class="sr-only">{T.title}</legend>
          {#each CHOICES as choice (choice)}
            <div class="flex items-start gap-3">
              <input
                class="size-6 shrink-0 accent-primary"
                type="radio"
                name="visibility"
                value={choice}
                id="{id}-{choice}"
                checked={value === choice}
                aria-describedby="{id}-{choice}-hint"
              />
              <div class="grid min-w-0 flex-1 gap-1">
                <div class="flex items-center gap-1">
                  <Label for="{id}-{choice}">{T.options[choice].label}</Label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    popovertarget="{id}-{choice}-help"
                    popovertargetaction="toggle"
                    class="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                  >
                    <Icon name="help" size={16} label={T.help.open(T.options[choice].label)} />
                  </Button>
                </div>
                <p id="{id}-{choice}-hint" class="m-0 text-sm text-muted-foreground">{T.options[choice].hint}</p>
              </div>
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
              {#each help(choice) as line (line)}<p class="m-0">{line}</p>{/each}
            </section>
          {/each}
        </fieldset>
        <p class="m-0 text-sm text-muted-foreground">{T.disclaimer}</p>
        {#if value !== "public"}
          <!-- The page leaves the Search and AI form out while this holds (routes/settings/privacy). -->
          <p class="m-0 text-sm text-muted-foreground" data-search-off>{T.searchOff}</p>
        {/if}
        <div><Button type="submit">{T.save}</Button></div>
      </form>
    {/if}
  </Card.Content>
</Card.Root>
