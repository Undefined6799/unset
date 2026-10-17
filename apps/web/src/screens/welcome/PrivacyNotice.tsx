// The one-time privacy banner (P2.12, review r1-part1 F15). A link to the notice, not a new acceptance.
import { Callout, Link, safeHref } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export function PrivacyNotice() {
  const href = safeHref("/legal/privacy", ["path"]);
  return (
    <Callout tone="info" title={WELCOME.privacyNoticeTitle}>
      {href === null ? (
        WELCOME.privacyNotice
      ) : (
        <Link href={href} variant="standalone">
          {WELCOME.privacyNotice}
        </Link>
      )}
    </Callout>
  );
}
