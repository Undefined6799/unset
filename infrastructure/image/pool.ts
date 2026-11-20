// The processing stage's pool (ADR 0070 point 2.2; book P2.17 "the pool"): a fixed number of child processes, a
// bounded queue, and SIGKILL plus a fresh child on a timeout or a crash. Worker threads are not used: a native fault
// in libvips would take the whole process down, and terminating a worker does not stop sharp work already on the
// libuv threadpool (review r1-part2 F7).
//
// A child says it is ready once sharp has loaded and its loaders are locked down, and only a ready child gets a job.
// A child that dies before it is ready, or while idle, counts as a failed start: the slot waits 250 ms, then twice
// as long each time up to 30 s, so a pool whose children cannot start (prlimit or sharp missing, an address space too
// small) never forks in a tight loop. After three failed starts in a row in every slot the pool is down: it answers
// busy at once and empties its queue, and comes back up when a child is ready again. A crash or a timeout during a
// job replaces the child at once, since the job, not the child, is the likely cause.
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
  /** For the caller's log: a child failed to start, the pool went down, or came back up. Carries nothing else. */
  readonly onEvent?: (event: PoolEvent) => void;
};

export type PoolEvent = "start_failed" | "down" | "up";

type Job = Omit<JobMessage, "id"> & { readonly done: (result: ProcessResult) => void };
type Slot = {
  child: ChildProcess | null;
  ready: boolean;
  failures: number;
  restart: NodeJS.Timeout | null;
  busy: { id: number; job: Job; timer: NodeJS.Timeout } | null;
};
type ChildMessage = { readonly ready: true } | { readonly id: number; readonly result: JobResult };

const PRLIMIT = "/usr/bin/prlimit";
const FIRST_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;
/** Failed starts in a row after which a slot counts as down. */
const DOWN_AFTER = 3;

export function createImagePool(options: PoolOptions): ImageProcessor & { close(): void } {
  const childPath = options.childPath ?? new URL("./child.ts", import.meta.url).pathname;
  const waiting: Job[] = [];
  let nextId = 1;
  let closed = false;
  let down = false;

  const spawnChild = (): ChildProcess =>
    fork(childPath, [], {
      env: {},
      execPath: PRLIMIT,
      execArgv: [`--as=${options.addressSpaceMb * 1024 * 1024}`, "--", process.execPath],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

  const slots: Slot[] = Array.from({ length: options.children }, () => ({
    child: null,
    ready: false,
    failures: 0,
    restart: null,
    busy: null,
  }));

  function start(slot: Slot): void {
    slot.restart = null;
    if (closed) return;
    const child = spawnChild();
    slot.child = child;
    slot.ready = false;
    child.on("message", (message: ChildMessage) => {
      if (slot.child !== child) return;
      if ("ready" in message) {
        slot.ready = true;
        slot.failures = 0;
        updateDown();
        dispatch();
      } else if (slot.busy?.id === message.id) {
        finish(slot, toProcessResult(message.result, slot.busy.job), false);
      }
    });
    const died = () => {
      if (slot.child !== child) return;
      if (slot.busy !== null) {
        finish(slot, { kind: "refused", code: "image.cannot_use" }, true);
        return;
      }
      stop(slot);
      slot.failures += 1;
      options.onEvent?.("start_failed");
      updateDown();
      const delay = Math.min(FIRST_BACKOFF_MS * 2 ** (slot.failures - 1), MAX_BACKOFF_MS);
      slot.restart = setTimeout(() => start(slot), delay);
      slot.restart.unref();
    };
    child.on("exit", died);
    child.on("error", died);
  }

  function stop(slot: Slot): void {
    const child = slot.child;
    slot.child = null;
    slot.ready = false;
    if (child === null) return;
    child.removeAllListeners();
    child.kill("SIGKILL");
  }

  function updateDown(): void {
    const now = slots.every((slot) => !slot.ready && slot.failures >= DOWN_AFTER);
    if (now === down) return;
    down = now;
    options.onEvent?.(down ? "down" : "up");
    if (down) for (const job of waiting.splice(0)) job.done({ kind: "refused", code: "image.busy" });
  }

  function finish(slot: Slot, result: ProcessResult, replace: boolean): void {
    const busy = slot.busy;
    if (busy === null) return;
    clearTimeout(busy.timer);
    slot.busy = null;
    if (replace) {
      stop(slot);
      start(slot);
    }
    busy.job.done(result);
    dispatch();
  }

  function dispatch(): void {
    for (const slot of slots) {
      if (!slot.ready || slot.busy !== null || slot.child === null) continue;
      const job = waiting.shift();
      if (job === undefined) return;
      const id = nextId++;
      const timer = setTimeout(() => finish(slot, { kind: "refused", code: "image.timeout" }, true), options.timeoutMs);
      slot.busy = { id, job, timer };
      const { done: _done, ...message } = job;
      slot.child.send({ id, ...message } satisfies JobMessage);
    }
  }

  for (const slot of slots) start(slot);

  return {
    process(bytes: Uint8Array, limits: ProcessLimits, versions: readonly VersionSpec[]): Promise<ProcessResult> {
      if (bytes.length > limits.maxBytes) return refused("image.too_large");
      const format = sniffImage(bytes);
      if (format === null) return refused("image.unsupported");
      if (format === "animated") return refused("image.animated");
      if (closed || down || waiting.length >= options.queueMax) return refused("image.busy");
      return new Promise((done) => {
        waiting.push({ bytes, format, limits, versions, done });
        dispatch();
      });
    },
    close(): void {
      closed = true;
      for (const slot of slots) {
        if (slot.restart !== null) clearTimeout(slot.restart);
        if (slot.busy !== null) clearTimeout(slot.busy.timer);
        stop(slot);
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
