// One wrapper for every call to a member's PDS (P2.07; plan §2 rule 3, §5.3, §10). It restores the OAuth session,
// classifies the failure, retries only an idempotent read, and never turns a nonce handshake or an outage into a
// logout. @atproto/api 0.24.2 Agent is the XRPC client: its constructor takes a FetchHandlerObject, which is what
// OAuthSession is (fetchHandler, oauth-session.js). @atproto/lex 0.3.14 is the lexicon CLI, and @atproto/lex-client
// may be imported only from shared/lexicons (dependency-cruiser SDK_ADAPTERS), so it cannot sit on this session.
import { Agent } from "@atproto/api";
import type { Did } from "@unset/domains-identity";
import { withErrorParam } from "@unset/shared-errors";
import type { Logger } from "@unset/shared-log";
import { className, opFailure, restoreOutcome, statusOf } from "./pds-errors.ts";

/** Book inputs `PDS_CALL_TIMEOUT_MS` and `PDS_UPLOAD_TIMEOUT_MS`. A route passes `timeoutMs` for an upload. */
export const PDS_CALL_TIMEOUT_MS = 10_000;
export const PDS_UPLOAD_TIMEOUT_MS = 30_000;

export type PdsResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "transient"; readonly code: "pds_unavailable" | "pds_rate_limited" | "lock_timeout" }
  | { readonly kind: "auth_dead" }
  | { readonly kind: "scope_missing"; readonly scope?: string }
  | { readonly kind: "rejected"; readonly xrpcError: string; readonly status: number };

export type PdsContext = {
  readonly memo: Map<string, unknown>;
  readonly deadline: AbortSignal;
  /** Epoch milliseconds when `deadline` fires, so a retry can tell whether it still fits (README rule 8a). */
  readonly deadlineAt: number;
  clearSession?: () => void;
};

export type SessionInfo = { readonly handle: string; readonly email?: string; readonly emailConfirmed?: boolean };

export type PdsFailure =
  | { readonly action: "notice"; readonly status: 200 | 503; readonly text: string }
  | { readonly action: "redirect"; readonly location: string }
  | { readonly action: "rejected"; readonly xrpcError: string; readonly status: number };

/** What `OAuthSession.fetchHandler` is (@atproto/oauth-client 0.8.9). `Agent` takes this shape. */
type SessionFetch = {
  fetchHandler(url: string, init: RequestInit): Promise<Response>;
};
type OauthClient = { restore(sub: string): Promise<SessionFetch> };

export type PdsCallDeps = {
  /** The one OAuth client. `restore` is called only in this file (the guard scans for `client.restore(`). */
  readonly client: OauthClient;
  /** P2.04s `destroyAllForDid(tx, did, 'auth_dead')`, injected: pds may not import infrastructure/session. */
  readonly endSessions: (did: Did) => Promise<void>;
  /** One SELECT: the token set is still stored. A 401 with the set gone is `auth_dead`. */
  readonly tokenSetRemains: (did: Did) => Promise<boolean>;
  readonly log: Logger;
  readonly callTimeoutMs?: number;
};

type CallOpts = { readonly idempotent: boolean; readonly timeoutMs?: number };

const unavailable = { kind: "transient", code: "pds_unavailable" } as const;

function backoffMs(): number {
  return 200 + Math.floor(Math.random() * 401);
}

function fits(deadlineAt: number, timeoutMs: number, waitMs: number): boolean {
  return deadlineAt - Date.now() > waitMs + timeoutMs;
}

/** Rejects when `signal` aborts. The work may keep running; the caller has already stopped waiting. */
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function delay(ms: number, deadline: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (deadline.aborted) {
      reject(deadline.reason instanceof Error ? deadline.reason : new Error("AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      deadline.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(deadline.reason instanceof Error ? deadline.reason : new Error("AbortError"));
    };
    deadline.addEventListener("abort", onAbort, { once: true });
  });
}

/** The XRPC client over one restored session. Only this file constructs it (pds-call.guard). */
function xrpcFromSession(session: SessionFetch): Agent {
  return new Agent(session);
}

