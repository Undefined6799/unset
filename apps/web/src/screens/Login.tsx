// The sign-in form (P2.05; plan §5.3 "Login and signup"). It posts with no script: a handle, the sign-in button, and a
// second button that sends no handle and opens our PDS's own sign-in page. The error is a catalog code the server has
// already checked (readErrorParam); the page shows only the catalog's text for it.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Button, Callout, Input } from "@unset/shared-ui";

export type LoginProps = {
  /** Prefilled from `?handle=` on old links; shown, never acted on. */
  handle: string;
  /** A return path that already passed safeReturnPath, carried through the form. */
  next: string | null;
  error: ErrorCode | null;
  /** Our PDS's host, named on the chooser button. */
  pdsHost: string;
  /** The domain a bare name is completed with, shown in the placeholder. */
  handleDomain: string;
};

export function Login({ handle, next, error, pdsHost, handleDomain }: LoginProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  return (
    <>
      <h1>Sign in</h1>
      {message === undefined ? null : <Callout tone="danger">{message}</Callout>}
      <form method="post" action="/login">
        <Input
          label="Handle"
          name="handle"
          defaultValue={handle}
          placeholder={`alice.${handleDomain}`}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
        {next === null ? null : <input type="hidden" name="next" value={next} />}
        <Button type="submit" name="intent" value="login">
          Sign in
        </Button>
        <Button type="submit" name="intent" value="chooser">
          {`Use ${pdsHost} sign-in`}
        </Button>
      </form>
    </>
  );
}
