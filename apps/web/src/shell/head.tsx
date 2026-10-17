// The <head> of every page (P1.23, P1.25). Charset first, then the viewport, the colour scheme the server chose
// (P1.22), the title, a preload for each font face so text does not wait on the stylesheet to find them, and the
// stylesheets the manifest names. Nothing inline: the CSP allows styles and fonts from the assets path only.
// Favicons are left out until the design sheet names their files (book P1.25, "Favicons").
import type { BuildManifest } from "../islands/runtime/manifest.ts";

export type HeadProps = {
  title: string;
  colorScheme: "dark" | "light" | "dark light";
  /** document.tsx's Assets: ASSETS_BASE's origin and the build's file names. */
  assets: Readonly<{ origin: string; manifest: BuildManifest }>;
  noindex: boolean;
};

export function Head({ title, colorScheme, assets, noindex }: HeadProps) {
  const url = (file: string) => `${assets.origin}/${file}`;
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content={colorScheme} />
      {noindex ? <meta name="robots" content="noindex" /> : null}
      <title>{title}</title>
      {/* Fonts are fetched in anonymous CORS mode even from our own origin, and a preload is only reused when its
          mode matches, hence crossorigin (MDN rel="preload", "CORS-enabled fetches", read 2026-10-17). */}
      {assets.manifest.fonts.map((file) => (
        <link key={file} rel="preload" as="font" type="font/woff2" crossOrigin="" href={url(file)} />
      ))}
      {assets.manifest.styles.map((file) => (
        <link key={file} rel="stylesheet" href={url(file)} />
      ))}
    </head>
  );
}
