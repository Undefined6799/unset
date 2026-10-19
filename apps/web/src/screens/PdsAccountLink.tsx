// The link to the sign-in server's account page (P2.08, P2.08b; plan §5.3 "Logout"). The href is the issuer the OAuth
// library recorded, passed in by the server, never a DID-document field. safeHref drops anything that is not https.
import { Link, safeHref } from "@unset/shared-ui";
import { ACCOUNT_LINK } from "./messages.ts";

export type PdsAccountLinkProps = {
  /** Issuer origin, for example `https://pds.test`. */
  issuer: string;
  /** True when `issuer` is our PDS. A foreign issuer gets no "our sign-in server" sentence. */
  ours: boolean;
};

const withHost = (text: string, host: string) => text.replace("{pdsHost}", host);

/** The account link, or null when `issuer` is not an https URL. */
export function PdsAccountLink({ issuer, ours }: PdsAccountLinkProps) {
  let url: URL;
  try {
    url = new URL(ours ? "/account" : "/", issuer);
  } catch {
    return null;
  }
  const href = safeHref(url.href, ["https:"]);
  if (href === null) return null;
  const host = url.host;
  return (
    <>
      {ours ? <p>{withHost(ACCOUNT_LINK.interstitial, host)}</p> : null}
      <Link href={href} variant="standalone">
        {withHost(ours ? ACCOUNT_LINK.ours : ACCOUNT_LINK.foreign, host)}
      </Link>
    </>
  );
}
