// The chat-admin request handler (ADR 0081 decision 5): one route per command, every other method and path 404. A
// request runs the checks below in order, and every outcome is one log line of allowlisted fields (rule SE-7: no
// username, display name, device, token or MAS ID). Commands for one account run one at a time, so a renewal's
// read-mint-revoke never interleaves with another command for that account (rule DA-4).
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { type ChatAdminVerb, DurabilityLost, type JtiStore } from "@unset/shared-admin-envelope";
import { type Abandoned, changeAccount, createAccount, endSessions, mintSession, type Result } from "./commands.ts";
import {
  type Command,
  checkEnvelope,
  checkShape,
  DEVICE,
  type DeviceId,
  isRefusal,
  type Refusal,
  type ServiceKey,
} from "./envelope.ts";
import type { Mas } from "./mas.ts";
import type { Quotas } from "./quota.ts";

export type LogLine = {
  outcome: "ok" | "denied" | "error";
  reason?: string;
  verb?: string;
  kid?: string;
  jti?: string;
};

export type HandlerDeps = {
  readonly keys: readonly ServiceKey[];
  readonly env: string;
  readonly mas: Mas;
  readonly sessionTtl: number;
  readonly jti: JtiStore;
  readonly quotas: Quotas;
  readonly log: (line: LogLine) => void;
  readonly commit: string;
  readonly now: () => number;
  /** Stops the process: called when the jti file's on-disk state is unknown, so a restart rereads it. */
  readonly stop: () => void;
};

const ROUTES: Readonly<Record<string, ChatAdminVerb>> = {
  "/v1/account.create": "account.create",
  "/v1/session.mint": "session.mint",
  "/v1/session.end": "session.end",
  "/v1/account.lock": "account.lock",
  "/v1/account.unlock": "account.unlock",
  "/v1/account.deactivate": "account.deactivate",
};
const BODY_CAP = 4096;

type Answer = { status: number; body: Record<string, unknown> };
const ERRORS: Record<number, string> = {
  400: "bad_request",
  403: "denied",
  404: "not_found",
  429: "quota",
  503: "unavailable",
};
const fail = (status: number): Answer => ({ status, body: { error: ERRORS[status] } });

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_CAP) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** A mint's body is `{ ticket, device }`: the envelope web signed, and the browser's device the door names for a
 * renewal (or null for a new browser). The device is unsigned; mintSession only accepts one with a live session. */
function splitMint(body: unknown): { envelope: unknown; device: DeviceId | null } | null {
  if (typeof body !== "object" || body === null || Object.keys(body).sort().join() !== "device,ticket") return null;
  const { ticket, device } = body as Record<string, unknown>;
  if (device !== null && (typeof device !== "string" || !DEVICE.test(device))) return null;
  return { envelope: ticket, device: device as DeviceId | null };
}

type Request = { envelope: unknown; device: DeviceId | null };

/** A JSON body under the cap; for a mint, split into its ticket and device. */
async function readRequest(req: IncomingMessage, verb: ChatAdminVerb): Promise<Request | Refusal> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
    return { status: 400, reason: "content_type" };
  }
  const raw = await readBody(req);
  if (raw === null) return { status: 400, reason: "body_cap" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { status: 400, reason: "json" };
  }
  if (verb !== "session.mint") return { envelope: parsed, device: null };
  return splitMint(parsed) ?? { status: 400, reason: "shape" };
}

export function createHandler(deps: HandlerDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const chains = new Map<string, Promise<unknown>>();
  const perAccount = <T>(user: string, work: () => Promise<T>): Promise<T> => {
    const run = (chains.get(user) ?? Promise.resolve()).then(work, work);
    const settled = run.catch(() => undefined);
    chains.set(user, settled);
    void settled.then(() => chains.get(user) === settled && chains.delete(user));
    return run;
  };
  const deny = (status: 400 | 403 | 429, reason: string, who: Partial<LogLine> = {}): Answer => {
    deps.log({ outcome: "denied", reason, ...who });
    return fail(status);
  };

  async function handle(req: IncomingMessage, clientGone: () => boolean): Promise<Answer> {
    if (req.method === "GET" && req.url === "/health") return { status: 200, body: { ok: true, commit: deps.commit } };
    const verb = ROUTES[req.url ?? ""];
    if (req.method !== "POST" || verb === undefined) return fail(404);
    const mint = await readRequest(req, verb);
    if (isRefusal(mint)) return deny(mint.status, mint.reason);
    const shaped = checkShape(mint.envelope);
    if (isRefusal(shaped)) return deny(shaped.status, shaped.reason);
    const command = checkEnvelope(shaped, deps.keys, deps.env, Math.floor(deps.now() / 1000));
    // A refused envelope is unauthenticated: none of its fields is logged, only the reason.
    if (isRefusal(command)) return deny(command.status, command.reason);
    const who = { verb: command.verb, kid: command.kid, jti: command.jti };
    if (command.verb !== verb) return deny(403, "route", who);
    if (deps.jti.burn(command.jti, command.exp)) return deny(403, "replay", who);
    if (!deps.quotas.spend(command.verb, command.user, deps.now())) return deny(429, "quota", who);
    // Time spent waiting for the account's chain counts: an expired envelope or a caller that hung up writes nothing.
    const abandoned: Abandoned = () => {
      if (Math.floor(deps.now() / 1000) > command.exp) return "time";
      return clientGone() ? "client_gone" : null;
    };
    const result = await perAccount(command.user, () => run(command, mint.device, abandoned));
    return answerFor(result, who);
  }

  function run(command: Command, device: DeviceId | null, abandoned: Abandoned): Promise<Result<object>> {
    const gone = abandoned();
    if (gone !== null) return Promise.resolve({ kind: "refused", status: 403, reason: gone });
    if (command.verb === "account.create") return createAccount(deps.mas, command.user, command.name);
    if (command.verb === "session.end") return endSessions(deps.mas, command.user, command.device);
    if (command.verb !== "session.mint") return changeAccount(deps.mas, command.user, command.verb);
    return mintSession(deps.mas, deps.sessionTtl, command.user, device, abandoned);
  }

  function answerFor(result: Result<object>, who: Partial<LogLine>): Answer {
    if (result.kind === "ok") {
      deps.log({ outcome: "ok", ...who });
      const { kind: _, ...body } = result;
      return { status: 200, body };
    }
    if (result.kind === "unavailable") {
      deps.log({ outcome: "error", reason: result.reason, ...who });
      return fail(503);
    }
    deps.log({ outcome: "denied", reason: result.reason, ...who });
    return { status: result.status, body: { error: result.status === 409 ? result.reason : "denied" } };
  }

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let gone = false;
    res.once("close", () => {
      gone = true;
    });
    let answer: Answer;
    try {
      answer = await handle(req, () => gone);
    } catch (error) {
      // Never 200 on an unexpected failure; only the class name reaches the log.
      if (error instanceof DurabilityLost) deps.stop();
      deps.log({ outcome: "error", reason: error instanceof Error ? error.constructor.name : "unknown" });
      answer = fail(503);
    }
    res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(answer.body));
  }

  return (req, res) => {
    void respond(req, res).catch(() => res.destroy());
  };
}
