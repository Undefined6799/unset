// Shell composition (P1.25; plan §5.1): the skip link, shared Header and one main region. The approved core shell
// adds shared Navigation; other pages keep the Header menu and Footer. Both work on zero-JS pages.
// An `error` is a catalog code the server already checked (readErrorParam); only the catalog's text is shown for it.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Callout, Footer, Header, Navigation, type SafeHref, SkipLink, safeHref } from "@unset/shared-ui";
import type { ReactNode } from "react";
import styles from "../screens/CoreShell.module.css";
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
      { label: SHELL.domains, href: path("/legal/domains") },
    ],
  },
];

export type AppShellProps = {
  error: ErrorCode | null;
  /** Display state supplied by the route; never resolves identity or authenticates here. */
  navigation?: Readonly<{ active?: "home" | "account" | "settings"; accountName?: string }>;
  children: ReactNode;
};

export function AppShell({ error, navigation, children }: AppShellProps) {
  const message = error === null ? undefined : ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES];
  const content = (
    <>
      {message === undefined ? null : <Callout tone="danger">{message}</Callout>}
      {children}
    </>
  );
  if (navigation !== undefined) {
    return (
      <>
        <SkipLink>{SHELL.skip}</SkipLink>
        <Header brandOnly />
        <Navigation
          account={{
            href: path("/me"),
            label: SHELL.profile,
            current: navigation.active === "account",
            ...(navigation.accountName === undefined ? {} : { name: navigation.accountName }),
          }}
          primary={{ href: path("/"), label: SHELL.home, icon: "home", current: navigation.active === "home" }}
          items={[
            {
              href: path("/settings/profile"),
              label: SHELL.settings,
              icon: "settings",
              current: navigation.active === "settings",
            },
          ]}
          menuLabel={SHELL.coreMenu}
          closeLabel={SHELL.closeMenu}
        />
        <main id="main" tabIndex={-1} className={styles.main}>
          {content}
        </main>
      </>
    );
  }
  return (
    <>
      <SkipLink>{SHELL.skip}</SkipLink>
      <Header action={SIGN_IN} menuLabel={SHELL.menu} />
      <main id="main">{content}</main>
      <Footer columns={COLUMNS} note={SHELL.note} />
    </>
  );
}
