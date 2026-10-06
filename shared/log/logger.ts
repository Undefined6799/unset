// The structured logger (P1.03; rule SE-7): one JSON line per call, only allowlisted fields, every string scrubbed.
// It cannot write an IP address, a user agent, a raw path, a secret or free text.
import { AppError, type ErrorCode } from "@unset/shared-errors";
import { scrub } from "./scrub.ts";

/** Known events. A later step adds the events it logs here; anything else is logged as `log.unknown_event`. */
const EVENTS = [
  "config.invalid",
  "config.unknown_keys",
  "error",
  "log.unknown_event",
  "log.serialize_failed",
  // P1.04k, the HTTP server kit: one line per response, a fired deadline, a handler result that came too late, a
  // failed listen, and the shutdown drain.
  "http.request",
  "http.deadline",
  "http.late_result",
  "http.listen_failed",
  "http.drain",
  // P1.05, the trusted proxy: a header-mode request that did not come from the edge (logged without its address).
  "proxy.untrusted_peer",
  // P1.06, the rate limiter: a session-only limit reached without a session, and a limiter error (both deny).
  "ratelimit.no_session",
  "ratelimit.error",
  // P1.07, the CSRF gate: a request other than GET or HEAD it denied, with a fixed reason word.
  "csrf.denied",
  // P1.08, the security headers: a handler set its own Content-Security-Policy, which the route group's policy replaced.
  "csp.handler_override",
  // P1.11, the migration runner: the database is ahead of this code (a rollback deploy), a migration failed (its
  // version and Postgres SQLSTATE, never the error message, which can carry data), and the run finished.
  "migrate.database_ahead",
  "migrate.failed",
  "migrate.done",
] as const;
export type LogEvent = (typeof EVENTS)[number];

/** The only fields a log line may carry. `route` is a route template (`/@:handle`), never a raw path. */
export type LogFields = Partial<{
  code: ErrorCode;
  route: string;
  method: HttpMethod;
  status: number;
  ms: number;
  reqId: string;
  count: number;
  bytes: number;
  key: string;
  reason: string;
  phase: string;
  kind: string;
  job: string;
  attempt: number;
  /** A migration's version number (P1.11). */
  version: number;
  /** A Postgres SQLSTATE such as `42P01`: five characters, no message text (P1.11). */
  sqlstate: string;
}>;

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

const ALLOWED: ReadonlySet<string> = new Set([
  "code",
  "route",
  "method",
  "status",
  "ms",
  "reqId",
  "count",
  "bytes",
  "key",
  "reason",
  "phase",
  "kind",
  "job",
  "attempt",
  "version",
  "sqlstate",
]);
const ROUTE_TEMPLATE = /^\/[A-Za-z0-9_\-/:@.*]*$/;
/** A route segment a template may hold: a parameter, a wildcard or a word literal. A handle, id or token is none. */
const ROUTE_SEGMENT = /^(?:@?:[A-Za-z][A-Za-z0-9_]*|\*|[a-z]{1,32}(?:[-_][a-z]{1,32}){0,3}|\.well-known|)$/;
/** A random per-request id: a UUID or 16 to 64 base64url characters. Anything else is not a request id. */
const REQUEST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,64})$/;
/** A SQLSTATE is five digits or uppercase letters (postgresql.org/docs/18/errcodes-appendix.html). */
const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_FRAMES = 10;
/**
 * Fields that hold one fixed word (SE-7 ruling 2026-10-06, P1.03w). Callers type them as literal unions where they
 * can (`CsrfReason`); this is the runtime backstop, so a handle, DID, email, IP or URL never passes. A string of up to
 * 32 lowercase letters and digits can still pass the word shape; tokens never reach these fields by type.
 */
const WORD_FIELDS: Readonly<Record<string, RegExp>> = {
  reason: /^[a-z][a-z0-9_-]{0,31}$/,
  phase: /^[a-z][a-z0-9_-]{0,31}$/,
  job: /^[a-z][a-z0-9_-]{0,31}$/,
  /** An error class name, such as `TypeError`. */
  kind: /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
  /** A configuration key name, such as `PG_HOST`. */
  key: /^[A-Z][A-Z0-9_]{0,63}$/,
};

/**
 * Until the route table exists (P1.04k) a template is judged by its segments: every one must be a parameter, `*` or a
 * lowercase literal, so a raw path such as `/@alice.example` or `/u/10.0.0.1` fails.
 */
const isRouteTemplate = (value: string): boolean =>
  value.length <= 200 &&
  ROUTE_TEMPLATE.test(value) &&
  value
    .slice(1)
    .split("/")
    .every((s) => ROUTE_SEGMENT.test(s));

/** A string field's logged value: routes, request ids, SQLSTATEs and word fields are checked whole; others scrubbed. */
function cleanString(key: string, value: string): string {
  if (key === "route") return isRouteTemplate(value) ? value : "[route]";
  if (key === "reqId") return REQUEST_ID.test(value) ? value : "[reqId]";
  if (key === "sqlstate") return SQLSTATE.test(value) ? value : "[sqlstate]";
  const word = WORD_FIELDS[key];
  if (word !== undefined) return word.test(value) ? value : `[${key}]`;
  return scrub(value);
}

