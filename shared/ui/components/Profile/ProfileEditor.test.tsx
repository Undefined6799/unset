// @vitest-environment jsdom
// The owner's profile editing (Alex 2026-10-23; Figma page Profile, v4 and v5): no pencils or draft box before the
// island runs; then a pencil or a double-click edits a field in place, each change goes on a draft with undo and redo,
// and Save posts the plain form to POST /profile.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isProfileEditorProps, ProfileEditor, type ProfileEditorProps } from "./ProfileEditor.tsx";
import type { ProfileLabels } from "./ProfileView.tsx";

const labels: ProfileLabels = {
  handleUnavailable: "We could not check your handle just now.",
  verified: "Verified",
  details: { location: "Location", website: "Website", did: "DID" },
  copyLink: "Copy link",
  copied: "Copied",
  copyFailed: "Copy failed",
  removeLink: "Remove {link}",
  invalidLink: "Enter a web address, like github.com/you.",
  fields: {
    displayName: "display name",
    headline: "headline",
    location: "place",
    website: "website",
    readme: "README",
    links: "links",
  },
  add: {
    displayName: "Display name",
    headline: "Add a headline",
    location: "Add a place",
    website: "Add a website",
    readme: "Write your README.",
    links: "Add a link",
  },
  edit: "Edit {field}",
  draft: "Draft",
  draftBody: "Your changes are not published yet.",
  revert: "Revert to the published profile",
  undo: "Undo",
  redo: "Redo",
  undoKeys: "Ctrl+Z",
  redoKeys: "Ctrl+Shift+Z",
  viewAs: "View as a visitor",
  publish: "Save",
  saving: "Saving…",
  saved: "Saved to your profile.",
  failed: {
    conflict: "Your profile changed somewhere else since you opened it.",
    invalid: "Part of your profile could not be saved.",
    unavailable: "Your sign-in server is not answering.",
    other: "Your profile could not be saved.",
  },
};
const props: ProfileEditorProps = {
  did: "did:plc:7f3kabcdefghijklmtdc9e",
  handle: "alice.pds.example",
  verified: true,
  handleUnavailable: false,
  fields: {
    displayName: "Alice",
    headline: "Designer.",
    location: "",
    website: "",
    readme: "## About me\nhi",
    links: "https://github.com/alicem",
  },
  labels,
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileEditor without script", () => {
  it("is the plain profile: no pencil and no draft box", () => {
    const html = renderToStaticMarkup(<ProfileEditor {...props} />);
    expect(html).toContain(">Alice</h1>");
    expect(html).toContain(">About me</h2>");
    expect(html).not.toContain("Edit display name");
    expect(html).not.toContain("Draft");
    expect(html).not.toContain("Copy link");
  });

  it("shows the handle, its tag and the short DID, none of them editable", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<ProfileEditor {...props} />));
    expect(host.textContent).toContain("@alice.pds.example");
    expect(host.textContent).toContain("Verified");
    expect(host.querySelector('[title="did:plc:7f3kabcdefghijklmtdc9e"]')?.textContent).toBe("did:plc:7f3k…tdc9e");
    const pencils = [...host.querySelectorAll("button[aria-label^='Edit']")].map((b) => b.getAttribute("aria-label"));
    expect(pencils).toEqual(["Edit display name", "Edit headline", "Edit place", "Edit website", "Edit README"]);
    expect(host.querySelector("button[aria-label='Add a link']")).not.toBeNull();
    host.remove();
  });

  it("leaves the tag out when the handle is not verified", () => {
    const html = renderToStaticMarkup(<ProfileEditor {...props} verified={false} />);
    expect(html).not.toContain("Verified");
  });

  it("accepts only its own props shape", () => {
    expect(isProfileEditorProps(props)).toBe(true);
    expect(isProfileEditorProps({ ...props, fields: { ...props.fields, readme: 1 } })).toBe(false);
    expect(isProfileEditorProps({ ...props, handleUnavailable: "no" })).toBe(false);
    expect(isProfileEditorProps({ ...props, verified: "yes" })).toBe(false);
    expect(isProfileEditorProps({ ...props, did: undefined })).toBe(false);
    expect(isProfileEditorProps({ ...props, labels: { ...props.labels, failed: {} } })).toBe(false);
  });
});

