import { createLogger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { installFatalHandlers } from "./fatal.ts";

function harness() {
  const handlers = new Map<string, (error: unknown) => void>();
  const calls: string[] = [];
  const lines: string[] = [];
  const log = createLogger({ service: "web", commit: "c".repeat(40), env: "prod", write: (line) => lines.push(line) });
  installFatalHandlers(log, {
    pid: 4242,
    on: ((event: string, handler: (error: unknown) => void) => {
      handlers.set(event, handler);
      return process;
    }) as NodeJS.Process["on"],
    kill: ((pid: number, signal: string) => {
      calls.push(`kill ${pid} ${signal}`);
      return true;
    }) as NodeJS.Process["kill"],
    exit: ((code: number) => {
      calls.push(`exit ${code}`);
    }) as NodeJS.Process["exit"],
  });
  return { handlers, calls, lines, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

test("fatal.unhandled_rejection_is_scrubbed_and_drains", () => {
  const { handlers, calls, lines, records } = harness();
  handlers.get("unhandledRejection")?.(new TypeError("did:plc:abcdefghijklmnopqrstuvwx alice.example"));
  expect(calls).toEqual(["kill 4242 SIGTERM"]);
  expect(records()).toMatchObject([{ level: "error", event: "error", code: "internal.error", kind: "TypeError" }]);
  expect(lines.join("")).not.toContain("did:plc");
  expect(lines.join("")).not.toContain("alice.example");
});

test("fatal.uncaught_exception_is_scrubbed_and_exits_1", () => {
  const { handlers, calls, lines, records } = harness();
  handlers.get("uncaughtException")?.(new RangeError("did:plc:abcdefghijklmnopqrstuvwx"));
  expect(calls).toEqual(["exit 1"]);
  expect(records()).toMatchObject([{ level: "error", code: "internal.error", kind: "RangeError" }]);
  expect(lines.join("")).not.toContain("did:plc");
});
