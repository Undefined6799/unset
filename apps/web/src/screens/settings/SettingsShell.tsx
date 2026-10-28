// The settings layout (P2.13c; book phase-2.md P2.13 `SettingsShell`): a side list of the settings pages beside the
// page, which becomes a row above it on phones (Alex, 2026-10-23 01:11:22Z, "Side list"). It links only pages that
// are on main: Privacy joins with P2.22 and Invites with P2.10. The theme is not a page here; it moves to the menu.
import { safeHref } from "@unset/shared-ui";
import type { ReactNode } from "react";
import { SETTINGS } from "./messages.ts";
import styles from "./SettingsShell.module.css";

export type SettingsPage = "profile" | "account";

const PAGES: readonly { id: SettingsPage; label: string; path: string }[] = [
  { id: "profile", label: SETTINGS.profile, path: "/settings/profile" },
  { id: "account", label: SETTINGS.account, path: "/settings/account" },
];

export type SettingsShellProps = { readonly active: SettingsPage; readonly children: ReactNode };

export function SettingsShell({ active, children }: SettingsShellProps) {
  return (
    <>
      <p className={styles.label}>{SETTINGS.label}</p>
      <div className={styles.body}>
        <nav aria-label={SETTINGS.nav}>
          <ul className={styles.list}>
            {PAGES.map((page) => (
              <li key={page.id}>
                <a
                  href={safeHref(page.path, ["path"]) ?? undefined}
                  className={styles.item}
                  aria-current={page.id === active ? "page" : undefined}
                >
                  {page.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.page}>{children}</div>
      </div>
    </>
  );
}
