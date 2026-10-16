// The link to the sign-in server's account page (P2.08; plan §5.3 "Logout"). The href is the issuer the OAuth
// library recorded, passed in by the server, never a DID-document field. safeHref drops anything that is not https.
import { Link, safeHref } from "@unset/shared-ui";

export type PdsAccountLinkProps = {
  /** Issuer origin, for example `https://pds.test`. */
  issuer: string;
  /** True when `issuer` is our PDS. A foreign issuer gets no "our sign-in server" sentence. */
  ours: boolean;
};

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
      {ours ? (
        <p>
          {`You may still be signed in on ${host}, our sign-in server; it is the only place you type your password. `}
          On a shared computer, sign out there too.
        </p>
      ) : (
        <p>{`You may still be signed in at your sign-in server (${host}). On a shared computer, sign out there too.`}</p>
      )}
      <Link href={href} variant="standalone">
        {ours ? `Your account on ${host}` : `your sign-in server (${host})`}
      </Link>
    </>
  );
}
