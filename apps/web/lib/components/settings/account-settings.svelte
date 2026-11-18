<!--
  Settings › Account's body (P2.13c, P2.08b, P2.08j, P2.08k): three stock cards. The account: the handle (shown only
  when it resolves back to the DID, P2.02) and the DID. The sign-in server, where the password, the email and deleting
  the account live, linked in a new tab so unset.sh stays open behind it. Sign out: this browser (/logout) and every
  browser, this one too (/logout/everywhere), each a plain form that posts with no script, its note beside its button.
-->
<script lang="ts">
import { SETTINGS as T } from "../../settings/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";

let {
  handle,
  did,
  handleUnavailable,
  accountLink,
}: {
  /** The verified handle, or `handle.invalid`. */
  handle: string;
  did: string;
  handleUnavailable: boolean;
  /** The sign-in server's account page, or null when none is known. */
  accountLink: { readonly href: string; readonly host: string; readonly ours: boolean } | null;
} = $props();

const withHost = (text: string, host: string) => text.replace("{pdsHost}", host);

const SIGN_OUTS: readonly { action: string; note: string; label: string; icon: IconName }[] = [
  { action: "/logout", note: T.signOutNote, label: T.signOut, icon: "signout" },
  { action: "/logout/everywhere", note: T.signOutEverywhereNote, label: T.signOutEverywhere, icon: "devices" },
];

const row = "grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4";
const term = "text-muted-foreground font-mono text-xs leading-6 tracking-wider uppercase";
</script>

<div class="grid gap-6">
  <Card.Root>
    <Card.Header><Card.Title>{T.accountTitle}</Card.Title></Card.Header>
    <Card.Content>
      <dl class="m-0 divide-y">
        <div class={row}>
          <dt class={term}>{T.handle}</dt>
          <dd class="m-0 min-w-0"><code class="font-mono text-sm [overflow-wrap:anywhere]">{handle}</code></dd>
        </div>
        <div class={row}>
          <dt class={term}>{T.did}</dt>
          <dd class="m-0 min-w-0"><code class="font-mono text-sm break-all">{did}</code></dd>
        </div>
      </dl>
      {#if handleUnavailable}
        <p class="text-muted-foreground mt-4 mb-0 inline-flex items-center gap-1.5 text-sm">
          <Icon name="warning" size={16} />{T.handleUnavailable}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if accountLink !== null}
    <Card.Root>
      <Card.Header>
        <Card.Title>{T.accountServerTitle}</Card.Title>
        <Card.Description>{T.accountLead}</Card.Description>
      </Card.Header>
      <Card.Content class="grid justify-items-start gap-4">
        {#if accountLink.ours}
          <p class="text-muted-foreground m-0 text-sm">{withHost(T.accountInterstitial, accountLink.host)}</p>
        {/if}
        <!-- A long host wraps rather than pushing the page wider than a 320px screen. -->
        <Button
          href={accountLink.href}
          target="_blank"
          rel="noopener noreferrer"
          variant="outline"
          class="h-auto min-h-9 max-w-full py-2 text-left whitespace-normal [overflow-wrap:anywhere]"
        >
          <Icon name="external" size={16} />
          {withHost(accountLink.ours ? T.accountOurs : T.accountForeign, accountLink.host)}
          <span class="sr-only">{T.newTab}</span>
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header><Card.Title>{T.signOutTitle}</Card.Title></Card.Header>
    <Card.Content class="divide-y">
      {#each SIGN_OUTS as item (item.action)}
        <form
          method="post"
          action={item.action}
          class="flex flex-col items-start gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <p class="text-muted-foreground m-0 text-sm">{item.note}</p>
          <Button type="submit" variant="outline" class="shrink-0"><Icon name={item.icon} size={16} />{item.label}</Button>
        </form>
      {/each}
    </Card.Content>
  </Card.Root>
</div>
