<!--
  The limited page (ADR 0078; Alex, 2026-11-20 19:46Z): what someone the member's choice leaves out sees at their page's
  address, so the member, who may be active elsewhere on unset.sh, can still be recognised. One card, centered on the
  page (Alex, 20:49Z: "inside an actual card, centered on the page"), with only the avatar, name, handle and DID and one
  sentence; no headline, details or cards. `signIn` is the sign-in address when signing in would show the page (a page
  for signed-in members), else null (a page only its member sees). `signUp` is the invite-request page when joining
  would show it and visitors may ask for an invite (ADR 0080), else null.
-->
<script lang="ts">
import { LIMITED_PAGE } from "../../profile/messages.ts";
import type { AvatarShape } from "../../profile/types.ts";
import * as Avatar from "../ui/avatar/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";

let {
  name,
  letter,
  handle,
  did,
  shape,
  signIn,
  signUp,
}: {
  name: string;
  letter: string;
  handle: string | null;
  did: string;
  shape: AvatarShape;
  signIn: string | null;
  signUp: string | null;
} = $props();

const corners = $derived(shape === "round" ? "rounded-full" : "rounded-[12%]");
</script>

<div class="flex min-h-[60vh] items-center justify-center px-4 py-12">
  <Card.Root class="w-full max-w-sm items-center px-6 text-center" data-limited-card>
    <Avatar.Root class="size-24 {corners}">
      <Avatar.Fallback aria-hidden="true" class="text-4xl font-semibold text-muted-foreground {corners}">
        {letter}
      </Avatar.Fallback>
    </Avatar.Root>
    <div class="flex min-w-0 flex-col items-center gap-1">
      <h1 class="m-0 text-2xl leading-8 font-bold tracking-tight [overflow-wrap:anywhere]">{name}</h1>
      {#if handle !== null}
        <p class="m-0 font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{handle}</p>
      {/if}
      <code class="font-mono text-xs break-all text-muted-foreground">{did}</code>
    </div>
    <p class="m-0 text-sm text-muted-foreground" data-limited={signIn === null ? "ownerOnly" : "signedIn"}>
      {signIn === null ? LIMITED_PAGE.ownerOnly : LIMITED_PAGE.signedIn}
    </p>
    {#if signIn !== null || signUp !== null}
      <div class="flex flex-wrap justify-center gap-2">
        {#if signIn !== null}<Button href={signIn} data-limited-sign-in>{LIMITED_PAGE.signIn}</Button>{/if}
        {#if signUp !== null}
          <Button href={signUp} variant="outline" data-limited-sign-up>{LIMITED_PAGE.signUp}</Button>
        {/if}
      </div>
    {/if}
  </Card.Root>
</div>
