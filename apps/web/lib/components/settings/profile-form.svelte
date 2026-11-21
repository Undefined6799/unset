<!--
  Settings › Profile's form: the four fields of sh.unset.profile that the save can write today (domains/profile
  PROFILE_FIELDS: name, headline, place, website), posted to /profile, the one profile save, which comes back here
  (next=/settings/profile). It works as a plain form with no script; with script the page passes its ready
  `enhance` action and the status its submit handler sets (routes/settings/profile/submit.ts), so the member stays on
  the page, sees a refusal inline with what they typed, and is told when it saved. A refusal that blames a field
  (the save names it) sits under that field, marks it invalid and takes the focus, as the card editors do (staging
  walkthrough 2026-11-18 round two, finding 5). The limits come from the server (domains/profile APP_LIMITS) and are
  only shown: the save counts graphemes, and maxlength counts UTF-16 code units, so a maxlength at the limit would
  refuse a valid name of emoji or accented letters (https://html.spec.whatwg.org/multipage/input.html#attr-input-maxlength).
-->
<script lang="ts">
import type { Action } from "svelte/action";
import { PROFILE_SETTINGS as T } from "../../settings/messages.ts";
import type { ProfileFormStatus } from "../../settings/profile-form.ts";
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
type Field = keyof Values;
const FIELDS: readonly string[] = ["displayName", "headline", "location", "website"] satisfies readonly Field[];

let {
  values,
  limits,
  pagePath,
  messageFor,
  enhance = () => undefined,
  status = { kind: "editing" },
}: {
  values: Values;
  limits: { readonly displayName: number; readonly headline: number; readonly location: number };
  /** The member's own page. */
  pagePath: string;
  /** The catalog's words for a refusal code, or undefined for a code it does not know. */
  messageFor: (code: string | undefined) => string | undefined;
  /** The page's kit `enhance`, with its submit handler, as a Svelte action; the default leaves the plain form. */
  enhance?: Action<HTMLFormElement>;
  status?: ProfileFormStatus;
} = $props();

const id = $props.id();
const pending = $derived(status.kind === "saving");
const saved = $derived(status.kind === "saved");
/** The refused field and the words under it; a refusal the form has no field for shows below the fields. */
const blamed = $derived(
  status.kind === "refused" && status.field !== undefined && FIELDS.includes(status.field)
    ? { field: status.field, message: fieldMessage(status.code, status.field) }
    : undefined,
);
const refused = $derived(
  status.kind === "refused" && blamed === undefined ? (messageFor(status.code) ?? T.refused) : undefined,
);
const first = $derived(values.displayName === "");

// The blamed field takes the focus once its error is drawn (effects run after the DOM is updated).
$effect(() => {
  if (blamed === undefined) return;
  const input = document.getElementById(`${id}-${blamed.field}`);
  input?.focus();
  input?.scrollIntoView({ block: "center" });
});

function fieldMessage(code: string | undefined, field: string): string {
  if (code === "profile.too_long" && field in limits) return T.tooLong(limits[field as keyof typeof limits]);
  return (code === undefined ? undefined : T.fieldError[code]) ?? messageFor(code) ?? T.refused;
}

const errorFor = (field: string) => (blamed?.field === field ? blamed.message : undefined);
const describedBy = (field: string) => `${id}-${field}-hint${blamed?.field === field ? ` ${id}-${field}-error` : ""}`;

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
    <form method="post" action="/profile" class="grid gap-6" aria-describedby={refused === undefined ? undefined : `${id}-refused`} use:enhance>
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
            aria-invalid={errorFor(field.name) === undefined ? undefined : "true"}
            aria-describedby={describedBy(field.name)}
          />
          <p id="{id}-{field.name}-hint" class="text-muted-foreground text-sm">{field.hint}</p>
          {#if errorFor(field.name) !== undefined}
            <p id="{id}-{field.name}-error" class="text-destructive text-sm">{errorFor(field.name)}</p>
          {/if}
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
          aria-invalid={errorFor("website") === undefined ? undefined : "true"}
          aria-describedby={describedBy("website")}
        />
        <p id="{id}-website-hint" class="text-muted-foreground text-sm">{T.websiteHint}</p>
        {#if errorFor("website") !== undefined}
          <p id="{id}-website-error" class="text-destructive text-sm">{errorFor("website")}</p>
        {/if}
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
