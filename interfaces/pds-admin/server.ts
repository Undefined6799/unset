// The pds-admin request handler (P2.09 Algorithm; ADR 0060 decisions 2 to 5). Two routes; every other method and path
// is 404. A request runs the checks below in order, and every outcome is one log line. Issuing runs in one chain, so
// two requests can never read the same quota (step 7a).
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, inbound handler
import { type AdminPayload, DurabilityLost, type JtiStore } from "@unset/shared-admin-envelope";
import { checkEnvelope, checkShape, type Expected, isRefusal, type ServiceKey } from "./envelope.ts";
import { type IssueLimits, type IssueResult, issueInvite } from "./issue.ts";
import type { LogFields, RequestLog } from "./log.ts";
import type { Pds } from "./pds.ts";

export type HandlerDeps = {
  readonly keys: readonly ServiceKey[];
  readonly expected: Expected;
  readonly limits: IssueLimits;
  readonly pds: Pds;
  readonly jti: JtiStore;
  readonly log: RequestLog;
  readonly commit: string;
  readonly now: () => number;
  /** Stops the process: called when a state file's on-disk state is unknown, so a restart rereads it. */
  readonly stop: () => void;
  /** Whether the PDS has accepted our admin password yet (P2.09e); until it has, nothing is issued. */
  readonly ready: () => boolean;
};

const ROUTE = "/v1/invite.issue";
const BODY_CAP = 4096;

type Answer = { status: number; body: Record<string, unknown> };
const ERRORS: Record<number, string> = { 400: "bad_request", 403: "denied", 404: "not_found", 503: "unavailable" };
const fail = (status: number): Answer => ({ status, body: { error: ERRORS[status] } });

/** Step 2: the body, or null past the cap; the stream is not read further once the cap is passed. */
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

function answerFor(result: IssueResult): Answer {
  const at = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  switch (result.kind) {
    case "issued":
      return {
        status: 200,
        body: { code: result.code, remaining: result.remaining, availableAt: at(result.availableAt) },
      };
    case "closed":
      return { status: 409, body: { error: "signups_closed" } };
    case "denied":
      return fail(403);
    case "quota":
      return { status: 429, body: { error: "quota", availableAt: at(result.availableAt) } };
    case "unavailable":
      return fail(503);
  }
}

const OUTCOMES: Record<IssueResult["kind"], LogFields["outcome"]> = {
  issued: "issued",
  closed: "denied",
  denied: "denied",
  quota: "denied",
  unavailable: "error",
};

export function createHandler(deps: HandlerDeps): (req: IncomingMessage, res: ServerResponse) => void {
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  };
  const record = (fields: LogFields) => deps.log.append(fields, deps.now());

  async function handle(req: IncomingMessage, clientGone: () => boolean): Promise<Answer> {
    // Step 1: the one route, by method and exact path, as JSON.
    if (req.method === "GET" && req.url === "/health") return { status: 200, body: { ok: true, commit: deps.commit } };
    if (req.method !== "POST" || req.url !== ROUTE) return fail(404);
    // Before the body and the replay guard: a request refused here burns no jti and spends no slot, so web may retry.
    if (!deps.ready()) {
      record({ outcome: "error", reason: "password_unproven" });
      return fail(503);
    }
    if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") return deny(400, "content_type");
    // Steps 2 and 3: a capped body, parsed, of the exact shape.
    const raw = await readBody(req);
    if (raw === null) return deny(400, "body_cap");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return deny(400, "json");
    }
    const shaped = checkShape(parsed);
    if (isRefusal(shaped)) return deny(shaped.status, shaped.reason);
    // Steps 4 to 6: key, verb, signature, claims.
    const payload = checkEnvelope(shaped, deps.keys, deps.expected, Math.floor(deps.now() / 1000));
    // A refused envelope is unauthenticated: none of its fields is recorded, only the reason.
    if (isRefusal(payload)) return deny(payload.status, payload.reason);
    const who = { kid: shaped.kid, jti: payload.jti, verb: payload.verb };
    // Step 7: once only, recorded on disk before anything else happens.
    if (deps.jti.burn(payload.jti, payload.exp)) return deny(403, "replay", who);
    // Steps 8 to 12, one at a time.
    return serialized(() => issueQueued(payload, who, clientGone));
  }

  /** Steps 8 to 12 for one authenticated request, run inside the issuing chain. */
  async function issueQueued(payload: AdminPayload, who: Partial<LogFields>, clientGone: () => boolean) {
    // Time spent waiting counts: an envelope that expired, or a caller that hung up, in the chain or during the standing
    // checks, issues nothing, so no abandoned request creates a code or spends a quota slot (SE-5, RE-1).
    const abandoned = () => {
      if (Math.floor(deps.now() / 1000) > payload.exp) return "time";
      return clientGone() ? "client_gone" : null;
    };
    const gone = abandoned();
    if (gone !== null) return deny(403, gone, who);
    const dids = { actorDid: payload.actor_did, targetDid: payload.target };
    const daily = {
      reservedToday: () => deps.log.reservedToday(deps.now()),
      reserve: () => record({ outcome: "reserved", ...who, ...dids }),
    };
    const result = await issueInvite(deps.pds, deps.limits, payload.target, daily, deps.now, abandoned);
    const reason =
      result.kind === "issued" ? {} : { reason: result.kind === "closed" ? "signups_closed" : result.reason };
    record({
      outcome: OUTCOMES[result.kind],
      ...who,
      ...dids,
      ...reason,
      ...(result.kind === "issued" ? { code: result.code } : {}),
    });
    return answerFor(result);
  }

  function deny(status: 400 | 403, reason: string, who: Partial<LogFields> = {}): Answer {
    record({ outcome: "denied", reason, ...who });
    return fail(status);
  }

  /** Logs an unexpected failure; a state file left in an unknown state stops the process instead, so nothing more is
   * written to it and a restart rereads it as it really is. */
  function recordFailure(error: unknown): void {
    if (error instanceof DurabilityLost) {
      deps.stop();
      return;
    }
    try {
      record({ outcome: "error", reason: error instanceof Error ? error.constructor.name : "unknown" });
    } catch (logError) {
      // The log itself failed: the answer is still 503, never 200.
      if (logError instanceof DurabilityLost) deps.stop();
    }
  }

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let answer: Answer;
    // 'close' before the answer is written means the caller hung up.
    let gone = false;
    res.once("close", () => {
      gone = true;
    });
    try {
      answer = await handle(req, () => gone);
    } catch (error) {
      // Step 14: never 200 on an unexpected failure, and only the class name reaches the log.
      answer = fail(503);
      recordFailure(error);
    }
    res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(answer.body));
  }

  // A failure while writing the answer leaves nothing to tell the client: drop the connection.
  return (req, res) => {
    void respond(req, res).catch(() => res.destroy());
  };
}