describe("ProfileEditor with script", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function mount(value: ProfileEditorProps = props) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ProfileEditor {...value} />));
    const button = (label: string) =>
      host.querySelector(`button[aria-label="${label}"], button[data-tip^="${label}"]`) as HTMLButtonElement | null;
    const buttonText = (text: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
    /** Closes the open field editor the way a reader leaves it: focus moves elsewhere. */
    const commit = () =>
      act(async () => {
        const field = host.querySelector("input, textarea") as HTMLElement | null;
        if (field === null) throw new Error("no field editor is open");
        field.blur();
      });
    return { host, button, buttonText, commit };
  }

  /** Types into a React-controlled field the way a browser does: set the value, then fire input. */
  function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const key = (target: EventTarget, init: KeyboardEventInit) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });

  it("edits a field in place and puts the change on a draft", async () => {
    const { host, button, commit } = await mount();
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
    await act(async () => button("Edit headline")?.click());
    const input = host.querySelector("input[aria-label='Edit headline']") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.parentElement?.querySelector("button")).toBeNull();
    // What is typed goes on the draft at once: no Save in the field (Alex 2026-10-23 03:58Z).
    await act(async () => type(input, "  Designer and developer.  "));
    expect(host.querySelector("section[aria-label='Draft']")).not.toBeNull();
    await commit();
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Designer and developer.");
    expect(host.textContent).not.toContain("  Designer and developer.  ");
  });

  it("keeps one undo step per field edit, however many keys were typed", async () => {
    const { host, button, commit } = await mount();
    await act(async () => button("Edit headline")?.click());
    const input = host.querySelector("input") as HTMLInputElement;
    for (const value of ["D", "De", "Dev"]) await act(async () => type(input, value));
    await commit();
    await act(async () => button("Undo")?.click());
    expect(host.textContent).toContain("Designer.");
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
  });

  it("Escape puts the field back and Enter closes it; double-click opens it too", async () => {
    const { host } = await mount();
    const name = () => host.querySelector("h1 span") as HTMLElement;
    await act(async () => name().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    let input = host.querySelector("input[aria-label='Edit display name']") as HTMLInputElement;
    await act(async () => type(input, "Bob"));
    expect(host.querySelector("section[aria-label='Draft']")).not.toBeNull();
    await key(input, { key: "Escape" });
    expect(host.querySelector("h1")?.textContent).toContain("Alice");
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
    await act(async () => name().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    input = host.querySelector("input[aria-label='Edit display name']") as HTMLInputElement;
    await act(async () => type(input, "Bob"));
    await key(input, { key: "Enter" });
    expect(host.querySelector("h1")?.textContent).toContain("Bob");
  });

  it("undoes, redoes and reverts, by button and by keyboard", async () => {
    const { host, button, commit } = await mount();
    for (const value of ["One", "Two"]) {
      await act(async () => button("Edit headline")?.click());
      await act(async () => type(host.querySelector("input") as HTMLInputElement, value));
      await commit();
    }
    expect(host.textContent).toContain("Two");
    await key(window, { key: "z", ctrlKey: true });
    expect(host.textContent).toContain("One");
    await act(async () => button("Undo")?.click());
    expect(host.textContent).toContain("Designer.");
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
    await key(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(host.textContent).toContain("One");
    await act(async () => button("Redo")?.click());
    expect(host.textContent).toContain("Two");
    await act(async () => button("Revert to the published profile")?.click());
    expect(host.textContent).toContain("Designer.");
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
  });

  it("copies the profile's address", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { buttonText } = await mount();
    await act(async () => buttonText("Copy link")?.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/did:plc:7f3kabcdefghijklmtdc9e`);
    expect(buttonText("Copied")).toBeDefined();
  });

  it("adds a link with + and removes one, each a draft step (Alex 04:06Z)", async () => {
    const { host, button } = await mount();
    expect(host.querySelector('a[href="https://github.com/alicem"]')?.textContent).toBe("github.com/alicem");
    await act(async () => button("Add a link")?.click());
    const input = host.querySelector("input[aria-label='Add a link']") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await act(async () => type(input, "javascript:alert(1)"));
    await key(input, { key: "Enter" });
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Enter a web address, like github.com/you.");
    await act(async () => type(input, "bsky.app/profile/alice"));
    await key(input, { key: "Enter" });
    expect(host.querySelector('a[href="https://bsky.app/profile/alice"]')).not.toBeNull();
    expect(host.querySelector("section[aria-label='Draft']")).not.toBeNull();
    await act(async () => button("Remove https://github.com/alicem")?.click());
    expect(host.querySelector('a[href="https://github.com/alicem"]')).toBeNull();
    await act(async () => button("Undo")?.click());
    await act(async () => button("Undo")?.click());
    expect(host.querySelector('a[href="https://bsky.app/profile/alice"]')).toBeNull();
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
  });

  it("an owner with no display name sees the Display name prompt, never the handle, on top", async () => {
    const { host } = await mount({ ...props, fields: { ...props.fields, displayName: "" } });
    expect(host.querySelector("h1")?.textContent).toBe("Display name");
  });

  it("view as hides the pencils", async () => {
    const { host, button, commit } = await mount();
    await act(async () => button("Edit place")?.click());
    await act(async () => type(host.querySelector("input") as HTMLInputElement, "Toronto"));
    await commit();
    await act(async () => button("View as a visitor")?.click());
    expect(button("Edit headline")).toBeNull();
    expect(button("View as a visitor")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("saves the draft as the plain form and clears the draft", async () => {
    const fetch = vi.fn(
      async () => ({ ok: true, redirected: true, url: window.location.href, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { host, button, buttonText, commit } = await mount({
      ...props,
      fields: { ...props.fields, displayName: "" },
    });
    await act(async () => button("Edit place")?.click());
    await act(async () => type(host.querySelector("input") as HTMLInputElement, "Toronto"));
    await commit();
    const publish = host.querySelector("section[aria-label='Draft'] button[aria-busy]") ?? buttonText("Save");
    await act(async () => (publish as HTMLButtonElement).click());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/profile");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    // No name was ever set, so the handle the page shows is published as the name the lexicon requires.
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      displayName: "alice.pds.example",
      headline: "Designer.",
      location: "Toronto",
      website: "",
      readme: "## About me\nhi",
      links: "https://github.com/alicem",
    });
    expect(host.querySelector("section[aria-label='Draft']")).toBeNull();
    expect(host.textContent).toContain("Saved to your profile.");
  });

  it("keeps the draft and says why when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, redirected: false, url: "", status: 409 }) as Response),
    );
    const { host, button, buttonText, commit } = await mount();
    await act(async () => button("Edit place")?.click());
    await act(async () => type(host.querySelector("input") as HTMLInputElement, "Toronto"));
    await commit();
    await act(async () => buttonText("Save")?.click());
    expect(host.querySelector("section[aria-label='Draft']")?.textContent).toContain("changed somewhere else");
    expect(host.textContent).toContain("Toronto");
  });
});
