// The page shell (P1.23; plan §5.1): every page is server-rendered, and a page loads JavaScript only when an island on
// it will hydrate. There is no inline script or style; the bootstrap is one external module.
import type { ReactNode } from "react";
import { type IslandRun, IslandRunContext } from "./islands/runtime/island.tsx";
import { type BuildManifest, preloadsFor } from "./islands/runtime/manifest.ts";

/** P1.22's documentPrefs output that the markup uses (the response headers stay with the interface). */
export type PagePrefs = Readonly<{
  htmlAttrs: Readonly<{ lang: "en"; "data-theme"?: "dark" | "light" }>;
  colorScheme: "dark" | "light" | "dark light";
}>;

/** Where built files load from: ASSETS_BASE's origin plus the manifest's `assets/<name>`. */
export type Assets = Readonly<{ origin: string; manifest: BuildManifest }>;

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
  run: IslandRun;
  children: ReactNode;
}): ReactNode {
  const { prefs, run } = props;
  return (
    <html {...prefs.htmlAttrs}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content={prefs.colorScheme} />
        <title>{props.title}</title>
      </head>
      <body>
        <IslandRunContext value={run}>{props.children}</IslandRunContext>
        <IslandScripts run={run} assets={props.assets} />
      </body>
    </html>
  );
}
