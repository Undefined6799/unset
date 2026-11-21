// P2.10r (ADR 0080): the invite-request page on the built web server. Postgres as `web` (TE-2). The mail provider is
// what a test may not reach (TE-1): a TLS SMTP server on loopback (tests/support/smtp-server.ts) that the child trusts
// through NODE_EXTRA_CA_CERTS, so the real adapter, TLS check and login run. A second server runs with requests off,
// and a third against a mail server that never answers, to show the answer never waits for the mail.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { startTestSmtp, type TestSmtp } from "../../../support/smtp-server.ts";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const OWNER = "owner@unset.example";

let smtp: TestSmtp;
let stalled: TestSmtp;
let unhurried: TestSmtp;
let secrets: string;
let web: RunningWeb;
let closed: RunningWeb;
let slow: RunningWeb;
let stopping: RunningWeb;

beforeAll(async () => {
  buildOnce(provided.port);
  [smtp, stalled, unhurried] = await Promise.all([
    startTestSmtp(),
    startTestSmtp({ stall: true }),
    startTestSmtp({ slowMs: 150 }),
  ]);
  secrets = mkdtempSync(join(tmpdir(), "invite-request-"));
  const file = (name: string, text: string): string => {
    const path = join(secrets, name);
    writeFileSync(path, text, { mode: 0o600 });
    return path;
  };
  const mailTo = (server: TestSmtp, name: string) => ({
    INVITE_REQUESTS: "on",
    INVITE_REQUEST_SMTP_URL_FILE: file(name, `smtps://user:pass@localhost:${server.port}`),
    INVITE_REQUEST_TO_FILE: file("to", OWNER),
    INVITE_REQUEST_FROM: "noreply@unset.example",
    NODE_EXTRA_CA_CERTS: server.certPath,
  });
  [web, closed, slow, stopping] = await Promise.all([
    startWeb(pg, mailTo(smtp, "smtp")),
    startWeb(pg, {}),
    startWeb(pg, mailTo(stalled, "stalled")),
    startWeb(pg, mailTo(unhurried, "unhurried")),
  ]);
}, 120_000);
beforeEach(() => {
  smtp.received.length = 0;
});
afterAll(async () => {
  await Promise.all([web?.stop(), closed?.stop(), slow?.stop(), stopping?.stop()]);
  await Promise.all([smtp?.close(), stalled?.close(), unhurried?.close()]);
  rmSync(secrets, { recursive: true, force: true });
});

/** Waits for `done` (the mail goes after the answer), failing after `ms`. */
async function until(done: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((wake) => setTimeout(wake, 20));
  }
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const ASK = { email: "sam@example.ca", ageAck: "yes", countryAck: "yes", website: "" };

const post = (body: string, options: { server?: RunningWeb; address?: string; origin?: string } = {}) =>
  (options.server ?? web).fetch("/request-invite", {
    method: "POST",
    body,
    headers: {
      "x-forwarded-for": options.address ?? clientAddress(),
      origin: options.origin ?? ORIGIN,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
    },
  });
const get = (path: string, server = web) => server.fetch(path, { headers: { "x-forwarded-for": clientAddress() } });

