// Search (P1.24u; sheet components/Search/README.md, approved by Alex 2026-10-21): one bar for people, posts and the
// web. With no JS it is a GET form: Enter sends `q` to `action`. The search island (SearchKeys) adds the sheet's keys:
// `/` focuses the bar and Ctrl/Cmd+Enter sends the same `q` to `webAction`. Web results are fetched by our server,
// never by the browser (P3.14s, ADR 0035), so both actions are same-origin paths. The bounds on `q` are P3.14's
// (2 to 64 characters). The results list (`groups`, `onPick`) arrives with P3.14s's route.
import { IslandSlot } from "@unset/shared-islands";
import { useId } from "react";
import search from "../../islands/search.island.tsx";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Kbd } from "../Kbd/Kbd.tsx";
import styles from "./Search.module.css";

export type SearchProps = {
  /** Where Enter sends `q`: the search on unset. */
  action: SafeHref;
  /** Where Ctrl/Cmd+Enter sends `q`: the web search page. */
  webAction: SafeHref;
  /** The hidden label; default "Search". */
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  /** false turns the `/` key off; only one Search per page owns it. */
  shortcut?: boolean;
  className?: string;
};

export function Search({
  action,
  webAction,
  label = "Search",
  placeholder = "search people, posts and the web",
  defaultValue,
  shortcut = true,
  className,
}: SearchProps) {
  // The island finds the form by this id; it comes from React, never from data.
  const id = useId();
  return (
    // The <search> element is the search landmark (HTML Living Standard, "the search element"; typed in
    // @types/react 19.3.0, index.d.ts:4352); the form inside it does the GET.
    <search className={className}>
      <form id={id} method="get" action={action}>
        <label className="visually-hidden" htmlFor={`${id}q`}>
          {label}
        </label>
        <div className={styles.bar}>
          <Icon name="search" size={16} />
          <input
            className={styles.field}
            id={`${id}q`}
            type="search"
            name="q"
            minLength={2}
            maxLength={64}
            required
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={placeholder}
            defaultValue={defaultValue}
          />
          {shortcut ? <Kbd className={classNames(styles.hint)}>/</Kbd> : null}
        </div>
        <IslandSlot name="search" island={search} props={{ form: id, web: webAction, shortcut }} />
      </form>
    </search>
  );
}
