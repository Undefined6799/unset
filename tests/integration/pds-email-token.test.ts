// tests/support/pds-email-token.ts (P1.29h): confirms a local account's email through the PDS's real
// requestEmailConfirmation and confirmEmail, reading the token with the `pds-token-reader` service, and only on the
// local stack (architecture record 2026-10-13-p129h-local-token-reader, points 3 and 4 and Amendment 1). Docker,
// openssl and the PDS are stand-ins here; the running stack is P1.29t's.
import { describe, expect, test } from "vitest";
import type { Call, Ran } from "../support/docker.ts";
import { confirmLocalEmail, type LocalStack } from "../support/pds-email-token.ts";

const DID = `did:plc:${"a".repeat(24)}`;
const EMAIL = "someone@example.test";
const JWT = "eyJhbGciOiJFUzI1NksifQ.access.signature";
const TOKEN = "ABCDE-23456";
const PDS_ID = "1".repeat(64);
const EDGE_ID = "2".repeat(64);
const VOLUME = "unset-dev_pdsdata";

const NAME_CONSTRAINTS = [
  "X509v3 Name Constraints: critical",
  "    Permitted:",
  "      DNS:app.example.test",
  "      DNS:pds.example.test",
  "    Excluded:",
  "      IP:0.0.0.0/0.0.0.0",
  "",
].join("\n");

type World = {
  constraints: Ran;
  pds: string[];
  edge: string[];
  pdsEnv: Record<string, string>;
  edgeEnv: Record<string, string>;
  mounts: { Type: string; Name?: string; Destination: string }[];
  volumes: string[];
  reader: Ran;
  status: [number, number];
};
const local = (): World => ({
  constraints: { code: 0, out: NAME_CONSTRAINTS, err: "" },
  pds: [PDS_ID],
  edge: [EDGE_ID],
  pdsEnv: {
    PDS_HOSTNAME: "pds.example.test",
    PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test",
    PDS_DID_PLC_URL: "https://plc.directory",
  },
  edgeEnv: { PDS_HOST: "pds.example.test", PDS_UPSTREAM: "pds:3000" },
  mounts: [{ Type: "volume", Name: VOLUME, Destination: "/home/node" }],
  volumes: [VOLUME],
  reader: { code: 0, out: TOKEN, err: "" },
  status: [200, 200],
});

const env = (values: Record<string, string>) => JSON.stringify(Object.entries(values).map(([k, v]) => `${k}=${v}`));

/** Runs confirmLocalEmail against `world`, recording every command, request and log line. */
async function attempt(world: World) {
  const commands: string[][] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const logged: string[] = [];
  const run = (file: string, args: readonly string[], call: Call): Ran => {
    expect(call.timeoutMs).toBeGreaterThan(0);
    commands.push([file, ...args]);
    const line = [file, ...args].join(" ");
    const ok = (out: string): Ran => ({ code: 0, out, err: "" });
    if (file === "openssl") return world.constraints;
    if (line.includes("label=com.docker.compose.service=pds")) return ok(world.pds.map((id) => `${id}\n`).join(""));
    if (line.includes("label=com.docker.compose.service=edge")) return ok(world.edge.map((id) => `${id}\n`).join(""));
    if (line.includes(".Config.Env") && line.endsWith(PDS_ID)) return ok(env(world.pdsEnv));
    if (line.includes(".Config.Env") && line.endsWith(EDGE_ID)) return ok(env(world.edgeEnv));
    if (line.includes(".Mounts")) return ok(JSON.stringify(world.mounts));
    if (args[0] === "volume") return ok(world.volumes.map((name) => `${name}\n`).join(""));
    if (args.includes("pds-token-reader")) return world.reader;
    throw new Error(`unexpected command ${line}`);
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: world.status[requests.length - 1] ?? 500 });
  };
  const stack: LocalStack = {
    run,
    fetch: fetch as typeof globalThis.fetch,
    log: (line) => logged.push(line),
    devRootCert: "/srv/unset-dev-env/dev-root-ca.pem",
    composeFile: "/srv/unset/deployment/compose.dev.yaml",
    interpolationEnv: "/srv/unset-dev-env/dev-public.env",
  };
  let error: unknown = null;
  try {
    await confirmLocalEmail(stack, { did: DID, email: EMAIL, accessJwt: JWT });
  } catch (caught) {
    error = caught;
  }
  return { commands, requests, logged, error };
}

/** Nothing secret or personal in what the wrapper said or threw (SE-7). */
function expectNothingLeaked(result: Awaited<ReturnType<typeof attempt>>): void {
  const said = [...result.logged, result.error instanceof Error ? `${result.error.message} ${result.error.stack}` : ""];
  for (const value of [TOKEN, JWT, DID, EMAIL]) expect(said.join("\n")).not.toContain(value);
}

