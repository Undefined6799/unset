// The processing stage's pool (ADR 0070 point 2.2; book P2.17 "the pool"): a fixed number of child processes, a
// bounded queue, and SIGKILL plus a fresh child on a timeout or a crash. Worker threads are not used: a native fault
// in libvips would take the whole process down, and terminating a worker does not stop sharp work already on the
// libuv threadpool (review r1-part2 F7).
import { type ChildProcess, fork } from "node:child_process";
import type { ImageProcessor, ProcessLimits, ProcessResult, VersionSpec } from "@unset/domains-content";
import type { JobMessage } from "./child.ts";
import type { JobResult } from "./encode.ts";
import { sniffImage } from "./sniff.ts";

export type PoolOptions = {
  readonly children: number;
  /** Jobs waiting for a free child; one more is refused as busy. */
  readonly queueMax: number;
  readonly timeoutMs: number;
  /** RLIMIT_AS for each child, through util-linux `prlimit`. Node itself needs about 2 GiB of address space. */
  readonly addressSpaceMb: number;
  /** Test seam: the child's entry file. */
  readonly childPath?: string;
};

type Job = Omit<JobMessage, "id"> & { readonly done: (result: ProcessResult) => void };
type Slot = { child: ChildProcess; busy: { id: number; job: Job; timer: NodeJS.Timeout } | null };

const PRLIMIT = "/usr/bin/prlimit";

export function createImagePool(options: PoolOptions): ImageProcessor & { close(): void } {
  const childPath = options.childPath ?? new URL("./child.ts", import.meta.url).pathname;
  const waiting: Job[] = [];
  let nextId = 1;
  let closed = false;

  const start = (): ChildProcess =>
    fork(childPath, [], {
      env: {},
      execPath: PRLIMIT,
      execArgv: [`--as=${options.addressSpaceMb * 1024 * 1024}`, "--", process.execPath],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

  const slots: Slot[] = Array.from({ length: options.children }, () => ({ child: start(), busy: null }));

  function finish(slot: Slot, result: ProcessResult, replace: boolean): void {
    const busy = slot.busy;
    if (busy === null) return;
    clearTimeout(busy.timer);
    slot.busy = null;
    if (replace) {
      const dead = slot.child;
      dead.removeAllListeners();
      dead.kill("SIGKILL");
      if (!closed) watch(slot, start());
    }
    busy.job.done(result);
    dispatch();
  }

  function watch(slot: Slot, child: ChildProcess): void {
    slot.child = child;
    child.on("message", (message: { id: number; result: JobResult }) => {
      if (slot.busy?.id === message.id) finish(slot, toProcessResult(message.result, slot.busy.job), false);
    });
    const died = () => {
      if (slot.child !== child) return;
      if (slot.busy !== null) finish(slot, { kind: "refused", code: "image.cannot_use" }, true);
      else if (!closed) watch(slot, start());
    };
    child.on("exit", died);
    child.on("error", died);
  }

  function dispatch(): void {
    for (const slot of slots) {
      const job = slot.busy === null ? waiting.shift() : undefined;
      if (job === undefined) continue;
      const id = nextId++;
      const timer = setTimeout(() => finish(slot, { kind: "refused", code: "image.timeout" }, true), options.timeoutMs);
      slot.busy = { id, job, timer };
      const { done: _done, ...message } = job;
      slot.child.send({ id, ...message } satisfies JobMessage);
    }
  }

  for (const slot of slots) watch(slot, slot.child);

  return {
    process(bytes: Uint8Array, limits: ProcessLimits, versions: readonly VersionSpec[]): Promise<ProcessResult> {
      if (bytes.length > limits.maxBytes) return refused("image.too_large");
      const format = sniffImage(bytes);
      if (format === null) return refused("image.unsupported");
      if (format === "animated") return refused("image.animated");
      if (closed || waiting.length >= options.queueMax) return refused("image.busy");
      return new Promise((done) => {
        waiting.push({ bytes, format, limits, versions, done });
        dispatch();
      });
    },
    close(): void {
      closed = true;
      for (const slot of slots) {
        slot.child.removeAllListeners();
        slot.child.kill("SIGKILL");
      }
      for (const job of waiting.splice(0)) job.done({ kind: "refused", code: "image.busy" });
    },
  };
}

const refused = (code: Extract<ProcessResult, { kind: "refused" }>["code"]): Promise<ProcessResult> =>
  Promise.resolve({ kind: "refused", code });

function toProcessResult(result: JobResult, job: Job): ProcessResult {
  if (result.kind === "refused") return result;
  return {
    kind: "ok",
    source: { format: job.format, width: result.width, height: result.height },
    versions: result.versions,
  };
}
