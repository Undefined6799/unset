// The return page's script (build step 6): run in a bare VM context with stand-ins for the browser APIs it touches, so
// the order is checked: the fragment leaves the address bar before the ticket is sent, the ticket goes only to the
// redeem path as JSON, and a refusal shows a fixed code and navigates nowhere.
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { RETURN_SCRIPT } from "./return-page.ts";

type Call = { kind: string; detail: unknown };

function run(hash: string, answer: { status: number; body: unknown } | "network") {
  const calls: Call[] = [];
  const status = { textContent: "" };
  const location = {
    hash,
    pathname: "/sign-in/return",
    replace: (to: string) => calls.push({ kind: "navigate", detail: to }),
  };
  const window = {
    location,
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        location.hash = "";
        calls.push({ kind: "replaceState", detail: url });
      },
    },
    fetch: (url: string, init: RequestInit) => {
      calls.push({ kind: "fetch", detail: { url, init, hashAtSend: location.hash } });
      if (answer === "network") return Promise.reject(new TypeError("offline"));
      return Promise.resolve({ ok: answer.status < 300, json: () => Promise.resolve(answer.body) });
    },
  };
  const document = { getElementById: (id: string) => (id === "status" ? status : null) };
  runInNewContext(RETURN_SCRIPT, { window, document, URLSearchParams, JSON });
  return { calls, status, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

describe("return page script", () => {
  test("door.return_strips_first: the fragment is gone before the ticket is posted to the redeem path", async () => {
    const page = run("#ticket=abc", { status: 200, body: { returnTo: "/c/x" } });
    await page.settle();
    expect(page.calls.map((c) => c.kind)).toEqual(["replaceState", "fetch", "navigate"]);
    expect(page.calls[0]?.detail).toBe("/sign-in/return");
    const sent = page.calls[1]?.detail as { url: string; init: RequestInit; hashAtSend: string };
    expect(sent.url).toBe("/sign-in/redeem");
    expect(sent.hashAtSend).toBe("");
    expect(sent.init).toMatchObject({ method: "POST", credentials: "same-origin", referrerPolicy: "no-referrer" });
    expect(JSON.parse(String(sent.init.body))).toEqual({ ticket: "abc" });
    expect(page.calls[2]?.detail).toBe("/c/x");
  });

  test("door.return_no_ticket: nothing is sent and a fixed code shows", () => {
    const page = run("", { status: 200, body: {} });
    expect(page.calls.map((c) => c.kind)).toEqual(["replaceState"]);
    expect(page.status.textContent).toContain("chat.no_ticket");
  });

  test("door.return_refused: a refusal shows its code and navigates nowhere", async () => {
    const page = run("#ticket=abc", { status: 403, body: { error: "chat.state_mismatch" } });
    await page.settle();
    expect(page.calls.map((c) => c.kind)).toEqual(["replaceState", "fetch"]);
    expect(page.status.textContent).toContain("chat.state_mismatch");
  });

  test("door.return_offsite: a returnTo that is not a same-origin path is never followed", async () => {
    for (const returnTo of ["//evil.example", "https://evil.example/"]) {
      const page = run("#ticket=abc", { status: 200, body: { returnTo } });
      await page.settle();
      expect(page.calls.some((c) => c.kind === "navigate")).toBe(false);
    }
  });

  test("door.return_offline: a network failure shows chat.unavailable", async () => {
    const page = run("#ticket=abc", "network");
    await page.settle();
    expect(page.status.textContent).toContain("chat.unavailable");
  });
});
