// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { safeHref } from "../../safe-href.ts";
import link from "../Link/Link.module.css";
import { Button } from "./Button.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("standalone_button_forwards_native_action_ref_and_announcements", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<HTMLButtonElement>();
  let clicks = 0;
  try {
    await act(async () =>
      root.render(
        <Button
          variant="standalone"
          ref={ref}
          onClick={() => clicks++}
          title="Current device"
          aria-label="Revoke session"
          aria-busy="true"
          name="revoke"
          value="one"
          form="sessions"
        >
          Revoke
        </Button>,
      ),
    );
    expect(ref.current).toBe(host.querySelector("button"));
    expect(ref.current?.classList.contains(link.standalone ?? "")).toBe(true);
    expect(ref.current?.outerHTML).toContain('aria-busy="true"');
    expect(ref.current?.getAttribute("aria-label")).toBe("Revoke session");
    expect(ref.current?.title).toBe("Current device");
    expect(ref.current?.name).toBe("revoke");
    expect(ref.current?.value).toBe("one");
    expect(ref.current?.getAttribute("form")).toBe("sessions");
    await act(async () => ref.current?.click());
    expect(clicks).toBe(1);
    await act(async () =>
      root.render(
        <Button variant="standalone" onClick={() => clicks++} disabled>
          Revoke
        </Button>,
      ),
    );
    host.querySelector("button")?.click();
    expect(clicks).toBe(1);
    expect(ref.current).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("standalone_anchors_preserve_safehref_refusal_and_common_attributes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    for (const disabled of [false, true]) {
      await act(async () =>
        root.render(
          <Button
            as="a"
            variant="standalone"
            href={safeHref("/sessions", ["path"])}
            title="Sessions"
            aria-label="Manage sessions"
            aria-busy={false}
            disabled={disabled}
          >
            Sessions
          </Button>,
        ),
      );
      const element = host.firstElementChild;
      expect(element?.tagName).toBe(disabled ? "BUTTON" : "A");
      expect(element?.getAttribute("href")).toBe(disabled ? null : "/sessions");
      expect(element?.getAttribute("title")).toBe("Sessions");
      expect(element?.getAttribute("aria-label")).toBe("Manage sessions");
      expect(element?.getAttribute("aria-busy")).toBe("false");
    }
    await act(async () =>
      root.render(
        <Button as="a" variant="standalone" href={null}>
          Unsafe
        </Button>,
      ),
    );
    expect(host.querySelector("button")?.disabled).toBe(true);
    expect(host.querySelector("[href]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
