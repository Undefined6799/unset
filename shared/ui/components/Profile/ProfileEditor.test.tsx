// @vitest-environment jsdom
// The owner's profile editing (Alex 2026-10-23; Figma page Profile, v4 and v5): no pencil or draft box before the
// island runs; then a pencil or a double-click edits the README in place (the side column is edited in Settings ›
// Profile), each change goes on a draft with undo and redo, and Save posts the README to POST /profile.
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
    // Only the README is edited on the page; the side column is edited in Settings › Profile (Alex 04:29Z).
    expect(pencils).toEqual(["Edit README"]);
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

  const readme = () => host().querySelector("textarea[aria-label='Edit README']") as HTMLTextAreaElement;
  const host = () => document.body;

  it("edits the README in place and puts the change on a draft", async () => {
    const { button, commit } = await mount();
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
    await act(async () => button("Edit README")?.click());
    expect(document.activeElement).toBe(readme());
    expect(readme().parentElement?.querySelector("button")).toBeNull();
    // What is typed goes on the draft at once: no Save in the field (Alex 2026-10-23 03:58Z).
    await act(async () => type(readme(), "## Hello"));
    expect(host().querySelector("section[aria-label='Draft']")).not.toBeNull();
    await commit();
    expect(host().querySelector("textarea")).toBeNull();
    expect(host().querySelector("h2")?.textContent).toBe("Hello");
  });

  it("keeps one undo step per edit, however many keys were typed", async () => {
    const { button, commit } = await mount();
    await act(async () => button("Edit README")?.click());
    for (const value of ["D", "De", "Dev"]) await act(async () => type(readme(), value));
    await commit();
    await act(async () => button("Undo")?.click());
    expect(host().querySelector("h2")?.textContent).toBe("About me");
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
  });

  it("Escape puts the README back and Ctrl+Enter closes it; double-click opens it too", async () => {
    await mount();
    const block = () => host().querySelector("h2")?.closest("span") as HTMLElement;
    await act(async () => block().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await act(async () => type(readme(), "Bob"));
    await key(readme(), { key: "Escape" });
    expect(host().querySelector("h2")?.textContent).toBe("About me");
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
    await act(async () => block().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await act(async () => type(readme(), "Bob"));
    await key(readme(), { key: "Enter", ctrlKey: true });
    expect(host().querySelector("textarea")).toBeNull();
    expect(host().textContent).toContain("Bob");
  });

  it("undoes, redoes and reverts, by button and by keyboard", async () => {
    const { button, commit } = await mount();
    for (const value of ["One", "Two"]) {
      await act(async () => button("Edit README")?.click());
      await act(async () => type(readme(), value));
      await commit();
    }
    expect(host().textContent).toContain("Two");
    await key(window, { key: "z", ctrlKey: true });
    expect(host().textContent).toContain("One");
    await act(async () => button("Undo")?.click());
    expect(host().querySelector("h2")?.textContent).toBe("About me");
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
    await key(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(host().textContent).toContain("One");
    await act(async () => button("Redo")?.click());
    expect(host().textContent).toContain("Two");
    await act(async () => button("Revert to the published profile")?.click());
    expect(host().querySelector("h2")?.textContent).toBe("About me");
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
  });

  it("copies the profile's address", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { buttonText } = await mount();
    await act(async () => buttonText("Copy link")?.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/did:plc:7f3kabcdefghijklmtdc9e`);
    expect(buttonText("Copied")).toBeDefined();
  });

  it("an owner with no display name sees the Display name prompt, never the handle, on top", async () => {
    const { host } = await mount({ ...props, fields: { ...props.fields, displayName: "" } });
    expect(host.querySelector("h1")?.textContent).toBe("Display name");
  });

  it("view as hides the pencil", async () => {
    const { button, commit } = await mount();
    await act(async () => button("Edit README")?.click());
    await act(async () => type(readme(), "Hi"));
    await commit();
    await act(async () => button("View as a visitor")?.click());
    expect(button("Edit README")).toBeNull();
    expect(button("View as a visitor")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("saves the README alone, so the side column keeps what Settings saved", async () => {
    const fetch = vi.fn(
      async () => ({ ok: true, redirected: true, url: window.location.href, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { button, buttonText, commit } = await mount();
    await act(async () => button("Edit README")?.click());
    await act(async () => type(readme(), "Hi"));
    await commit();
    await act(async () => buttonText("Save")?.click());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/profile");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ readme: "Hi" });
    expect(host().querySelector("section[aria-label='Draft']")).toBeNull();
    expect(host().textContent).toContain("Saved to your profile.");
  });

  it("a first save with no name publishes the handle as the name the lexicon requires", async () => {
    const fetch = vi.fn(
      async () => ({ ok: true, redirected: true, url: window.location.href, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { button, buttonText, commit } = await mount({ ...props, fields: { ...props.fields, displayName: "" } });
    await act(async () => button("Edit README")?.click());
    await act(async () => type(readme(), "Hi"));
    await commit();
    await act(async () => buttonText("Save")?.click());
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      readme: "Hi",
      displayName: "alice.pds.example",
    });
  });

  it("keeps the draft and says why when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, redirected: false, url: "", status: 409 }) as Response),
    );
    const { button, buttonText, commit } = await mount();
    await act(async () => button("Edit README")?.click());
    await act(async () => type(readme(), "Unsaved words"));
    await commit();
    await act(async () => buttonText("Save")?.click());
    expect(host().querySelector("section[aria-label='Draft']")?.textContent).toContain("changed somewhere else");
    expect(host().textContent).toContain("Unsaved words");
  });
});
