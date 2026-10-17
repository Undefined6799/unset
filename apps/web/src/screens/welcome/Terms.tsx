// The terms step (P2.12). Short summaries and the two checkboxes. The country box is present only while the
// invite-country rule is on; the same sentence is in the terms.
import { Button, Checkbox, Link, safeHref } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export type TermsProps = {
  readonly countryRule: boolean;
  /** A safe return path for a re-acceptance, or null on the first pass. */
  readonly next: string | null;
  /** The versions this form is showing. The POST accepts only these. */
  readonly termsVersion: string;
  readonly privacyVersion: string;
};

export function Terms({ countryRule, next, termsVersion, privacyVersion }: TermsProps) {
  const terms = safeHref("/legal/terms", ["path"]);
  const privacy = safeHref("/legal/privacy", ["path"]);
  return (
    <>
      <h1>{WELCOME.termsTitle}</h1>
      <p>
        {WELCOME.termsLead}{" "}
        {terms === null ? null : (
          <Link href={terms} variant="standalone">
            {WELCOME.termsLink}
          </Link>
        )}{" "}
        {privacy === null ? null : (
          <Link href={privacy} variant="standalone">
            {WELCOME.privacyLink}
          </Link>
        )}
      </p>
      <form method="post" action="/welcome/terms">
        <input type="hidden" name="terms_version" value={termsVersion} />
        <input type="hidden" name="privacy_version" value={privacyVersion} />
        {next === null ? null : <input type="hidden" name="next" value={next} />}
        <Checkbox label={WELCOME.accept} name="accept" value="yes" />
        {countryRule ? <Checkbox label={WELCOME.country} name="country" value="yes" /> : null}
        <Button type="submit">{WELCOME.continue}</Button>
      </form>
    </>
  );
}
