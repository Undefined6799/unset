// The sign-in box (P2.05m): the title, a close control, the text naming our PDS and the one button that posts
// `intent=chooser` to the CSRF-gated POST /login with no script. GET /login draws it as its whole page; the shell
// opens the same box in place (P2.05p). The caller owns the close control and the heading level, because the page and
// the in-place box close differently and sit at different levels of the outline.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Button, Callout } from "@unset/shared-ui";
import type { ReactNode } from "react";
import styles from "./SignInBox.module.css";

export type SignInBoxProps = {
  /** The heading's id, which the box's container names itself by. */
  titleId: string;
  heading: "h1" | "h2";
  /** A return path that already passed safeReturnPath, carried through the form. */
  next: string | null;
  error: ErrorCode | null;
  /** Our PDS's host, named in the text. */
  pdsHost: string;
  close: ReactNode;
};

export function SignInBox({ titleId, heading: Heading, next, error, pdsHost, close }: SignInBoxProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  return (
    <>
      <div className={styles.head}>
        <Heading id={titleId} className={styles.title}>
          Sign in
        </Heading>
        {close}
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
    </>
  );
}
