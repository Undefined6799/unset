<!--
  The limited page (ADR 0078; Alex, 2026-11-20 19:46Z): what someone the member's choice leaves out sees at their page's
  address, so the member, who may be active elsewhere on unset.sh, can still be recognised. The side column with only
  the avatar, name, handle and DID, and one sentence; no headline, details or cards. `signIn` is the sign-in address
  when signing in would show the page (a page for signed-in members), else null (a page only its member sees).
-->
<script lang="ts">
import { LIMITED_PAGE } from "../../profile/messages.ts";
import type { AvatarShape } from "../../profile/types.ts";
import { Button } from "../ui/button/index.ts";
import ProfileLayout from "./profile-layout.svelte";
import ProfileSide from "./profile-side.svelte";

let {
  name,
  letter,
  handle,
  did,
  shape,
  signIn,
}: { name: string; letter: string; handle: string | null; did: string; shape: AvatarShape; signIn: string | null } =
  $props();
</script>

<ProfileLayout>
  {#snippet side()}
    <ProfileSide {name} {letter} {handle} {did} {shape}>
      <p data-limited={signIn === null ? "ownerOnly" : "signedIn"}>
        {signIn === null ? LIMITED_PAGE.ownerOnly : LIMITED_PAGE.signedIn}
      </p>
      {#if signIn !== null}<Button href={signIn}>{LIMITED_PAGE.signIn}</Button>{/if}
    </ProfileSide>
  {/snippet}
</ProfileLayout>
