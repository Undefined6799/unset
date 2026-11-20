// P2.10r (ADR 0080): the invite-request page on the built web server. Postgres as `web` (TE-2). The mail provider is
// what a test may not reach (TE-1): a TLS SMTP server on loopback (tests/support/smtp-server.ts) that the child trusts
// through NODE_EXTRA_CA_CERTS, so the real adapter, TLS check and login run. A second server runs with requests off.
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
let secrets: string;
let web: RunningWeb;
let closed: RunningWeb;

beforeAll(async () => {
  buildOnce(provided.port);
  smtp = await startTestSmtp();
  secrets = mkdtempSync(join(tmpdir(), "invite-request-"));
  const file = (name: string, text: string): string => {
    const path = join(secrets, name);
    writeFileSync(path, text, { mode: 0o600 });
    return path;
  };
  [web, closed] = await Promise.all([
    startWeb(pg, {
      INVITE_REQUESTS: "on",
      INVITE_REQUEST_SMTP_URL_FILE: file("smtp", `smtps://user:pass@localhost:${smtp.port}`),
      INVITE_REQUEST_TO_FILE: file("to", OWNER),
      INVITE_REQUEST_FROM: "noreply@unset.example",
      NODE_EXTRA_CA_CERTS: smtp.certPath,
    }),
    startWeb(pg, {}),
  ]);
}, 120_000);
beforeEach(() => {
  smtp.received.length = 0;
});
afterAll(async () => {
  await Promise.all([web?.stop(), closed?.stop()]);
  await smtp?.close();
  rmSync(secrets, { recursive: true, force: true });
});

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
  });

  test("invite_request.first_ask: the owner gets one mail naming the address, with it as Reply-To", async () => {
    const response = await post(form(ASK));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/request-invite?sent=1");
    expect(smtp.received).toHaveLength(1);
    const [mail] = smtp.received;
    expect(mail?.to).toBe(`<${OWNER}>`);
    expect(mail?.data).toMatch(/^Reply-To: sam@example\.ca$/m);
    expect(mail?.data).toContain("Their email address: sam@example.ca");
    expect(await (await get("/request-invite?sent=1")).text()).toContain("your request is in");
  });

  test("invite_request.repeat: the same address again reads the same and mails nothing", async () => {
    await post(form({ ...ASK, email: "kim@example.ca" }));
    const again = await post(form({ ...ASK, email: "KIM@Example.CA" }));
    expect(again.headers.get("location")).toBe("/request-invite?sent=1");
    expect(smtp.received).toHaveLength(1);
  });

  test("invite_request.never_logged: no log line names an address or the owner", async () => {
    await post(form({ ...ASK, email: "lee@example.ca" }));
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
    expect(smtp.received).toHaveLength(3);
  });

  test("invite_request.closed: with requests off there is no form, and a POST sends nothing", async () => {
    const html = await (await get("/request-invite", closed)).text();
    expect(html).toContain("Invite requests are closed for now.");
    expect(html).not.toContain('name="email"');
    const response = await post(form(ASK), { server: closed });
    expect(response.headers.get("location")).toBe("/request-invite");
    expect(smtp.received).toHaveLength(0);
  });

  test("invite_request.links: the sign-in page and a bare join page lead here", async () => {
    expect(await (await get("/login")).text()).toContain('href="/request-invite"');
    expect(await (await get("/join")).text()).toContain('href="/request-invite"');
  });

  // Last: it stops the mail server.
  test("invite_request.mail_fails: the visitor is told to try again, and may", async () => {
    await smtp.close();
    const first = await post(form({ ...ASK, email: "pat@example.ca" }));
    expect(first.headers.get("location")).toBe("/request-invite?error=invite.request_unavailable");
    const again = await post(form({ ...ASK, email: "pat@example.ca" }));
    expect(again.headers.get("location")).toBe("/request-invite?error=invite.request_unavailable");
    expect(web.logs().some((line) => line.event === "invite.request_mail_failed")).toBe(true);
  });
});
