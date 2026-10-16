// The page between the sign-in form and the authorization server (P2.05; P1.08's rule for leaving the site after a
// form POST). Chromium applies `form-action 'self'` to a form's redirects, so POST /login answers 303 to this page,
// which moves on with a meta refresh: a new navigation outside the form's redirect chain, and no script. The link is
// for a browser that does not follow the refresh. The target is a SafeHref; the renderer escapes it in both attributes.
import { Link, type SafeHref } from "@unset/shared-ui";

export type LoginContinueProps = {
  target: SafeHref;
  /** The target's host, as the person will see it in the address bar. */
  host: string;
  /** True for our own PDS, which gets the wording P2.08's account link uses. */
  ours: boolean;
};

export function LoginContinue({ target, host, ours }: LoginContinueProps) {
  return (
    <main>
      <meta httpEquiv="refresh" content={`0;url=${target}`} />
      <h1>
        You are going to <strong>{host}</strong>
      </h1>
      {ours ? <p>This is our sign-in server; it is the only place you type your password.</p> : null}
      <Link href={target} variant="standalone">
        {`Continue to ${host}`}
      </Link>
    </main>
  );
}
