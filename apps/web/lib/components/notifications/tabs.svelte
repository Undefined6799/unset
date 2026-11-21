<!--
  The two tabs of /notifications (P2.27c): Notifications and Sign-in history. Each is a plain link to its own page, so
  they work with no script and the browser's Back moves between them; the current one is marked aria-current="page".
-->
<script lang="ts">
import { NOTIFICATION_TABS as T } from "../../notifications/messages.ts";

let { current }: { current: "notifications" | "sign-ins" } = $props();

const tabs = [
  { id: "notifications", href: "/notifications", label: T.notifications },
  { id: "sign-ins", href: "/notifications/sign-ins", label: T.signIns },
] as const;
const tab =
  "inline-flex min-h-9 items-center border-b-2 px-3 text-sm font-medium no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring";
</script>

<nav aria-label={T.label} class="flex gap-1 border-b">
  {#each tabs as item (item.id)}
    <a
      href={item.href}
      class="{tab} {item.id === current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      aria-current={item.id === current ? "page" : undefined}>{item.label}</a
    >
  {/each}
</nav>
