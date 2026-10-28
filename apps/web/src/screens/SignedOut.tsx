// After signing out (P2.08; plan §5.3 "Logout"). Signing out of unset.sh does not end the session on the sign-in
// server, so the page points there; on a shared computer that is the step that matters. P2.08b: the server passes
// the issuer recorded at sign-in, so an account on another PDS is sent to its own server. P2.08s (Alex, 2026-10-23
// 13:15Z): one Sign out, then one box that asks whether to sign out of the atproto account too. Signing out there
// ends only that browser's session on the PDS (@atproto/oauth-provider 0.23.1, dist/router/create-api-middleware.js
// `/sign-out` → removeDeviceAccount); other apps' grants stay until revoked there, so the box says so. P2.05s:
// "No thanks" posts, so the next sign-in no longer asks for the password; it keeps the standalone look.
import { Button } from "@unset/shared-ui";
import { SIGNED_OUT } from "./messages.ts";
import { PdsAccountLink } from "./PdsAccountLink.tsx";
import styles from "./SignedOut.module.css";
import box from "./SignInBox.module.css";

export type SignedOutProps = {
  /** The issuer origin recorded at sign-in, or our PDS's when none was carried. */
  issuer: string;
  /** True when `issuer` is our PDS. */
  ours: boolean;
};

export function SignedOut({ issuer, ours }: SignedOutProps) {
  return (
    <section aria-labelledby="signed-out-title" className={`${box.box} ${styles.box}`}>
      <h1 id="signed-out-title" className={box.title}>
        {SIGNED_OUT.title}
      </h1>
      <p className={box.body}>
        {SIGNED_OUT.ask} {SIGNED_OUT.otherApps}
      </p>
      <div className={styles.choices}>
        <PdsAccountLink issuer={issuer} ours={ours} />
        <form method="post" action="/signed-out">
          <Button type="submit" variant="standalone" next>
            {SIGNED_OUT.noThanks}
          </Button>
        </form>
      </div>
    </section>
  );
}
