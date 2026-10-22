// Dev-only demo of the PDS pages. It does not call a PDS or change native authentication.
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Switch } from "../../shared/ui/index.ts";
import {
  AccountActions,
  AccountDialog,
  AccountFacts,
  AccountForm,
  AccountPage,
  AccountRows,
  AccountShell,
  AuthPanel,
  Button,
  DeviceRow,
  Devices,
  Input,
  type SafeHref,
  safeHref,
} from "../../apps/pds/index.ts";

type Page =
  | "home"
  | "settings"
  | "devices"
  | "apps"
  | "about"
  | "sign-in"
  | "sign-up"
  | "recover"
  | "two-factor"
  | "consent";
type Dialog = "email" | "password" | "handle" | "two-factor" | "deactivate" | "delete";
type Account = { name: string; handle: string; email: string; did: string; twoFactor: boolean; status: string };
type Device = { id: string; name: string; seen: string; ip: string; current: boolean };
type Grant = { id: string; name: string; permissions: string };

const PASSWORD = "correct-horse";
const PAGES: Record<Page, string> = {
  home: "/",
  settings: "/settings",
  devices: "/devices",
  apps: "/apps",
  about: "/about",
  "sign-in": "/sign-in",
  "sign-up": "/sign-up",
  recover: "/recover",
  "two-factor": "/two-factor",
  consent: "/consent",
};

function path(value: string): SafeHref {
  const href = safeHref(value, ["path"]);
  if (href === null) throw new Error("preview path");
  return href;
}

function pageFromPath(value: string): Page {
  const name = value.replace(/\/+$/, "") || "/";
  const match = (Object.entries(PAGES) as [Page, string][]).find(([, href]) => href === name);
  return match?.[0] ?? "home";
}

function field(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value.trim() : "";
}

