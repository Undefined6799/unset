// The body every shell page shares (P1.25; plan §5.1): the skip link first, the Header, the page's own content in
// <main id="main">, and the Footer. Every piece is the kit's (sheet v45). On a zero-JS page the Header's menu stays
// the plain <details> it renders on the server, so every link works with no script.
// An `error` is a catalog code the server already checked (readErrorParam); only the catalog's text is shown for it.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Callout, Footer, Header, type SafeHref, SkipLink, safeHref } from "@unset/shared-ui";
import type { ReactNode } from "react";
import { SHELL } from "./messages.ts";

/** A fixed path on our origin as the kit's SafeHref; a path that fails safeHref is a programming error. */
function path(href: string): SafeHref {
  const safe = safeHref(href, ["path"]);
  if (safe === null) throw new Error(`shell link is not a path: ${href}`);
  return safe;
}

const SIGN_IN = { label: SHELL.signIn, href: path("/login") };
const COLUMNS = [
  { title: SHELL.siteColumn, links: [{ label: SHELL.home, href: path("/") }, SIGN_IN] },
  {
    title: SHELL.legalColumn,
    links: [
      { label: SHELL.terms, href: path("/legal/terms") },
      { label: SHELL.privacy, href: path("/legal/privacy") },
    ],
  },
];

export type AppShellProps = {
  error: ErrorCode | null;
  children: ReactNode;
};

export function AppShell({ error, children }: AppShellProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  return (
    <>
      <SkipLink>{SHELL.skip}</SkipLink>
      <Header action={SIGN_IN} menuLabel={SHELL.menu} />
      <main id="main">
        {message === undefined ? null : <Callout tone="danger">{message}</Callout>}
        {children}
      </main>
      <Footer columns={COLUMNS} note={SHELL.note} />
    </>
  );
}
