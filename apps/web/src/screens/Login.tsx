// The sign-in page (P2.05; plan §5.3 "Login and signup"). Since P2.05r it is one button that posts with no script and
// opens our PDS's own sign-in page. Only accounts on our PDS sign in (P1.36v), so there is no handle field. The error
// is a catalog code the server has already checked (readErrorParam); the page shows only the catalog's text.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Button, Callout } from "@unset/shared-ui";

export type LoginProps = {
  /** A return path that already passed safeReturnPath, carried through the form. */
  next: string | null;
  error: ErrorCode | null;
  /** Our PDS's host, named on the button. */
  pdsHost: string;
};

export function Login({ next, error, pdsHost }: LoginProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  return (
    <>
      <h1>Sign in</h1>
      {message === undefined ? null : <Callout tone="danger">{message}</Callout>}
      <p>
        You sign in on <strong>{pdsHost}</strong>, our sign-in server. It is the only place you type your password.
      </p>
      <form method="post" action="/login">
        {next === null ? null : <input type="hidden" name="next" value={next} />}
        <Button type="submit" name="intent" value="chooser">
          {`Sign in with ${pdsHost}`}
        </Button>
      </form>
    </>
  );
}