function Preview() {
  const [page, setPage] = useState<Page>(() => pageFromPath(location.pathname));
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [account, setAccount] = useState<Account>({
    name: "Alice",
    handle: "alice.unset.im",
    email: "alice@example.com",
    did: "did:example:preview",
    twoFactor: false,
    status: "Active",
  });
  const [password, setPassword] = useState(PASSWORD);
  const [devices, setDevices] = useState<Device[]>([
    { id: "this", name: "This computer", seen: "Now", ip: "192.0.2.10", current: true },
    { id: "phone", name: "Phone", seen: "Yesterday", ip: "192.0.2.24", current: false },
  ]);
  const [filter, setFilter] = useState("");
  const [grants, setGrants] = useState<Grant[]>([
    { id: "unset", name: "unset.sh", permissions: "Profile and repository" },
    { id: "notes", name: "Notes", permissions: "Read profile" },
  ]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoverStep, setRecoverStep] = useState<"email" | "code">("email");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const onPop = () => setPage(pageFromPath(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(next: Page) {
    const href = PAGES[next];
    if (location.pathname !== href) history.pushState(null, "", href);
    setPage(next);
    setError("");
    setDialog(null);
  }

  function open(next: Dialog) {
    setError("");
    setDialog(next);
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = field(event.currentTarget, "email");
    if (!email.includes("@")) {
      setError("Enter an email address.");
      return;
    }
    setAccount({ ...account, email });
    setDialog(null);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = field(event.currentTarget, "current");
    const next = field(event.currentTarget, "next");
    const again = field(event.currentTarget, "again");
    if (current !== password) {
      setError("Current password is wrong.");
      return;
    }
    if (next.length < 8 || next !== again) {
      setError("Enter the new password twice, at least 8 characters.");
      return;
    }
    setPassword(next);
    setDialog(null);
    setNotice("Password updated.");
  }

  function submitHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = field(event.currentTarget, "handle");
    if (handle.length < 3 || handle.includes(" ")) {
      setError("Enter a handle without spaces.");
      return;
    }
    setAccount({ ...account, handle });
    setDialog(null);
  }

  function submitFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (account.twoFactor) {
      setAccount({ ...account, twoFactor: false });
      setDialog(null);
      return;
    }
    if (!/^\d{6}$/.test(field(event.currentTarget, "code"))) {
      setError("Enter the 6-digit email code.");
      return;
    }
    setAccount({ ...account, twoFactor: true });
    setDialog(null);
  }

  function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (field(event.currentTarget, "confirm") !== account.handle) {
      setError("Type the handle to confirm deletion.");
      return;
    }
    setAccount({ ...account, status: "Deleted" });
    setDialog(null);
    setNotice("This demo account is marked deleted. Nothing was removed from a server.");
  }

  const shown = devices.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const link = (next: Page, label: string) => (
    <a
      href={PAGES[next]}
      onClick={(event) => {
        event.preventDefault();
        go(next);
      }}
    >
      {label}
    </a>
  );

  let body: ReactNode;
  switch (page) {
    case "home":
      body = (
        <AccountPage eyebrow="Account" title={account.name} description={`Signed in as ${account.handle}`}>
          <AccountFacts
            facts={[
              { label: "Handle", value: account.handle },
              { label: "Email", value: account.email },
              { label: "DID", value: account.did },
              { label: "Status", value: account.status },
            ]}
          />
          {notice === "" ? null : <p>{notice}</p>}
        </AccountPage>
      );
      break;
    case "settings":
      body = (
        <AccountPage
          eyebrow="Account"
          title="Settings"
          description="Email, password, handle, email two-factor and account status."
        >
          <AccountRows
            rows={[
              { label: "Email", value: account.email, action: <Button variant="standalone" onClick={() => open("email")}>Change</Button> },
              { label: "Password", value: "Hidden", action: <Button variant="standalone" onClick={() => open("password")}>Change</Button> },
              {
                label: "Handle",
                value: account.handle,
                action: <Button variant="standalone" onClick={() => open("handle")}>Change</Button>,
              },
              {
                label: "Email two-factor",
                value: null,
                action: (
                  <Switch
                    label={<span className="visually-hidden">Email two-factor</span>}
                    checked={account.twoFactor}
                    onChange={(event) => {
                      if (event.currentTarget.checked) open("two-factor");
                      else setAccount({ ...account, twoFactor: false });
                    }}
                  />
                ),
              },
              {
                label: "Account",
                value: account.status,
                action:
                  account.status === "Active" ? (
                    <Button variant="standalone" onClick={() => open("deactivate")}>Deactivate</Button>
                  ) : (
                    <Button variant="standalone" onClick={() => setAccount({ ...account, status: "Active" })}>
                      Reactivate
                    </Button>
                  ),
              },
            ]}
          />
          <AccountActions>
            <Button variant="standalone" onClick={() => open("delete")}>Delete account</Button>
          </AccountActions>
          {notice === "" ? null : <p>{notice}</p>}
        </AccountPage>
      );
      break;
    case "devices":
      body = (
        <Devices
          eyebrow="Account / Devices"
          title="Devices"
          description="Sessions on this account. Ending another session signs that device out."
          filter={
            <Input
              label="Filter devices"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          }
          deviceLabel="Device"
          lastSeenLabel="Last seen"
          actionsLabel="Actions"
        >
          {shown.length === 0 ? (
            <tr>
              <td>No devices match that filter.</td>
            </tr>
          ) : (
            shown.map((item) => (
              <DeviceRow
                key={item.id}
                name={item.name}
                status={item.current ? "This device" : "Signed in"}
                lastSeenLabel="Last seen"
                lastSeen={item.seen}
                ipAddressLabel="IP address"
                ipAddress={item.ip}
                action={
                  <Button
                    variant="standalone"
                    disabled={item.current}
                    onClick={() => setDevices(devices.filter((row) => row.id !== item.id))}
                  >
                    {item.current ? "This device" : "End session"}
                  </Button>
                }
              />
            ))
          )}
        </Devices>
      );
      break;
    case "apps":
      body = (
        <AccountPage eyebrow="Account" title="Connected apps" description="Apps that can act for this account.">
          {grants.length === 0 ? (
            <p>No connected apps.</p>
          ) : (
            <AccountRows
              rows={grants.map((grant) => ({
                label: grant.name,
                value: grant.permissions,
                action: <Button variant="standalone" onClick={() => setGrants(grants.filter((row) => row.id !== grant.id))}>
                    Revoke
                  </Button>,
              }))}
            />
          )}
        </AccountPage>
      );
      break;
    case "about":
      body = (
        <AccountPage eyebrow="Account" title="About" description="Information this account server stores.">
          <AccountFacts
            facts={[
              { label: "Name", value: account.name },
              { label: "Handle", value: account.handle },
              { label: "Email", value: account.email },
              { label: "DID", value: account.did },
              { label: "Server", value: "unset.ac" },
              { label: "Status", value: account.status },
            ]}
          />
        </AccountPage>
      );
      break;
    case "sign-in":
    case "sign-up":
    case "recover":
    case "two-factor":
    case "consent":
      body = null;
      break;
    default: {
      const unreachable: never = page;
      throw new Error(`unknown page ${String(unreachable)}`);
    }
  }

  const dialogBody = (() => {
    switch (dialog) {
      case null:
        return null;
      case "email":
        return (
          <form onSubmit={submitEmail}>
            <AccountForm>
              <Input name="email" type="email" label="Email" defaultValue={account.email} autoComplete="email" />
              {error === "" ? null : <p role="alert">{error}</p>}
              <AccountActions>
                <Button type="submit">Save</Button>
                <Button variant="standalone" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
              </AccountActions>
            </AccountForm>
          </form>
        );
      case "password":
        return (
          <form onSubmit={submitPassword}>
            <AccountForm>
              <Input name="current" type="password" label="Current password" autoComplete="current-password" />
              <Input name="next" type="password" label="New password" autoComplete="new-password" />
              <Input name="again" type="password" label="Repeat new password" autoComplete="new-password" />
              {error === "" ? null : <p role="alert">{error}</p>}
              <AccountActions>
                <Button type="submit">Save</Button>
                <Button variant="standalone" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
              </AccountActions>
            </AccountForm>
          </form>
        );
      case "handle":
        return (
          <form onSubmit={submitHandle}>
            <AccountForm>
              <Input name="handle" label="Handle" defaultValue={account.handle} autoComplete="username" />
              {error === "" ? null : <p role="alert">{error}</p>}
              <AccountActions>
                <Button type="submit">Save</Button>
                <Button variant="standalone" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
              </AccountActions>
            </AccountForm>
          </form>
        );
      case "two-factor":
        return (
          <form onSubmit={submitFactor}>
            <AccountForm>
              <p>{account.twoFactor ? "Turn off email codes for sign-in." : "Enter a 6-digit code from your email."}</p>
              {account.twoFactor ? null : (
                <Input name="code" label="Email code" inputMode="numeric" autoComplete="one-time-code" />
              )}
              {error === "" ? null : <p role="alert">{error}</p>}
              <AccountActions>
                <Button type="submit">{account.twoFactor ? "Turn off" : "Turn on"}</Button>
                <Button variant="standalone" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
              </AccountActions>
            </AccountForm>
          </form>
        );
      case "deactivate":
        return (
          <AccountForm>
            <p>Deactivating keeps the account and blocks new sign-in until you reactivate it.</p>
            <AccountActions>
              <Button
                onClick={() => {
                  setAccount({ ...account, status: "Deactivated" });
                  setDialog(null);
                }}
              >
                Deactivate
              </Button>
              <Button variant="standalone" onClick={() => setDialog(null)}>
                Cancel
              </Button>
            </AccountActions>
          </AccountForm>
        );
      case "delete":
        return (
          <form onSubmit={submitDelete}>
            <AccountForm>
              <p>Type {account.handle} to confirm. This preview does not delete a real account.</p>
              <Input name="confirm" label="Handle" autoComplete="off" />
              {error === "" ? null : <p role="alert">{error}</p>}
              <AccountActions>
                <Button type="submit">Delete</Button>
                <Button variant="standalone" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
              </AccountActions>
            </AccountForm>
          </form>
        );
      default: {
        const unreachable: never = dialog;
        throw new Error(`unknown dialog ${String(unreachable)}`);
      }
    }
  })();

  if (page === "sign-in" || page === "sign-up" || page === "recover" || page === "two-factor" || page === "consent") {
    const auth = (title: string, description: string, form: ReactNode, links: ReactNode) => (
      <AuthPanel
        homeHref={path("/")}
        homeLabel="Account home"
        title={title}
        description={description}
        {...(error === "" ? {} : { error })}
        links={links}
      >
        {form}
      </AuthPanel>
    );
    let screen: ReactNode;
    switch (page) {
      case "sign-in":
        screen = auth(
          "Sign in",
          `Demo password: ${PASSWORD}`,
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const entered = field(event.currentTarget, "password");
              if (field(event.currentTarget, "username") === "" || entered !== password) {
                setError("That username or password is wrong.");
                return;
              }
              go(account.twoFactor ? "two-factor" : "consent");
            }}
          >
            <Input name="username" label="Username" defaultValue={account.email} autoComplete="username" />
            <Input name="password" type="password" label="Password" autoComplete="current-password" />
            <Button type="submit">Sign in</Button>
          </form>,
          <>
            {link("sign-up", "Create account")}
            {link("recover", "Forgot password")}
            {link("two-factor", "Email code")}
            {link("consent", "Consent")}
          </>,
        );
        break;
      case "sign-up":
        screen = auth(
          "Create account",
          "Choose a handle, email and password. An invite is optional in this preview.",
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const handle = field(event.currentTarget, "handle");
              const email = field(event.currentTarget, "email");
              const next = field(event.currentTarget, "password");
              if (handle.length < 3 || !email.includes("@") || next.length < 8) {
                setError("Enter a handle, an email and a password of at least 8 characters.");
                return;
              }
              setAccount({ ...account, name: handle, handle, email, status: "Active" });
              setPassword(next);
              go("home");
            }}
          >
            <Input name="handle" label="Handle" autoComplete="username" />
            <Input name="email" type="email" label="Email" autoComplete="email" />
            <Input name="password" type="password" label="Password" autoComplete="new-password" />
            <Input name="invite" label="Invite code" hint="Optional in this preview" />
            <Button type="submit">Create account</Button>
          </form>,
          link("sign-in", "Sign in"),
        );
        break;
      case "recover":
        screen = auth(
          "Reset password",
          recoverStep === "email" ? "We will show the code here instead of sending mail." : "Enter the 6-digit code.",
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (recoverStep === "email") {
                if (!field(event.currentTarget, "email").includes("@")) {
                  setError("Enter an email address.");
                  return;
                }
                setRecoverStep("code");
                setNotice("Code 000000");
                setError("");
                return;
              }
              const next = field(event.currentTarget, "password");
              if (field(event.currentTarget, "code") !== "000000" || next.length < 8) {
                setError("Use code 000000 and a new password of at least 8 characters.");
                return;
              }
              setPassword(next);
              setRecoverStep("email");
              setNotice("Password updated.");
              go("sign-in");
            }}
          >
            {recoverStep === "email" ? (
              <Input name="email" type="email" label="Email" defaultValue={account.email} autoComplete="email" />
            ) : (
              <>
                <Input name="code" label="Email code" defaultValue="000000" inputMode="numeric" />
                <Input name="password" type="password" label="New password" autoComplete="new-password" />
              </>
            )}
            <Button type="submit">{recoverStep === "email" ? "Send code" : "Update password"}</Button>
          </form>,
          link("sign-in", "Back to sign in"),
        );
        break;
      case "two-factor":
        screen = auth(
          "Email code",
          "Enter the 6-digit code. This preview accepts 000000.",
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (field(event.currentTarget, "code") !== "000000") {
                setError("That code is wrong or expired.");
                return;
              }
              go("consent");
            }}
          >
            <Input
              name="code"
              label="Email code"
              defaultValue="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <Button type="submit">Continue</Button>
          </form>,
          link("sign-in", "Back to sign in"),
        );
        break;
      case "consent":
        screen = auth(
          "Authorize unset.sh",
          "This app is asking to use your account.",
          <>
            <AccountFacts
              facts={[
                { label: "App", value: "unset.sh" },
                { label: "Account", value: account.handle },
                { label: "Access", value: "Profile and repository" },
              ]}
            />
            <AccountActions>
              <Button onClick={() => go("home")}>Accept</Button>
              <Button variant="standalone" onClick={() => setError("Access was denied. The app stays signed out.")}>
                Deny
              </Button>
            </AccountActions>
          </>,
          link("sign-in", "Back to sign in"),
        );
        break;
      default: {
        const unreachable: never = page;
        throw new Error(`unknown auth page ${String(unreachable)}`);
      }
    }
    return screen;
  }

  return (
    <AccountShell
      navigation={{
        account: { href: path("/"), label: account.name, name: account.name, current: page === "home" },
        primary: { href: path("/settings"), label: "Settings", icon: "settings", current: page === "settings" },
        items: [
          { href: path("/devices"), label: "Devices", icon: "devices", current: page === "devices" },
          { href: path("/apps"), label: "Apps", icon: "apps", current: page === "apps" },
          { href: path("/about"), label: "About", icon: "info", current: page === "about" },
        ],
        menuLabel: "Menu",
        itemsPlacement: "start",
        navigationKey: page,
        extra: (
          <Switch
            label="Theme"
            checked={theme === "light"}
            onChange={(event) => setTheme(event.currentTarget.checked ? "light" : "dark")}
          />
        ),
        renderLink: (props) => (
          <a
            {...props}
            href={props.href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              const next = pageFromPath(props.href);
              go(next);
            }}
          />
        ),
      }}
      homeLabel="Account home"
      skipLabel="Skip to content"
      nativeActions={
        <AccountActions>
          <Button variant="standalone" onClick={() => go("sign-in")}>
            Sign out
          </Button>
        </AccountActions>
      }
    >
      {body}
      {dialog === null ? null : (
        <AccountDialog
          open
          title={
            dialog === "email"
              ? "Change email"
              : dialog === "password"
                ? "Change password"
                : dialog === "handle"
                  ? "Change handle"
                  : dialog === "two-factor"
                    ? "Email two-factor"
                    : dialog === "deactivate"
                      ? "Deactivate account"
                      : "Delete account"
          }
          onClose={() => setDialog(null)}
        >
          {dialogBody}
        </AccountDialog>
      )}
    </AccountShell>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