type Level = "info" | "warn" | "error";
type Primitive = string | number | boolean | null;

export type Logger = {
  readonly info: (event: LogEvent, fields?: LogFields) => void;
  readonly warn: (event: LogEvent, fields?: LogFields) => void;
  readonly error: (event: LogEvent, fields?: LogFields) => void;
  /** Logs an error by code and class name; stack frames (`file:line`, no message) only outside prod. */
  readonly logError: (error: unknown) => void;
};

export type LoggerOptions = {
  service: string;
  commit: string;
  env: "dev" | "test" | "prod";
  /** Where each line goes; one call per line. Defaults to stdout. */
  write?: (line: string) => void;
  now?: () => Date;
};

/** A migration version: a non-negative safe integer. Anything else is dropped, never coerced (ruling 2026-10-06). */
const isVersion = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

const isPrimitive = (value: unknown): value is Primitive =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** Allowlisted, primitive, scrubbed fields, and how many were dropped. */
function cleanFields(fields: Record<string, unknown>): { clean: Record<string, Primitive>; dropped: number } {
  const clean: Record<string, Primitive> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || !isPrimitive(value) || (key === "version" && !isVersion(value))) {
      dropped += 1;
      continue;
    }
    clean[key] = typeof value === "string" ? cleanString(key, value) : value;
  }
  return { clean, dropped };
}

/**
 * `file:line` for up to ten stack frames. Only `    at …` lines count, so a multi-line message (user input) is not
 * mistaken for frames, and each frame is scrubbed in case a path still carries input.
 */
function stackFrames(error: Error): string {
  const stack = error.stack;
  if (typeof stack !== "string") return "";
  return stack
    .slice(0, 10_000)
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.match(/\(?([^\s()]+):(\d+):\d+\)?\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => `${framePath(m[1] ?? "")}:${m[2]}`)
    .join(" ");
}

let stdoutGuarded = false;

/**
 * The default writer. A closed pipe surfaces as an asynchronous `'error'` event on stdout, not as a throw, and an
 * unhandled one kills the process; one listener absorbs it and later lines are skipped.
 */
function writeStdout(line: string): void {
  if (!stdoutGuarded) {
    stdoutGuarded = true;
    process.stdout.on("error", () => undefined);
  }
  if (process.stdout.writable) process.stdout.write(line);
}

/** A frame's file relative to the working directory, scrubbed one path segment at a time. */
function framePath(file: string): string {
  const path = file.replace(/^file:\/\//, "");
  const base = `${process.cwd()}/`;
  const relative = path.startsWith(base) ? path.slice(base.length) : path;
  return relative
    .split("/")
    .map((segment) => scrub(segment, 100))
    .join("/");
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? writeStdout;
  const now = options.now ?? (() => new Date());

  const emit = (record: Record<string, unknown>): void => {
    let line: string;
    try {
      line = `${JSON.stringify(record)}\n`;
    } catch {
      line = `${JSON.stringify({ ts: record.ts, level: "error", event: "log.serialize_failed" })}\n`;
    }
    try {
      write(line);
    } catch {
      // DC-4 exception, required by the step book: a failed write (closed or unwritable stdout) is dropped, because
      // logging never takes the process down and there is nowhere left to report it. Only `write` sits in this try.
    }
  };

  const record = (level: Level, event: string, fields: Record<string, unknown>, extra: Record<string, string>) => {
    const known = (EVENTS as readonly string[]).includes(event);
    const { clean, dropped } = cleanFields(fields);
    return {
      ts: now().toISOString(),
      level,
      svc: options.service,
      commit: options.commit,
      event: known ? event : "log.unknown_event",
      ...clean,
      // An unknown event's text could be anything a caller built, so only a placeholder is kept (P1.03w).
      ...(known ? {} : { kind: "[event]" }),
      ...extra,
      ...(dropped > 0 ? { dropped } : {}),
    };
  };

  /** Building a record runs caller getters and proxies; if that throws, a fixed line is logged instead. */
  const log = (level: Level, event: string, input: () => [Record<string, unknown>, Record<string, string>]) => {
    let built: Record<string, unknown>;
    try {
      built = record(level, event, ...input());
    } catch {
      built = { ts: new Date().toISOString(), level: "error", event: "log.serialize_failed" };
    }
    emit(built);
  };

  return {
    info: (event, fields = {}) => log("info", event, () => [fields, {}]),
    warn: (event, fields = {}) => log("warn", event, () => [fields, {}]),
    error: (event, fields = {}) => log("error", event, () => [fields, {}]),
    logError: (error) =>
      log("error", "error", () => {
        const code = error instanceof AppError ? error.code : "internal.error";
        const kind = error instanceof Error ? String(error.name) : typeof error;
        const stack = options.env !== "prod" && error instanceof Error ? { stack: stackFrames(error) } : {};
        return [{ code, kind }, stack];
      }),
  };
}
