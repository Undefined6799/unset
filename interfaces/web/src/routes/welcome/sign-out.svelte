<script lang="ts">
// Onboarding's way out (P2.12i): this browser's sign-out with no script, through the one sign-out route, under the
// step's own form and quieter than its Continue.
import { Button } from "@unset/apps-web/lib/components/ui/button";
import { WELCOME } from "./messages.ts";
</script>

<form method="POST" action="/logout"><Button type="submit" variant="ghost">{WELCOME.signOut}</Button></form>
