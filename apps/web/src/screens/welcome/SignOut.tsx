// Onboarding's way out (P2.12i). A member held at a welcome step, the age step included, signs this browser out
// with no script through the one sign-out route (P2.08d), as the profile and settings pages do. It sits under the
// step's own form, quieter than Continue, so the step stays the page's main action. The blocked page has no session
// left and does not show it.
import { Button } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";
import styles from "./SignOut.module.css";

export function SignOut() {
  return (
    <form method="post" action="/logout" className={styles.signOut}>
      <Button type="submit" variant="standalone">
        {WELCOME.signOut}
      </Button>
    </form>
  );
}
