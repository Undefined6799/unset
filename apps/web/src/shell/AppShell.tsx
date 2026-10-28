// Shell composition (P1.25; plan §5.1): the skip link, shared Header and one main region. The approved core shell
// adds shared Navigation; other pages keep the Header menu and Footer. Both work on zero-JS pages. A feed page
// (P1.25f) scrolls without end, so it has no footer: the footer's legal links move into the Header nav, which folds
// into the same zero-JS menu.
// An `error` is a catalog code the server already checked (readErrorParam); only the catalog's text is shown for it.
import { ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import {
  Callout,
  Footer,
  Header,
  Icon,
  Navigation,
  NavigationMenuButton,
  type SafeHref,
  SkipLink,
  safeHref,
  ThemePickerSlot,
} from "@unset/shared-ui";
import type { ReactNode } from "react";
import styles from "../screens/CoreShell.module.css";
import { PREFS, SHELL } from "./messages.ts";
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
const MENU_ID = "core-menu";
const THEME_LABELS = { group: PREFS.theme, dark: PREFS.dark, system: PREFS.system, light: PREFS.light };

/** This browser's sign-out (P2.08d), as the drawer's one action; only a page with a session shows it. */
const SIGN_OUT = (
  <form method="post" action="/logout">
    <button className={styles.signOut} type="submit">
      <Icon name="signout" size={24} />
      <span>{SHELL.signOut}</span>
    </button>
  </form>
);

const COLUMNS = [
  { title: SHELL.siteColumn, links: [{ label: SHELL.home, href: path("/") }, SIGN_IN] },
  { title: SHELL.legalColumn, links: LEGAL },
];

export type AppShellProps = {
  error: ErrorCode | null;
  /** Display state supplied by the route; never resolves identity or authenticates here. */
  navigation?: Readonly<{ active?: "home" | "account" | "settings"; accountName?: string; accountPath?: string }>;
  /** A feed page: no footer, its links in the header (the default shell only). */
  feed?: true;
  /** The theme form; the server passes it on app pages only: the footer's, or the core drawer's picker. */
  prefs?: PrefsFormsProps;
  children: ReactNode;
};

export function AppShell({ error, navigation, feed, prefs, children }: AppShellProps) {
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
        <Header brandOnly start={<NavigationMenuButton menuId={MENU_ID} label={SHELL.coreMenu} />} />
        <Navigation
          menuId={MENU_ID}
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
          homeLabel={SHELL.homeLabel}
          {...(navigation.accountPath === undefined ? {} : { actions: SIGN_OUT })}
          {...(prefs === undefined
            ? {}
            : {
                extra: <ThemePickerSlot {...prefs} labels={THEME_LABELS} />,
              })}
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
      {/* The header and main fill the first screen, so the footer starts below it (Alex, 2026-10-23). */}
      <div className={styles.page}>
        <Header action={SIGN_IN} menuLabel={SHELL.menu} {...(feed ? { nav: LEGAL } : {})} />
        <main id="main">{content}</main>
      </div>
      {feed ? null : (
        <Footer columns={COLUMNS} note={SHELL.note}>
          {prefs === undefined ? null : <PrefsForms {...prefs} />}
        </Footer>
      )}
    </>
  );
}
