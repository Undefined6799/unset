// Last-resort handlers for the web process (P1.04w). Without them Node prints the raw error to stderr, past the
// scrubbing logger, and library error messages can carry a DID or a handle (SE-7). With them the error is logged by
// class name only, like every other error.
//
// Node 26 process docs (github.com/nodejs/node, v26.x, doc/api/process.md): with no 'unhandledRejection' listener the
// rejection is raised as an uncaught exception; a listener takes over. "Adding a handler for the 'uncaughtException'
// event overrides this default" (print the stack, exit 1), and "it is not safe to resume normal operation after
// 'uncaughtException'".
import type { Logger } from "@unset/shared-log";

type Proc = Pick<NodeJS.Process, "on" | "kill" | "exit" | "pid">;

/**
 * An unhandled rejection is logged and the server drains as on SIGTERM (shared/http shutdown.ts), so requests in
 * flight finish and the restart policy starts a fresh process. An uncaught exception is logged and the process exits
 * 1 at once: its state is unknown, so nothing more is served.
 */
export function installFatalHandlers(log: Logger, proc: Proc = process): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    log.logError(reason);
    proc.kill(proc.pid, "SIGTERM");
  });
  proc.on("uncaughtException", (error: unknown) => {
    log.logError(error);
    proc.exit(1);
  });
}