describe("tests/support/pds-email-token.ts", () => {
  test("local_confirm_uses_real_endpoint", async () => {
    const result = await attempt(local());
    expect(result.error).toBeNull();
    expect(result.requests.map((r) => [r.url, r.init.method, r.init.redirect])).toEqual([
      ["https://pds.example.test/xrpc/com.atproto.server.requestEmailConfirmation", "POST", "error"],
      ["https://pds.example.test/xrpc/com.atproto.server.confirmEmail", "POST", "error"],
    ]);
    for (const { init } of result.requests) {
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${JWT}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.parse(String(result.requests[1]?.init.body))).toEqual({ email: EMAIL, token: TOKEN });
    // The reader runs once, after the request, as the tools profile's one-off container on the pinned project.
    expect(result.commands.at(-1)).toEqual([
      "docker",
      "compose",
      "--project-name",
      "unset-dev",
      "--file",
      "/srv/unset/deployment/compose.dev.yaml",
      "--env-file",
      "/srv/unset-dev-env/dev-public.env",
      "--profile",
      "tools",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "pds-token-reader",
      "/reader/read.ts",
      DID,
    ]);
    expect(result.logged.length).toBeGreaterThan(0);
    expectNothingLeaked(result);
  });

  test("email_token_never_logged_or_thrown", async () => {
    const refused = await attempt({ ...local(), status: [200, 400] });
    expect(refused.error).toEqual(new Error("the PDS refused confirmEmail (HTTP 400)"));
    expectNothingLeaked(refused);
    const garbled = await attempt({ ...local(), reader: { code: 0, out: `${TOKEN}\n${TOKEN}`, err: "" } });
    expect(garbled.error).toEqual(new Error("the token reader printed something other than one token"));
    expect(garbled.requests).toHaveLength(1);
    expectNothingLeaked(garbled);
    const failed = await attempt({ ...local(), reader: { code: 1, out: "", err: `${TOKEN} anything else\n` } });
    expect(failed.error).toEqual(new Error("the token reader failed"));
    expectNothingLeaked(failed);
    const named = await attempt({
      ...local(),
      reader: { code: 1, out: "", err: "no confirm_email token for this account\n" },
    });
    expect(named.error).toEqual(new Error("the token reader failed: no confirm_email token for this account"));
  });

  test("email_token_reader_refuses_non_local", async () => {
    const cases: [string, (w: World) => World][] = [
      [
        "the dev root certificate is missing or unreadable",
        (w) => ({ ...w, constraints: { code: 1, out: "", err: "x" } }),
      ],
      [
        "the dev root names no DNS names",
        (w) => ({ ...w, constraints: { code: 0, out: "No extensions in certificate\n", err: "" } }),
      ],
      [
        "the dev root's name constraints are not critical",
        (w) => ({ ...w, constraints: { code: 0, out: NAME_CONSTRAINTS.replace(": critical", ":"), err: "" } }),
      ],
      ["expected exactly one running pds container of the unset-dev project", (w) => ({ ...w, pds: [] })],
      ["expected exactly one running pds container of the unset-dev project", (w) => ({ ...w, pds: [PDS_ID, PDS_ID] })],
      ["expected exactly one running edge container of the unset-dev project", (w) => ({ ...w, edge: [] })],
      [
        "the edge's PDS_HOST is not one of the dev root's names",
        (w) => ({ ...w, edgeEnv: { PDS_HOST: "pds.unset.ac" } }),
      ],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "unset.ac" } })],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "evil.localhost.example" } })],
      [
        "a handle domain is not local",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.unset.ac" } }),
      ],
      [
        "the PDS has a mail server set",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_EMAIL_SMTP_URL: "smtps://mail.example.test" } }),
      ],
      [
        "the PDS does not keep its data in a named volume at /home/node",
        (w) => ({ ...w, mounts: [{ Type: "bind", Destination: "/home/node" }] }),
      ],
      // Another project's volume, or one whose labels were not set by Compose for unset-dev's pdsdata.
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: [] })],
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: ["other_pdsdata"] })],
      [
        "the PDS volume is not the unset-dev project's pdsdata",
        (w) => ({ ...w, mounts: [{ Type: "volume", Name: "other_pdsdata", Destination: "/home/node" }] }),
      ],
    ];
    for (const [reason, edit] of cases) {
      const result = await attempt(edit(local()));
      expect(result.error, reason).toEqual(new Error(reason));
      // Refused before anything reaches the PDS or the reader runs.
      expect(result.requests, reason).toEqual([]);
      expect(
        result.commands.some((c) => c.includes("pds-token-reader")),
        reason,
      ).toBe(false);
      expectNothingLeaked(result);
    }
    // The .localhost form passes: a PDS_HOSTNAME under it is local by definition (RFC 6761, section 6.3).
    const localhost = await attempt({ ...local(), pdsEnv: { ...local().pdsEnv, PDS_HOSTNAME: "pds.localhost" } });
    expect(localhost.error).toBeNull();
  });
});
