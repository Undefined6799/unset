// The sign-in page (P2.05; plan §5.3 "Login and signup"). Since P2.05r it is one button that posts with no script and
// opens our PDS's own sign-in page. Only accounts on our PDS sign in (P1.36v), so there is no handle field. Since
// P2.05m (Alex, 2026-10-23: "the sign in should only be a modal") the page is the shell's sign-in box alone, drawn
// over the scrim with no shell behind it. With no script it cannot trap focus or close on Escape, so it is a page
// region, not an aria-modal dialog. Close goes back to the page before, which the route works out (never `next`,
// often the protected page that sent the visitor here, which would only send them back). The error is a catalog
// code the server has already checked (readErrorParam).
import type { ErrorCode } from "@unset/shared-errors";
import styles from "./Login.module.css";
import box from "./SignInBox.module.css";
import { SignInBox } from "./SignInBox.tsx";

export type LoginProps = {
  /** A return path that already passed safeReturnPath, carried through the form. */
  next: string | null;
  error: ErrorCode | null;
  /** Our PDS's host, named in the text. */
  pdsHost: string;
  /** Where Close goes: a same-origin path the route already checked, or "/". */
  close: string;
};

export function Login({ next, error, pdsHost, close }: LoginProps) {
  return (
    <main id="main" className={styles.scrim}>
      <section aria-labelledby="sign-in-title" className={box.box}>
        <SignInBox
          titleId="sign-in-title"
          heading="h1"
          next={next}
          error={error}
          pdsHost={pdsHost}
          close={
            <a className={box.close} href={close}>
              Close
            </a>
          }
        />
      </section>
    </main>
  );
}