describe("the invite-request page", () => {
  test("invite_request.renders: one email field and the ticks, no script, never indexed", async () => {
    const response = await get("/request-invite");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    expect(html).toContain('name="email"');
    expect(html).toContain('name="ageAck"');
    expect(html).not.toContain("<script");
    // The core shell with the app's navigation, not the older site header (staging test 2026-11-21, u7).
    expect(html).toMatch(/<section[^>]*id="core-menu"[^>]*popover="auto"/);
  });

  test("invite_request.first_ask: the owner gets one mail naming the address, with it as Reply-To", async () => {
    const response = await post(form(ASK));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/request-invite?sent=1");
    await until(() => smtp.received.length === 1);
    const [mail] = smtp.received;
    expect(mail?.to).toBe(`<${OWNER}>`);
    expect(mail?.data).toMatch(/^Reply-To: sam@example\.ca$/m);
    expect(mail?.data).toContain("Their email address: sam@example.ca");
    expect(await (await get("/request-invite?sent=1")).text()).toContain("your request is in");
  });

  test("invite_request.repeat: the same address again reads the same and mails nothing", async () => {
    await post(form({ ...ASK, email: "kim@example.ca" }));
    await until(() => smtp.received.length === 1);
    const again = await post(form({ ...ASK, email: "KIM@Example.CA" }));
    expect(again.headers.get("location")).toBe("/request-invite?sent=1");
    await new Promise((wake) => setTimeout(wake, 300));
    expect(smtp.received).toHaveLength(1);
  });

  test("invite_request.same_answer_time: a first ask answers as fast as a repeat, never waiting for the mail", async () => {
    // The mail server here accepts and never greets, so a send waits out its whole deadline. Were the answer to wait
    // for it, a first ask would take seconds and a repeat none, which tells anyone timing it that the address asked
    // before (ADR 0080 point 4). Each answer must come well inside the 8 s mail timeouts.
    const timed = async (fields: Record<string, string>) => {
      const started = performance.now();
      const response = await post(form(fields), { server: slow });
      return { location: response.headers.get("location"), ms: performance.now() - started };
    };
    const first = await timed({ ...ASK, email: "ana@example.ca" });
    const repeat = await timed({ ...ASK, email: "ana@example.ca" });
    const trap = await timed({ ...ASK, email: "bot2@example.ca", website: "x" });
    for (const answer of [first, repeat, trap]) {
      expect(answer.location).toBe("/request-invite?sent=1");
      expect(answer.ms).toBeLessThan(1000);
    }
  });

  test("invite_request.never_logged: no log line names an address or the owner", async () => {
    await post(form({ ...ASK, email: "lee@example.ca" }));
    await until(() => smtp.received.length === 1);
    const logs = JSON.stringify(web.logs());
    expect(logs).not.toContain("lee@example.ca");
    expect(logs).not.toContain(OWNER);
    expect(web.logs().some((line) => line.event === "invite.request_received" && line.kind === "first")).toBe(true);
  });

  test.each([
    ["invite.request_bad_email", { ...ASK, email: "sam@example.ca\r\nBcc: x@example.ca" }],
    ["invite.request_bad_email", { ...ASK, email: "" }],
    ["invite.request_age_required", { ...ASK, ageAck: "" }],
    ["invite.request_country_required", { ...ASK, countryAck: "" }],
  ])("%s: refused before any mail", async (code, fields) => {
    const response = await post(form(fields));
    expect(response.headers.get("location")).toBe(`/request-invite?error=${code}`);
    expect(smtp.received).toHaveLength(0);
  });

  test("invite_request.trap: a filled hidden field reads as sent and mails nothing", async () => {
    const response = await post(form({ ...ASK, email: "bot@example.ca", website: "http://spam.example" }));
    expect(response.headers.get("location")).toBe("/request-invite?sent=1");
    expect(smtp.received).toHaveLength(0);
  });

  test("invite_request.cross_site: a POST from another site is refused and mails nothing", async () => {
    const response = await post(form({ ...ASK, email: "x@example.ca" }), { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(smtp.received).toHaveLength(0);
  });

  test("invite_request.address_limit: a fourth request from one address within the hour is refused", async () => {
    const address = clientAddress();
    for (const n of [1, 2, 3]) {
      expect((await post(form({ ...ASK, email: `n${n}@example.ca` }), { address })).status).toBe(303);
    }
    expect((await post(form({ ...ASK, email: "n4@example.ca" }), { address })).status).toBe(429);
    const mailed = (who: string) => smtp.received.some((mail) => mail.data.includes(`Reply-To: ${who}`));
    await until(() => ["n1@example.ca", "n2@example.ca", "n3@example.ca"].every(mailed));
    await new Promise((wake) => setTimeout(wake, 300));
    expect(mailed("n4@example.ca")).toBe(false);
  });

  test("invite_request.closed: with requests off there is no form, and a POST sends nothing", async () => {
    const html = await (await get("/request-invite", closed)).text();
    expect(html).toContain("unset is invite only, and invite requests are closed for now.");
    expect(html).not.toContain("Leave your email address"); // one sentence, not an ask and then a refusal
    expect(html).not.toContain('name="email"');
    const response = await post(form(ASK), { server: closed });
    expect(response.headers.get("location")).toBe("/request-invite");
    expect(smtp.received).toHaveLength(0);
  });

  test("invite_request.links: the sign-in page and a bare join page lead here", async () => {
    expect(await (await get("/login")).text()).toContain('href="/request-invite"');
    expect(await (await get("/join")).text()).toContain('href="/request-invite"');
  });

  test("invite_request.shutdown_waits: a mail still under way when web is stopped is sent before it exits", async () => {
    // This mail server answers each command 150 ms late, so the send takes about a second; web is told to stop as
    // soon as the visitor has their answer, and the mail must still arrive.
    const response = await post(form({ ...ASK, email: "sol@example.ca" }), { server: stopping });
    expect(response.headers.get("location")).toBe("/request-invite?sent=1");
    expect(unhurried.received).toHaveLength(0);
    await stopping.stop();
    expect(unhurried.received).toHaveLength(1);
  });

  // Last: it stops the mail server.
  test("invite_request.mail_fails: the visitor reads the same, the failure is logged, and the address may ask again", async () => {
    await smtp.close();
    const failures = () => web.logs().filter((line) => line.event === "invite.request_mail_failed").length;
    const first = await post(form({ ...ASK, email: "pat@example.ca" }));
    expect(first.headers.get("location")).toBe("/request-invite?sent=1");
    await until(() => failures() === 1);
    // Forgotten after the failure, so the same address is a first ask again and its mail is tried again.
    await post(form({ ...ASK, email: "pat@example.ca" }));
    await until(() => failures() === 2);
  });
});
