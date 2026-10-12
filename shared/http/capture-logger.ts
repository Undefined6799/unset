// A Logger for the server kit's own tests (P0.09q): each call becomes one JSON line, carrying the level, the event and
// the fields as the caller passed them. The trusted tests use it instead of `@unset/shared-log`, which is outside the
// trusted base, so only `import type` reaches that package (book edit 2026-10-12-p009n-trusted-test-imports,
// amendments 3 and 6). `logError` keeps what shared/log keeps: the error code and class name, never the message.
import { AppError } from "@unset/shared-errors";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";

export function captureLogger(write: (line: string) => void = () => undefined): Logger {
  const record = (level: string, event: LogEvent, fields: LogFields | Record<string, string> = {}) =>
    write(JSON.stringify({ level, event, ...fields }));
  return {
    info: (event, fields) => record("info", event, fields),
    warn: (event, fields) => record("warn", event, fields),
    error: (event, fields) => record("error", event, fields),
    logError: (error) =>
      record("error", "error", {
        code: error instanceof AppError ? error.code : "internal.error",
        kind: error instanceof Error ? String(error.name) : typeof error,
      }),
  };
}
