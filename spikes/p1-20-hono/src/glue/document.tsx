// The page shell: stylesheet links for every CSS Module, the dev refresh preamble and the bootstrap, all external.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { stylesheetHrefs } from "./css.ts";
import { resetIslandIds } from "./islands.tsx";
import { assetUrl } from "./manifest.ts";

function Document({ children, scripts }: { children: ReactNode; scripts: boolean }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>P1.20 spike</title>
        {stylesheetHrefs().map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {scripts && !import.meta.env.PROD && <script type="module" src="/@refresh-preamble.js" />}
        {scripts && <script type="module" src={assetUrl("src/glue/boot.ts")} />}
      </head>
      <body>{children}</body>
    </html>
  );
}

/** A full HTML page; `scripts: false` renders a zero-JS page (no bootstrap, no preamble). */
export function page(body: ReactNode, scripts = true): string {
  resetIslandIds();
  return `<!doctype html>${renderToString(<Document scripts={scripts}>{body}</Document>)}`;
}
