// The remaining PDS screens from the accepted screen list. Demo only; no PDS calls.
import type { ReactNode } from "react";
import {
  AccountActions,
  AccountForm,
  AccountPage,
  AuthPanel,
  Button,
  Input,
  type SafeHref,
  safeHref,
} from "../../apps/pds/index.ts";
import { Callout, DescriptionList } from "../../shared/ui/index.ts";

export const REST_PAGES = {
  welcome: "/welcome",
  chooser: "/chooser",
  reauth: "/reauth",
  verify: "/verify",
  "reset-done": "/reset-done",
  captcha: "/captcha",
  error: "/error",
  cookies: "/cookies",
  loading: "/loading",
  pending: "/pending",
  done: "/done",
  handoff: "/handoff",
  screens: "/screens",
} as const;

export type RestPage = keyof typeof REST_PAGES;

export function isRestPage(page: string): page is RestPage {
  return Object.hasOwn(REST_PAGES, page);
}

function href(value: string): SafeHref {
  const link = safeHref(value, ["path"]);
  if (link === null) throw new Error("preview path");
  return link;
}

type Go = (page: string) => void;

function jump(go: Go, path: string, page: string, label: string) {
  return (
    <a
      href={path}
      onClick={(event) => {
        event.preventDefault();
        go(page);
      }}
    >
      {label}
    </a>
  );
}
function panel(title: string, description: string, body: ReactNode, links?: ReactNode) {
  return (
    <AuthPanel homeHref={href("/")} homeLabel="Account home" title={title} description={description} links={links}>
      {body}
    </AuthPanel>
  );
}

export function RestScreen({
  page,
  go,
  handle,
  directory,
}: {
  page: RestPage;
  go: Go;
  handle: string;
  directory: readonly { id: string; href: string; label: string }[];
}) {
  const link = (path: string, pageName: string, label: string) => jump(go, path, pageName, label);

  switch (page) {
    case "welcome":
      return panel(
        "Check your email",
        "We sent a code to finish creating the account. This preview does not send mail.",
        <>
          <Callout tone="success" title="Account started">
            Enter the code on the next screen. The demo code is 000000.
          </Callout>
          <Button onClick={() => go("verify")}>Enter code</Button>
        </>,
        link("/sign-in", "sign-in", "Sign in instead"),
      );
    case "chooser":
      return panel(
        "Choose an account",
        "More than one account is signed in on this device.",
        <AccountForm>
          <Button variant="standalone" onClick={() => go("consent")}>
            {handle}
          </Button>
          <Button variant="standalone" onClick={() => go("sign-in")}>
            Use another account
          </Button>
        </AccountForm>,
      );
    case "reauth":
      return panel(
        "Confirm it is you",
        "Enter the password again before this account change.",
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go("settings");
          }}
        >
          <AccountForm>
            <Input name="password" type="password" label="Password" autoComplete="current-password" />
            <Button type="submit">Continue</Button>
          </AccountForm>
        </form>,
        link("/sign-in", "sign-in", "Sign in"),
      );
    case "verify":
      return panel(
        "Verify your email",
        "Enter the 6-digit code. This preview accepts 000000.",
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go("home");
          }}
        >
          <AccountForm>
            <Input
              name="code"
              label="Email code"
              defaultValue="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <Button type="submit">Verify</Button>
          </AccountForm>
        </form>,
        link("/welcome", "welcome", "Resend code"),
      );
    case "reset-done":
      return panel(
        "Password updated",
        "Sign in with the new password.",
        <>
          <Callout tone="success" title="Saved">
            The previous reset code can no longer be used.
          </Callout>
          <Button onClick={() => go("sign-in")}>Sign in</Button>
        </>,
      );
    case "captcha":
      return panel(
        "Confirm you are human",
        "Shown only when the account server requires it. Invite-only servers skip this.",
        <>
          <Callout tone="note" title="Preview check">
            No puzzle is loaded. Continue as if the check passed.
          </Callout>
          <Button onClick={() => go("welcome")}>Continue</Button>
        </>,
        link("/sign-up", "sign-up", "Back"),
      );
    case "error":
      return panel(
        "Something went wrong",
        "The account server could not finish that request.",
        <>
          <Callout tone="danger" title="Request failed">
            Try again. If it keeps failing, the server may be unavailable.
          </Callout>
          <AccountActions>
            <Button onClick={() => go("sign-in")}>Try again</Button>
            <Button variant="standalone" onClick={() => go("home")}>
              Cancel
            </Button>
          </AccountActions>
        </>,
      );
    case "cookies":
      return panel(
        "Cookies are blocked",
        "Sign-in needs cookies on this site. Allow them, then try again.",
        <>
          <Callout tone="danger" title="Cookies blocked">
            Private browsing or a browser setting is refusing the session cookie.
          </Callout>
          <Button onClick={() => go("sign-in")}>Try again</Button>
        </>,
      );
    case "loading":
      return (
        <AccountPage eyebrow="Account" title="Opening your account" description="Asking the account server.">
          <Callout tone="info" title="Loading">
            Devices, apps and settings appear when the server answers.
          </Callout>
        </AccountPage>
      );
    case "pending":
      return (
        <AccountPage eyebrow="Account" title="Ending the session" description="Waiting for the account server.">
          <Callout tone="info" title="Pending">
            Do not close this page. The other device is being signed out.
          </Callout>
        </AccountPage>
      );
    case "done":
      return (
        <AccountPage eyebrow="Account" title="Session ended" description="That device is signed out.">
          <Callout tone="success" title="Done">
            The other sessions on this account are unchanged.
          </Callout>
          <Button onClick={() => go("devices")}>Back to devices</Button>
        </AccountPage>
      );
    case "handoff":
      return panel(
        "Returning to unset.sh",
        "The app is allowed to use this account. This preview does not leave the account server.",
        <>
          <DescriptionList
            items={[
              { label: "App", value: "unset.sh" },
              { label: "Account", value: handle, mono: true },
              { label: "Next", value: "The app opens the page you asked for" },
            ]}
          />
          <Button onClick={() => go("home")}>Stay on the account</Button>
        </>,
        link("/consent", "consent", "Back to consent"),
      );
    case "screens":
      return panel(
        "Every screen",
        "The account, sign-in, dialog and status screens for the redesign.",
        <ul>
          {directory.map((item) => (
            <li key={item.id}>
              <a
                href={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  go(item.id);
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>,
      );
    default: {
      const unreachable: never = page;
      throw new Error(`unknown screen ${String(unreachable)}`);
    }
  }
}
