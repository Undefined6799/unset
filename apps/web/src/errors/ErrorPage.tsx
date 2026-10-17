// The page for every error the web server answers with HTML (P1.25; plan §2 rule 15). The server kit renders it
// through its error-page hook (P1.25k), which hands over only the shown code and, for internal.error, the kit's own
// request id: no path, query or header reaches it, so nothing the caller sent can be echoed.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Link, safeHref } from "@unset/shared-ui";
import { ERROR_PAGE } from "../shell/messages.ts";

export type ErrorPageProps = {
  code: ErrorCode;
  /** The kit's request id, shown on a 500 so a person can quote it; `http.request` logs the same id. */
  reqId?: string;
};

/** The catalog's text for a code the kit shows; the kit shows public codes only, each of which has a text. */
const errorText = (code: ErrorCode): string => ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code;

export function ErrorPage({ code, reqId }: ErrorPageProps) {
  const home = safeHref("/", ["path"]);
  return (
    <>
      <h1>{errorText(code)}</h1>
      <p>
        {ERROR_PAGE.code} <code>{code}</code>
      </p>
      {reqId === undefined ? null : (
        <p>
          {ERROR_PAGE.requestId} <code>{reqId}</code>
        </p>
      )}
      {home === null ? null : (
        <Link href={home} variant="standalone">
          {ERROR_PAGE.home}
        </Link>
      )}
    </>
  );
}
