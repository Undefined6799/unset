// Shell composition (P1.25; plan §5.1): the skip link, shared Header and one main region. The approved core shell
// adds shared Navigation; other pages keep the Header menu and Footer. Both work on zero-JS pages. A feed page
// (P1.25f) scrolls without end, so it has no footer: the footer's legal links move into the Header nav, which folds
// into the same zero-JS menu.
// P2.05p: given our PDS's host, the default shell's Sign in opens the sign-in box over the page as a native popover
// (no script; Escape, a click outside and Close all leave the visitor where they were). The footer's Sign in stays a
// link to /login, the same box as a page, for a browser without popovers.
// An `error` is a catalog code the server already checked (readErrorParam); only the catalog's text is shown for it.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import { Callout, Footer, Header, Navigation, type SafeHref, SkipLink, safeHref } from "@unset/shared-ui";
import type { ReactNode } from "react";
import styles from "../screens/CoreShell.module.css";
import box from "../screens/SignInBox.module.css";
import { SignInBox } from "../screens/SignInBox.tsx";
import { SHELL } from "./messages.ts";
import { PrefsForms, type PrefsFormsProps } from "./PrefsForms.tsx";

/** A path on our origin as the kit's SafeHref; a path that fails safeHref is a programming error. */
function path(href: string): SafeHref {
  const safe = safeHref(href, ["path"]);
  if (safe === null) throw new Error(`shell link is not a path: ${href}`);
  return safe;
}

const SIGN_IN = { label: SHELL.signIn, href: path("/login") };
const LEGAL = [
  { label: SHELL.terms, href: path("/legal/terms") },
  { label: SHELL.privacy, href: path("/legal/privacy") },
  { label: SHELL.domains, href: path("/legal/domains") },
];
const COLUMNS = [
  { title: SHELL.siteColumn, links: [{ label: SHELL.home, href: path("/") }, SIGN_IN] },
  { title: SHELL.legalColumn, links: LEGAL },
];

export type SignInInPlace = Readonly<{ pdsHost: string; next: string | null }>;

const SIGN_IN_BOX = "sign-in";
const SIGN_IN_TITLE = "sign-in-title";

function SignInPopover({ pdsHost, next }: SignInInPlace) {
  return (
    <div
      id={SIGN_IN_BOX}
      popover="auto"
      role="dialog"
      aria-labelledby={SIGN_IN_TITLE}
      className={`${box.box} ${box.popover}`}
    >
      <SignInBox
        titleId={SIGN_IN_TITLE}
        heading="h2"
        next={next}
        error={null}
        pdsHost={pdsHost}
        close={
          <button type="button" className={box.close} popoverTarget={SIGN_IN_BOX} popoverTargetAction="hide">
            {SHELL.close}
          </button>
        }
      />
    </div>
  );
}

export type AppShellProps = {
  error: ErrorCode | null;
  /** Display state supplied by the route; never resolves identity or authenticates here. */
  navigation?: Readonly<{ active?: "home" | "account" | "settings"; accountName?: string; accountPath?: string }>;
  /** A feed page: no footer, its links in the header (the default shell only). */
  feed?: true;
  /** Our PDS's host and this page's checked return path: Sign in opens in place (the default shell only). */
  signIn?: SignInInPlace;
  /** The footer's theme form; the server passes it on app pages only (the default shell only). */
  prefs?: PrefsFormsProps;
  children: ReactNode;
};

export function AppShell({ error, navigation, feed, signIn, prefs, children }: AppShellProps) {
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
            href: path(navigation.accountPath ?? "/did"),
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
      <Header
        action={signIn === undefined ? SIGN_IN : { ...SIGN_IN, popover: SIGN_IN_BOX }}
        menuLabel={SHELL.menu}
        {...(feed ? { nav: LEGAL } : {})}
      />
      <main id="main">{content}</main>
      {signIn === undefined ? null : <SignInPopover {...signIn} />}
      {feed ? null : (
        <Footer columns={COLUMNS} note={SHELL.note}>
          {prefs === undefined ? null : <PrefsForms {...prefs} />}
        </Footer>
      )}
    </>
  );
}
