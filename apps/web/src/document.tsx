// The page shell (P1.23; plan §5.1): every page is server-rendered, and a page loads JavaScript only when an island on
// it will hydrate. There is no inline script or style; the bootstrap is one external module, and every page links the
// CSS Modules' stylesheets the manifest names (P1.23c), so the CSP's style-src needs nothing new.
// P1.25: the head is shell/head.tsx, and a page that asks for the shell renders inside AppShell. A zero-JS page gets
// no island run at all: with no renderer every IslandSlot renders its server markup, and no script is written.
import { IslandRendererContext } from "@unset/shared-islands";
import type { ReactNode } from "react";
import { type IslandRun, IslandRunContext, renderSlot } from "./islands/runtime/island.tsx";
import { type BuildManifest, preloadsFor } from "./islands/runtime/manifest.ts";
import { AppShell, type AppShellProps } from "./shell/AppShell.tsx";
import { Head } from "./shell/head.tsx";

/** P1.22's documentPrefs output that the markup uses (the response headers stay with the interface). */
export type PagePrefs = Readonly<{
  htmlAttrs: Readonly<{ lang: "en"; "data-theme"?: "dark" | "light" }>;
  colorScheme: "dark" | "light" | "dark light";
}>;

/** Where built files load from: ASSETS_BASE's origin plus the manifest's `assets/<name>`. */
export type Assets = Readonly<{ origin: string; manifest: BuildManifest }>;

/** A page inside AppShell: the checked `?error=` code, and whether search engines may index it. */
export type ShellOptions = Readonly<{
  error: AppShellProps["error"];
  noindex: boolean;
  navigation?: NonNullable<AppShellProps["navigation"]>;
  /** A feed page: no footer (AppShellProps["feed"]). */
  feed?: true;
  /** Sign in opens in place (AppShellProps["signIn"]). */
  signIn?: NonNullable<AppShellProps["signIn"]>;
  /** The footer's theme form, on app pages only. */
  prefs?: NonNullable<AppShellProps["prefs"]>;
}>;

/**
 * The bootstrap and its preloads. It renders after the body, so by then every island on the page has been counted;
 * React hoists the modulepreload links into <head> (react-dom 19.2.8 resource hoisting).
 */
function IslandScripts({ run, assets }: { run: IslandRun; assets: Assets }): ReactNode {
  if (run.used.size === 0) return null;
  const url = (file: string) => `${assets.origin}/${file}`;
  return (
    <>
      {preloadsFor(assets.manifest, run.used).map((file) => (
        <link key={file} rel="modulepreload" href={url(file)} />
      ))}
      <script type="module" src={url(assets.manifest.boot)} />
    </>
  );
}

export function Document(props: {
  prefs: PagePrefs;
  title: string;
  assets: Assets;
  /** null on a zero-JS page. */
  run: IslandRun | null;
  /** Absent for a screen that still renders its own <main> (the screens built before P1.25). */
  shell?: ShellOptions;
  /** Load the owner's README editor entry (ADR 0037 point 5); only its own page asks. */
  editor?: true;
  children: ReactNode;
}): ReactNode {
  const { prefs, run, shell } = props;
  const page =
    shell === undefined ? (
      props.children
    ) : (
      <AppShell
        error={shell.error}
        {...(shell.navigation === undefined ? {} : { navigation: shell.navigation })}
        {...(shell.feed === undefined ? {} : { feed: shell.feed })}
        {...(shell.signIn === undefined ? {} : { signIn: shell.signIn })}
        {...(shell.prefs === undefined ? {} : { prefs: shell.prefs })}
      >
        {props.children}
      </AppShell>
    );
  return (
    <html {...prefs.htmlAttrs}>
      <Head
        title={props.title}
        colorScheme={prefs.colorScheme}
        assets={props.assets}
        noindex={shell?.noindex ?? false}
      />
      <body>
        {run === null ? (
          page
        ) : (
          <IslandRunContext value={run}>
            <IslandRendererContext value={renderSlot}>{page}</IslandRendererContext>
          </IslandRunContext>
        )}
        {run === null ? null : <IslandScripts run={run} assets={props.assets} />}
        {props.editor && props.assets.manifest.editor !== undefined ? (
          <script type="module" src={`${props.assets.origin}/${props.assets.manifest.editor}`} />
        ) : null}
      </body>
    </html>
  );
}
