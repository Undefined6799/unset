// The sign-in page (P2.05; plan §5.3 "Login and signup"). Since P2.05r it is one button that posts with no script and
// opens our PDS's own sign-in page. Only accounts on our PDS sign in (P1.36v), so there is no handle field. Since
// P2.05m (Alex, 2026-10-23: "the sign in should only be a modal") the page is that one dialog, drawn open over the
// scrim with no shell behind it, so nothing else on the page takes focus; the close link goes back to the return
// path. The error is a catalog code the server has already checked (readErrorParam); the page shows only its text.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Button, Callout } from "@unset/shared-ui";
import styles from "./Login.module.css";

export type LoginProps = {
  /** A return path that already passed safeReturnPath, carried through the form. */
  next: string | null;
  error: ErrorCode | null;
  /** Our PDS's host, named in the text. */
  pdsHost: string;
};

export function Login({ next, error, pdsHost }: LoginProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  return (
    <main id="main" className={styles.scrim}>
      <section role="dialog" aria-modal="true" aria-labelledby="sign-in-title" className={styles.dialog}>
        <div className={styles.head}>
          <h1 id="sign-in-title" className={styles.title}>
            Sign in
          </h1>
          <a className={styles.close} href={next ?? "/"}>
            Close
          </a>
        </div>
        {message === undefined ? null : <Callout tone="danger">{message}</Callout>}
        <p className={styles.body}>
          You sign in on <strong>{pdsHost}</strong>, our sign-in server. It is the only place you type your password.
        </p>
        <form method="post" action="/login">
          {next === null ? null : <input type="hidden" name="next" value={next} />}
          <Button type="submit" name="intent" value="chooser">
            Sign in with AtProto
          </Button>
        </form>
      </section>
    </main>
  );
}
