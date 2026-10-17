// apps/web's render entry as production runs it (P1.23c; ADR 0015; step book record 2026-10-06-p123c-css-modules-glue.md):
// the server build `vite build --ssr render.tsx` writes dist/server/render.js, plain JavaScript with the CSS Module
// class maps compiled in, so the web server runs no Vite and no TypeScript. This is the one loader. It imports the
// literal specifier `@unset/apps-web/server` (architecture Amendments 2026-10-06 21:05Z and 21:45Z): apps/web's
// package.json maps it to that built file for Node and to render.tsx for its types, so the path is fixed by the
// package manifest, never by config or the environment, and dependency-cruiser and semgrep see a literal. A missing
// or malformed build fails startup. Tests pass the source to compose() instead; Vitest compiles it with the same class
// names (scripts/ui/css-scope.ts).
import type { islandName, renderPage, safeHref, screens } from "@unset/apps-web";

/** What the web server uses from apps/web's render entry. */
export type WebRender = Readonly<{
  renderPage: typeof renderPage;
  islandName: typeof islandName;
  screens: typeof screens;
  /** The kit's link validator; the server cannot import the kit, whose index reaches .tsx files Node refuses. */
  safeHref: typeof safeHref;
}>;

/** Loads the server build's module; tests pass a stub, production uses the default. */
export type WebRenderImporter = () => Promise<Partial<WebRender>>;

const importServerBuild: WebRenderImporter = () => import("@unset/apps-web/server");

/** Every page in `screens`; typed as a record so a page added to apps/web fails typecheck until it is listed here. */
const SCREEN_NAMES: Readonly<Record<keyof WebRender["screens"], true>> = {
  login: true,
  loginContinue: true,
  signedOut: true,
  me: true,
  verifyEmail: true,
  home: true,
  legal: true,
  errorPage: true,
};

function hasEveryScreen(screens: unknown): screens is WebRender["screens"] {
  if (typeof screens !== "object" || screens === null) return false;
  const pages = screens as Record<string, unknown>;
  return Object.keys(SCREEN_NAMES).every((name) => typeof pages[name] === "function");
}

/** Imports the server build; throws when it is missing or lacks the render entry's exports, so startup fails closed. */
export async function loadWebRender(importer: WebRenderImporter = importServerBuild): Promise<WebRender> {
  let module: Partial<WebRender>;
  try {
    module = await importer();
  } catch (cause) {
    throw new Error("web render build: @unset/apps-web/server did not load; run npm run build -w @unset/apps-web", {
      cause,
    });
  }
  if (
    typeof module.renderPage !== "function" ||
    typeof module.islandName !== "function" ||
    !hasEveryScreen(module.screens) ||
    typeof module.safeHref !== "function"
  ) {
    throw new Error(
      "web render build: @unset/apps-web/server does not export renderPage, islandName, screens and safeHref",
    );
  }
  const { renderPage, islandName, screens, safeHref } = module;
  return { renderPage, islandName, screens, safeHref };
}