export function createPdsCall(deps: PdsCallDeps) {
  const timeoutDefault = deps.callTimeoutMs ?? PDS_CALL_TIMEOUT_MS;

  async function authDead(ctx: PdsContext | null, did: Did): Promise<PdsResult<never>> {
    await deps.endSessions(did).catch((error: unknown) => {
      deps.log.warn("pds.unexpected", { kind: className(error) });
    });
    ctx?.clearSession?.();
    return { kind: "auth_dead" };
  }

  async function pdsCall<T>(
    ctx: PdsContext | null,
    did: Did,
    op: (xrpc: Agent) => Promise<T>,
    opts: CallOpts,
  ): Promise<PdsResult<T>> {
    const key = `pds:${did}`;
    let xrpc = ctx?.memo.get(key) as Agent | undefined;
    if (xrpc === undefined) {
      let session: SessionFetch;
      try {
        session = await deps.client.restore(did);
      } catch (error: unknown) {
        const outcome = restoreOutcome(error);
        if (outcome === "auth_dead") return authDead(ctx, did);
        if (outcome === "lock_timeout") return { kind: "transient", code: "lock_timeout" };
        if (outcome === "unexpected") deps.log.warn("pds.unexpected", { kind: className(error) });
        return unavailable;
      }
      xrpc = xrpcFromSession(session);
      ctx?.memo.set(key, xrpc);
    }
    const timeoutMs = opts.timeoutMs ?? timeoutDefault;
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      const timer = AbortSignal.timeout(timeoutMs);
      const signal = ctx === null ? timer : AbortSignal.any([timer, ctx.deadline]);
      try {
        return { kind: "ok", value: await untilAbort(op(xrpc), signal) };
      } catch (error: unknown) {
        if (ctx?.deadline.aborted === true) return unavailable;
        const failure = opFailure(error);
        if (failure.kind === "handshake") {
          if (attempt === 1) continue;
          return unavailable;
        }
        if (failure.kind === "unauthorized") {
          const live = await deps.tokenSetRemains(did).catch(() => true);
          if (!live) return authDead(ctx, did);
          deps.log.warn("pds.401_with_live_set");
          return unavailable;
        }
        if (failure.kind === "rate_limited") return { kind: "transient", code: "pds_rate_limited" };
        if (failure.kind === "scope_missing") {
          return failure.scope === undefined
            ? { kind: "scope_missing" }
            : { kind: "scope_missing", scope: failure.scope };
        }
        if (failure.kind === "rejected") return failure;
        const wait = backoffMs();
        const retry =
          opts.idempotent &&
          attempt === 1 &&
          (failure.kind === "retryable" || timer.aborted) &&
          (ctx === null || fits(ctx.deadlineAt, timeoutMs, wait));
        if (!retry) {
          if (failure.kind === "unexpected" && statusOf(error) === undefined) {
            deps.log.warn("pds.unexpected", { kind: className(error) });
          }
          return unavailable;
        }
        if (ctx !== null) {
          try {
            await delay(wait, ctx.deadline);
          } catch {
            return unavailable;
          }
        } else {
          await delay(wait, AbortSignal.timeout(wait + 50));
        }
      }
    }
    return unavailable;
  }

  async function loadSession(ctx: PdsContext | null, did: Did): Promise<PdsResult<SessionInfo>> {
    return pdsCall(
      ctx,
      did,
      async (agent) => {
        const { data } = await agent.com.atproto.server.getSession();
        const info: SessionInfo = { handle: data.handle };
        if (data.email === undefined) return info;
        return data.emailConfirmed === undefined
          ? { handle: data.handle, email: data.email }
          : { handle: data.handle, email: data.email, emailConfirmed: data.emailConfirmed };
      },
      { idempotent: true },
    );
  }

  function pdsSessionInfo(ctx: PdsContext | null, did: Did): Promise<PdsResult<SessionInfo>> {
    if (ctx === null) return loadSession(ctx, did);
    const key = `pds-session:${did}`;
    const cached = ctx.memo.get(key) as Promise<PdsResult<SessionInfo>> | undefined;
    if (cached !== undefined) return cached;
    const pending = loadSession(ctx, did);
    ctx.memo.set(key, pending);
    return pending;
  }

  return { pdsCall, pdsSessionInfo };
}

/** What a route does with a failure. The page renders `text`; this file does not (infrastructure does not own UI). */
export function respondToPdsFailure(
  method: "GET" | "POST",
  result: Exclude<PdsResult<unknown>, { kind: "ok" }>,
  pdsHost: string,
): PdsFailure {
  if (result.kind === "transient") {
    return {
      action: "notice",
      status: method === "POST" ? 503 : 200,
      text: `${pdsHost} is not answering; your session is kept`,
    };
  }
  if (result.kind === "scope_missing") {
    return { action: "redirect", location: withErrorParam("/verify-email", "login.scope_insufficient") };
  }
  if (result.kind === "auth_dead") {
    return { action: "redirect", location: withErrorParam("/login", "login.session_ended") };
  }
  return { xrpcError: result.xrpcError, status: result.status, action: "rejected" };
}
