// @vitest-environment jsdom
import { Button, Input, type NavigationProps, type SafeHref, safeHref } from "@unset/shared-ui/presentation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountShell, DeviceRow, Devices } from "../index.ts";

const path = (value: string) => safeHref(value, ["path"]) as SafeHref;
const navigation: NavigationProps = {
  account: { href: path("/account/example"), label: "Compte" },
  primary: { href: path("/account/example/manage"), label: "Réglages", icon: "settings" },
  items: [{ href: path("/account/example/devices"), label: "Appareils", icon: "devices", current: true }],
  menuLabel: "Navigation",
};
// Catches different brand/account homes or dropped native slots/skip destination.
describe("PDS presentation", () => {
  it("keeps the selected home and native content reachable through one main landmark", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <AccountShell
          navigation={navigation}
          homeLabel="Accueil du compte"
          skipLabel="Aller au contenu"
          prepend={<aside>Notification native</aside>}
          nativeActions={<button type="button">Langue native</button>}
        >
          <p>Contenu natif</p>
        </AccountShell>,
      ),
      "text/html",
    );
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    const main = doc.querySelector("main");
    expect(main?.id).toBe("main");
    expect(main?.tabIndex).toBe(-1);
    expect(doc.querySelector('a[href="#main"]')?.textContent).toBe("Aller au contenu");
    expect(doc.querySelector("header a")?.getAttribute("href")).toBe("/account/example");
    expect(doc.querySelector("header svg")?.getAttribute("aria-label")).toBe("Accueil du compte");
    expect(main?.textContent).toBe("Notification nativeContenu natifLangue native");
    expect(doc.querySelector("script, [data-island]")).toBeNull();
  });
  // Catches lost translated labels, duplicate action trees or dropped IP metadata.
  it("associates translated device columns with one row and preserves formatted nodes", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <Devices
          eyebrow="PDS / APPAREILS"
          title="Appareils"
          description={<em>Description native</em>}
          filter={<Input label="Filtrer" defaultValue="Portable" />}
          deviceLabel="Appareil"
          lastSeenLabel="Vu"
          actionsLabel="Actions"
        >
          <DeviceRow
            name="Portable"
            status={<strong>Actuel</strong>}
            lastSeenLabel="Vu"
            lastSeen={<time>À l’instant</time>}
            ipAddressLabel="Adresse IP"
            ipAddress="192.0.2.1"
            action={<Button disabled>Actuel</Button>}
          />
        </Devices>,
      ),
      "text/html",
    );
    expect(doc.querySelector("h1")?.textContent).toBe("Appareils");
    expect(doc.querySelector("em")?.textContent).toBe("Description native");
    expect([...doc.querySelectorAll("th")].map((e) => e.textContent)).toEqual(["Appareil", "Vu", "Actions"]);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(doc.querySelectorAll("tbody button")).toHaveLength(1);
    expect(doc.querySelector("tbody button")?.hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector("td time")?.textContent).toBe("À l’instant");
    expect(doc.querySelector("dt")?.textContent).toBe("Adresse IP");
    expect(doc.querySelector("dd")?.textContent).toBe("192.0.2.1");
    expect(doc.querySelector("label")?.textContent).toBe("Filtrer");
  });
  // Catches swallowed caller rendering, filter or action callbacks/pending state.
  it("preserves caller link rendering, controlled filter and action callbacks", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let selections = 0,
      actions = 0,
      query = "";
    const ref = { current: null as HTMLButtonElement | null };
    try {
      await act(async () =>
        root.render(
          <AccountShell
            navigation={{
              ...navigation,
              navigationKey: 7,
              renderLink: (props) => (
                <a
                  {...props}
                  href={props.href}
                  onClick={(event) => {
                    event.preventDefault();
                    selections++;
                  }}
                />
              ),
            }}
            homeLabel="Accueil"
            skipLabel="Contenu"
          >
            <Devices
              eyebrow="PDS"
              title="Appareils"
              description="Description"
              deviceLabel="Appareil"
              lastSeenLabel="Vu"
              actionsLabel="Actions"
              filter={
                <Input
                  label="Filtrer"
                  value=""
                  onChange={(event) => {
                    query = event.currentTarget.value;
                  }}
                />
              }
            >
              <DeviceRow
                name="Portable"
                status="Autre"
                lastSeenLabel="Vu"
                lastSeen="Hier"
                action={
                  <Button ref={ref} onClick={() => actions++} aria-busy="true" title="Action native">
                    Terminer
                  </Button>
                }
              />
            </Devices>
          </AccountShell>,
        ),
      );
      host.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.click();
      ref.current?.click();
      const input = host.querySelector("input");
      if (!input) throw new Error("filter missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "mobile");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(selections).toBe(1);
      expect(actions).toBe(1);
      expect(query).toBe("mobile");
      expect(ref.current?.getAttribute("aria-busy")).toBe("true");
      expect(ref.current?.title).toBe("Action native");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
