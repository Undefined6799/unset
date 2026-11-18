<!--
  Settings › Profile's form: the four fields of sh.unset.profile that the save can write today (domains/profile
  PROFILE_FIELDS: name, headline, place, website), posted to /profile, the one profile save, which comes back here
  (next=/settings/profile). It works as a plain form with no script; with script the page's `enhance` keeps the member
  on the page, shows a refusal inline with what they typed, and says when it saved. The limits come from the server
  (domains/profile APP_LIMITS) and are only shown: the save checks them, counting graphemes, which maxlength cannot.
-->
<script lang="ts">
import { PROFILE_SETTINGS as T } from "../../settings/messages.ts";
import { Icon } from "../icon/index.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { Input } from "../ui/input/index.ts";
import { Label } from "../ui/label/index.ts";

type Values = {
  readonly displayName: string;
  readonly headline: string;
  readonly location: string;
  readonly website: string;
};
/**
 * The part of SvelteKit's SubmitFunction and ActionResult (kit 3.2.0 types/index.d.ts) this form uses: after the
 * action answers, `result` says how, and `update` does what `enhance` does by default. apps/web imports nothing from
 * the framework (ADR 0056), so the page passes kit's `enhance` in.
 */
type SubmitFunction = () => (outcome: {
  result:
    | { type: "success" | "failure"; status: number }
    | { type: "redirect"; status: number; location: string }
    | { type: "error"; error: { message?: unknown } | undefined };
  update: (options?: { reset?: boolean }) => Promise<void>;
}) => Promise<void>;
type Enhance = (form: HTMLFormElement, submit?: SubmitFunction) => { destroy?: () => void } | undefined;

let {
  values,
  limits,
  pagePath,
  messageFor,
  enhance = () => undefined,
}: {
  values: Values;
  limits: { readonly displayName: number; readonly headline: number; readonly location: number };
  /** The member's own page. */
  pagePath: string;
  /** The catalog's words for a refusal code, or undefined for a code it does not know. */
  messageFor: (code: string | undefined) => string | undefined;
  enhance?: Enhance;
} = $props();

const id = $props.id();
let refused: string | undefined = $state();
let saved = $state(false);
let pending = $state(false);
const first = $derived(values.displayName === "");

const submit: SubmitFunction = () => {
  refused = undefined;
  saved = false;
  pending = true;
  return async ({ result, update }) => {
    pending = false;
    if (result.type === "error" || result.type === "failure") {
      // What the member typed stays in the fields; the words say what to fix.
      const code = result.type === "error" ? result.error?.message : undefined;
      refused = messageFor(typeof code === "string" ? code : undefined) ?? T.refused;
      return;
    }
    await update({ reset: false });
    if (result.type === "redirect" && result.location === "/settings/profile") saved = true;
  };
};

const fields = $derived([
  {
    name: "displayName",
    label: T.displayName,
    hint: T.displayNameHint(limits.displayName),
    value: values.displayName,
    required: true,
  },
  {
    name: "headline",
    label: T.headline,
    hint: T.headlineHint(limits.headline),
    value: values.headline,
    required: false,
  },
  {
    name: "location",
    label: T.location,
    hint: T.locationHint(limits.location),
    value: values.location,
    required: false,
  },
] as const);
</script>

<Card.Root>
  <Card.Header>
    <Card.Description>{first ? T.firstLead : T.lead}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form method="post" action="/profile" class="grid gap-6" aria-describedby={refused === undefined ? undefined : `${id}-refused`} use:enhance={submit}>
      <input type="hidden" name="next" value="/settings/profile" />
      {#each fields as field (field.name)}
        <div class="grid gap-2">
          <Label for="{id}-{field.name}">{field.label}</Label>
          <Input
            id="{id}-{field.name}"
            name={field.name}
            value={field.value}
            required={field.required}
            autocomplete={field.name === "displayName" ? "nickname" : "off"}
            aria-describedby="{id}-{field.name}-hint"
          />
          <p id="{id}-{field.name}-hint" class="text-muted-foreground text-sm">{field.hint}</p>
        </div>
      {/each}
      <div class="grid gap-2">
        <Label for="{id}-website">{T.website}</Label>
        <Input
          id="{id}-website"
          name="website"
          value={values.website}
          inputmode="url"
          autocomplete="url"
          spellcheck={false}
          aria-describedby="{id}-website-hint"
        />
        <p id="{id}-website-hint" class="text-muted-foreground text-sm">{T.websiteHint}</p>
      </div>
      {#if refused !== undefined}
        <Alert.Root variant="destructive" id="{id}-refused">
          <Icon name="warning" size={16} />
          <Alert.Description>{refused}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button type="submit" disabled={pending}>{pending ? T.saving : T.save}</Button>
        <p role="status" class="text-muted-foreground m-0 inline-flex items-center gap-1.5 text-sm">
          {#if saved}<Icon name="done" size={16} />{T.saved}{/if}
        </p>
      </div>
    </form>
  </Card.Content>
  <Card.Footer class="text-muted-foreground flex-wrap gap-x-4 gap-y-2 border-t text-sm">
    <p class="m-0">{T.cardsNote}</p>
    <a href={pagePath} class="inline-flex min-h-6 items-center gap-1.5">{T.viewPage}<Icon name="next" size={16} /></a>
  </Card.Footer>
</Card.Root>
