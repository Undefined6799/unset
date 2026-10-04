// The structured logger (P1.03; rule SE-7): one JSON line per call, only allowlisted fields, every string scrubbed.
// It cannot write an IP address, a user agent, a raw path, a secret or free text.
import { AppError } from "@unset/shared-errors";
import { scrub } from "./scrub.ts";

/** Known events. A later step adds the events it logs here; anything else is logged as `log.unknown_event`. */
const EVENTS = ["config.invalid", "config.unknown_keys", "error", "log.unknown_event", "log.serialize_failed"] as const;
export type LogEvent = (typeof EVENTS)[number];

/** The only fields a log line may carry. `route` is a route template (`/@:handle`), never a raw path. */
export type LogFields = Partial<{
  code: string;
  route: string;
  method: string;
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
}>;

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
]);
const ROUTE_TEMPLATE = /^\/[A-Za-z0-9_\-/:@.*]*$/;

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

const isPrimitive = (value: unknown): value is Primitive =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** Allowlisted, primitive, scrubbed fields, and how many were dropped. */
function cleanFields(fields: Record<string, unknown>): { clean: Record<string, Primitive>; dropped: number } {
  const clean: Record<string, Primitive> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || !isPrimitive(value)) {
      dropped += 1;
      continue;
    }
    if (typeof value !== "string") clean[key] = value;
    else if (key === "route") clean[key] = ROUTE_TEMPLATE.test(value) && value.length <= 200 ? value : "[route]";
    else clean[key] = scrub(value);
  }
  return { clean, dropped };
}

/** `file:line` for each stack frame; the message line, which can carry user input, is never kept. */
function stackFrames(error: Error): string {
  return (error.stack ?? "")
    .split("\n")
    .slice(1)
    .map((line) => line.match(/\(?([^\s()]+):(\d+):\d+\)?\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => `${m[1]}:${m[2]}`)
    .join(" ");
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(line));
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
      // stdout closed (EPIPE) or unwritable: logging never takes the process down, and there is nowhere left to say so.
    }
  };

  const log = (level: Level, event: string, fields: Record<string, unknown>, extra: Record<string, string> = {}) => {
    const known = (EVENTS as readonly string[]).includes(event);
    const given = known ? fields : { ...fields, kind: event.slice(0, 40) };
    const { clean, dropped } = cleanFields(given);
    emit({
      ts: now().toISOString(),
      level,
      svc: options.service,
      commit: options.commit,
      event: known ? event : "log.unknown_event",
      ...clean,
      ...extra,
      ...(dropped > 0 ? { dropped } : {}),
    });
  };

  return {
    info: (event, fields = {}) => log("info", event, fields),
    warn: (event, fields = {}) => log("warn", event, fields),
    error: (event, fields = {}) => log("error", event, fields),
    logError: (error) => {
      const code = error instanceof AppError ? error.code : "internal.error";
      const kind = error instanceof Error ? error.name : typeof error;
      const stack = options.env !== "prod" && error instanceof Error ? { stack: stackFrames(error) } : {};
      log("error", "error", { code, kind }, stack);
    },
  };
}
