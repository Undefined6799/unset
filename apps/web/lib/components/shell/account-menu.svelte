<!--
  The account menu with script (book P1.22m, ADR 0116 points 8 and 9): the stock shadcn-svelte Dropdown Menu over
  bits-ui 2.20.6, for its arrow keys, typeahead, focus return and menu roles (node_modules/bits-ui
  dist/bits/menu/menu.svelte.js). The shell draws the menu with no script itself, as a native popover, and loads this
  file once the client has started, so no page waits for it. Each row does what its native twin does: the two links
  are links, a theme row hands its choice to the shell, which saves it as the native picker does, and Sign out is a
  submit button of the shell's own sign-out form.
-->
<script lang="ts" generics="Theme extends string">
import { Icon, type IconName } from "../icon/index.ts";
import * as DropdownMenu from "../ui/dropdown-menu/index.ts";

let {
  open = $bindable(false),
  button = $bindable(null),
  id,
  triggerClass,
  account,
  letter,
  active,
  theme,
  signOutForm,
  text,
}: {
  open?: boolean;
  /** The menu's button, for the shell to give focus to when it swaps this menu in. */
  button?: HTMLElement | null;
  /** The id the native menu had, so one address finds either. */
  id: string;
  triggerClass: string;
  account: { name?: string | undefined; path: string };
  /** The member's initial; without one the button shows the profile icon. */
  letter: string | undefined;
  /** Which of the menu's two pages the member is on. */
  active: "account" | "settings" | undefined;
  /** The theme rows, on a page that has the theme form: the saved choice, the choices, and what a row does. */
  theme:
    | {
        heading: string;
        saved: Theme;
        choices: readonly { value: Theme; icon: IconName; label: string }[];
        choose: (choice: Theme) => void;
      }
    | undefined;
  /** The id of the sign-out form the shell holds. */
  signOutForm: string;
  text: { menu: string; profile: string; settings: string; signOut: string };
} = $props();

// A row: a 44px target on touch, as the header's own controls are, and the current page marked. The row the pointer or
// the keys are on is muted, as in the native menus: the library marks it with the accent colour, which in our theme is
// the menu's own surface (shared/ui/theme.css), so its mark alone would not show.
const row = "pointer-coarse:min-h-11 aria-[current=page]:font-medium data-highlighted:bg-muted focus:bg-muted";
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger bind:ref={button} class={triggerClass}>
    {#if letter !== undefined}<span aria-hidden="true">{letter}</span>{:else}<Icon name="profile" size={20} />{/if}
    <span class="sr-only">{text.menu}</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content {id} align="end" class="w-64 max-w-[calc(100vw-1rem)]">
    {#if account.name}
      <DropdownMenu.Label class="truncate" title={account.name}>{account.name}</DropdownMenu.Label>
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item class={row} aria-current={active === "account" ? "page" : undefined}>
      {#snippet child({ props })}
        <a {...props} href={account.path}><Icon name="profile" size={16} />{text.profile}</a>
      {/snippet}
    </DropdownMenu.Item>
    <DropdownMenu.Item class={row} aria-current={active === "settings" ? "page" : undefined}>
      {#snippet child({ props })}
        <a {...props} href="/settings/profile"><Icon name="settings" size={16} />{text.settings}</a>
      {/snippet}
    </DropdownMenu.Item>
    {#if theme !== undefined}
      <DropdownMenu.Separator />
      <!-- The rows show what was saved: the mark moves when the save has come back, as the native picker's pressed
           button does. A row keeps the menu open (Alex, 2026-10-23 02:15Z). -->
      <DropdownMenu.RadioGroup bind:value={() => theme.saved, () => {}}>
        <DropdownMenu.GroupHeading>{theme.heading}</DropdownMenu.GroupHeading>
        {#each theme.choices as choice (choice.value)}
          <DropdownMenu.RadioItem
            value={choice.value}
            closeOnSelect={false}
            onSelect={() => theme.choose(choice.value)}
            class={row}
          >
            <Icon name={choice.icon} size={16} />{choice.label}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item class="{row} w-full">
      {#snippet child({ props })}
        <button {...props} type="submit" form={signOutForm}><Icon name="signout" size={16} />{text.signOut}</button>
      {/snippet}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
