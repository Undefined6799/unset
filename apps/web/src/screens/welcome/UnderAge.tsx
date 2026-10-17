// The blocked page (P2.12). Neutral, with one mailto when the support address is a real email. No form and no stored text.
import { Link, type SafeHref } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export type UnderAgeProps = { readonly appeal: SafeHref | null };

export function UnderAge({ appeal }: UnderAgeProps) {
  return (
    <>
      <h1>{WELCOME.blockedTitle}</h1>
      <p>{WELCOME.blockedLead}</p>
      {appeal === null ? (
        <p>{WELCOME.appealUnpublished}</p>
      ) : (
        <p>
          <Link href={appeal} variant="standalone">
            {WELCOME.appeal}
          </Link>
        </p>
      )}
    </>
  );
}
