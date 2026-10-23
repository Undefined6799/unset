// The render entry of apps/web (P1.23; ADG §1): the one module interfaces/http imports. The interface passes the
// request's preferences and the parsed build manifest as props; apps/web never reads files or config itself.
import type { IslandDefinition } from "@unset/shared-islands";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { type Assets, Document, type PagePrefs, type ShellOptions } from "./src/document.tsx";
import { ErrorPage, type ErrorPageProps } from "./src/errors/ErrorPage.tsx";
import { type IslandEnv, newIslandRun } from "./src/islands/runtime/island.tsx";
import { byName } from "./src/islands/runtime/registry.ts";
import { Home } from "./src/screens/Home.tsx";
import { Legal, type LegalProps } from "./src/screens/Legal.tsx";
import { Login, type LoginProps } from "./src/screens/Login.tsx";
import { LoginContinue, type LoginContinueProps } from "./src/screens/LoginContinue.tsx";
import { Me, type MeProps } from "./src/screens/Me.tsx";
import { SignedOut, type SignedOutProps } from "./src/screens/SignedOut.tsx";
import { SettingsProfile, type SettingsProfileProps } from "./src/screens/settings/SettingsProfile.tsx";
import { VerifyEmail, type VerifyEmailProps } from "./src/screens/VerifyEmail.tsx";
import { Age } from "./src/screens/welcome/Age.tsx";
import { ChatLater } from "./src/screens/welcome/ChatLater.tsx";
import { Terms, type TermsProps } from "./src/screens/welcome/Terms.tsx";
import { UnderAge, type UnderAgeProps } from "./src/screens/welcome/UnderAge.tsx";

// The one link validator (P1.24h), for the server too: plain Node cannot load the kit's index, which reaches its .tsx
// components, so interfaces/http takes safeHref from this build like the screens (P2.05).
export { safeHref } from "@unset/shared-ui";
export type { Assets, PagePrefs, ShellOptions } from "./src/document.tsx";
export { Island, IslandPropsInvalid, IslandPropsTooLarge, IslandUnknown } from "./src/islands/runtime/island.tsx";
export type { BuildManifest } from "./src/islands/runtime/manifest.ts";
export { islandName } from "./src/islands/runtime/registry.ts";
export type {
  ErrorPageProps,
  LegalProps,
  LoginContinueProps,
  LoginProps,
  MeProps,
  SettingsProfileProps,
  SignedOutProps,
  TermsProps,
  UnderAgeProps,
  VerifyEmailProps,
};

/**
 * The pages the web server renders, each built from the props it passes (P2.05). The server reaches screens only
 * through this object, so production loads them from the server build like the rest of this entry.
 */
export const screens = {
  login: (props: LoginProps): ReactNode => <Login {...props} />,
  loginContinue: (props: LoginContinueProps): ReactNode => <LoginContinue {...props} />,
  signedOut: (props: SignedOutProps): ReactNode => <SignedOut {...props} />,
  me: (props: MeProps): ReactNode => <Me {...props} />,
  verifyEmail: (props: VerifyEmailProps): ReactNode => <VerifyEmail {...props} />,
  welcomeAge: (): ReactNode => <Age />,
  welcomeTerms: (props: TermsProps): ReactNode => <Terms {...props} />,
  welcomeChat: (): ReactNode => <ChatLater />,
  welcomeBlocked: (props: UnderAgeProps): ReactNode => <UnderAge {...props} />,
  settingsProfile: (props: SettingsProfileProps): ReactNode => <SettingsProfile {...props} />,
  home: (): ReactNode => <Home />,
  legal: (props: LegalProps): ReactNode => <Legal {...props} />,
  errorPage: (props: ErrorPageProps): ReactNode => <ErrorPage {...props} />,
};

/** Every island in the repository, found at build time. */
export const ISLANDS: ReadonlyMap<string, IslandDefinition> = byName(
  import.meta.glob<IslandDefinition>(["./src/islands/*.island.tsx", "../../shared/ui/islands/*.island.tsx"], {
    eager: true,
    import: "default",
  }),
);

export type PageInput = Readonly<{
  prefs: PagePrefs;
  assets: Assets;
  env: IslandEnv;
  title: string;
  body: ReactNode;
  /**
   * "off" for a zero-JS page, always a fixed argument of its route and never from the request (P1.25): no bootstrap,
   * no props script, no modulepreload and no island markers. A component that only works with its island is a bug there.
   */
  islands: "on" | "off";
  /** Render inside AppShell; absent for the screens that still render their own <main>. */
  shell?: ShellOptions;
  /** The islands to look names up in; tests pass their own. */
  registry?: ReadonlyMap<string, IslandDefinition>;
}>;

/** The HTML of one page, and the islands production rendered static because their props were too large. */
export function renderPage(input: PageInput): { html: string; tooLarge: readonly string[] } {
  const run = input.islands === "on" ? newIslandRun(input.registry ?? ISLANDS, input.env) : null;
  const body = renderToString(
    <Document
      prefs={input.prefs}
      title={input.title}
      assets={input.assets}
      run={run}
      {...(input.shell === undefined ? {} : { shell: input.shell })}
    >
      {input.body}
    </Document>,
  );
  return { html: `<!doctype html>${body}`, tooLarge: run?.tooLarge ?? [] };
}
