// The processing stage's pool (ADR 0070 point 2.2; book P2.17 "the pool"): a fixed number of child processes, a
// bounded queue, and SIGKILL plus a fresh child on a timeout or a crash. Worker threads are not used: a native fault
// in libvips would take the whole process down, and terminating a worker does not stop sharp work already on the
// libuv threadpool (review r1-part2 F7).
//
// A child says it is ready once sharp has loaded and its loaders are locked down, and only a ready child gets a job.
// A child that dies before it is ready or while idle, or is not ready within the start timeout (a hang while sharp
// or libvips loads), counts as a failed start: the slot waits 250 ms, then twice
// as long each time up to 30 s, so a pool whose children cannot start (prlimit or sharp missing, an address space too
// small) never forks in a tight loop. After three failed starts in a row in every slot the pool is down: it answers
// busy at once and empties its queue, and comes back up when a child is ready again. A crash or a timeout during a
// job replaces the child at once, since the job, not the child, is the likely cause.
import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  ImageProcessor,
  ImageRefusal,
  ImageVersion,
  ProcessLimits,
  ProcessResult,
  VersionSpec,
} from "@unset/domains-content";
import type { JobMessage } from "./child.ts";
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
  /** How long a new child may take to say it is ready before it is killed as a failed start (default 10 s). */
  readonly startTimeoutMs?: number;
  /** For the caller's log: a child was ready, failed to start, the pool went down or came back up. Nothing else. */
  readonly onEvent?: (event: PoolEvent) => void;
};

export type PoolEvent = "ready" | "start_failed" | "down" | "up";

type Job = Omit<JobMessage, "id"> & { readonly done: (result: ProcessResult) => void };
type Slot = {
  child: ChildProcess | null;
  ready: boolean;
  failures: number;
  restart: NodeJS.Timeout | null;
  /** Runs from fork until the child says it is ready. */
  starting: NodeJS.Timeout | null;
  busy: { id: number; job: Job; timer: NodeJS.Timeout } | null;
};

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
    starting: null,
    busy: null,
  }));

  function start(slot: Slot): void {
    slot.restart = null;
    if (closed) return;
    const child = spawnChild();
    slot.child = child;
    slot.ready = false;
    slot.starting = setTimeout(() => failedStart(slot), options.startTimeoutMs ?? 10_000);
    slot.starting.unref();
    child.on("message", (message: unknown) => {
      if (slot.child !== child) return;
      // A taken-over child can send anything: a message that is not one of the two shapes ends the child (and its
      // job, as cannot_use) rather than throwing in the parent.
      if (!isRecord(message)) {
        failChild(slot);
        return;
      }
      if (message.ready === true) {
        clearStarting(slot);
        slot.ready = true;
        slot.failures = 0;
        options.onEvent?.("ready");
        updateDown();
        dispatch();
      } else if (slot.busy !== null && slot.busy.id === message.id) {
        const result = toProcessResult(message.result, slot.busy.job);
        // A malformed answer also ends the child; a well-formed refusal leaves it running.
        finish(slot, result ?? { kind: "refused", code: "image.cannot_use" }, result === null);
      } else {
        failChild(slot);
      }
    });
    const died = () => {
      if (slot.child !== child) return;
      if (slot.busy !== null) {
        finish(slot, { kind: "refused", code: "image.cannot_use" }, true);
        return;
      }
      failedStart(slot);
    };
    child.on("exit", died);
    child.on("error", died);
  }

  /** A child that broke the protocol: its job, if any, is cannot_use and it is replaced; idle, it is a failed start. */
  function failChild(slot: Slot): void {
    if (slot.busy !== null) finish(slot, { kind: "refused", code: "image.cannot_use" }, true);
    else failedStart(slot);
  }

  /** A child that died before it was ready or while idle, or never said it was ready: back off, then start again. */
  function failedStart(slot: Slot): void {
    stop(slot);
    slot.failures += 1;
    options.onEvent?.("start_failed");
    updateDown();
    if (closed) return;
    const delay = Math.min(FIRST_BACKOFF_MS * 2 ** (slot.failures - 1), MAX_BACKOFF_MS);
    slot.restart = setTimeout(() => start(slot), delay);
    slot.restart.unref();
  }

  function clearStarting(slot: Slot): void {
    if (slot.starting !== null) clearTimeout(slot.starting);
    slot.starting = null;
  }

  function stop(slot: Slot): void {
    clearStarting(slot);
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
        const busy = slot.busy;
        slot.busy = null;
        if (busy !== null) clearTimeout(busy.timer);
        stop(slot);
        busy?.job.done({ kind: "refused", code: "image.busy" });
      }
      for (const job of waiting.splice(0)) job.done({ kind: "refused", code: "image.busy" });
    },
  };
}

const refused = (code: Extract<ProcessResult, { kind: "refused" }>["code"]): Promise<ProcessResult> =>
  Promise.resolve({ kind: "refused", code });

/**
 * What a child answered, checked as untrusted: an exploited decoder controls its own answer, so the parent recomputes
 * every SHA-256 and accepts only the versions it asked for, each once, within its byte limit and the size it asked
 * for, and only the refusal codes it knows. Anything else is null: the job is `image.cannot_use` and the child is replaced.
 */
function toProcessResult(result: unknown, job: Job): ProcessResult | null {
  const cannot = null;
  if (!isRecord(result)) return cannot;
  if (result.kind === "refused") {
    return REFUSALS.has(result.code as ImageRefusal) ? { kind: "refused", code: result.code as ImageRefusal } : cannot;
  }
  const { width, height } = result;
  if (result.kind !== "ok" || !Array.isArray(result.versions)) return cannot;
  if (!size(width, job.limits.maxEdge) || !size(height, job.limits.maxEdge)) return cannot;
  const specs = new Map(job.versions.map((v) => [`${v.name}.${v.format}`, v]));
  const versions: ImageVersion[] = [];
  for (const v of result.versions as unknown[]) {
    if (!isRecord(v) || typeof v.name !== "string" || typeof v.format !== "string") return cannot;
    const spec = specs.get(`${v.name}.${v.format}`);
    if (spec === undefined || !(v.bytes instanceof Uint8Array) || v.bytes.length === 0) return cannot;
    // `width` bounds only the width, so its height may reach the source's own edge limit.
    const tallest = spec.fit === "width" ? job.limits.maxEdge : spec.size;
    if (!size(v.width, spec.size) || !size(v.height, tallest)) return cannot;
    specs.delete(`${spec.name}.${spec.format}`);
    // The child leaves out an optional version it could not fit; one that arrives over its cap anyway is dropped.
    if (v.bytes.length > spec.maxBytes) {
      if (spec.required) return cannot;
      continue;
    }
    const sha256 = createHash("sha256").update(v.bytes).digest("hex");
    versions.push({ name: spec.name, format: spec.format, width: v.width, height: v.height, bytes: v.bytes, sha256 });
  }
  if ([...specs.values()].some((spec) => spec.required)) return cannot;
  return { kind: "ok", source: { format: job.format, width, height }, versions };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const REFUSALS: ReadonlySet<ImageRefusal> = new Set<ImageRefusal>([
  "image.too_large",
  "image.unsupported",
  "image.too_many_pixels",
  "image.animated",
  "image.cannot_use",
  "image.busy",
  "image.timeout",
]);
/** No version is ever larger than this a side: the largest spec is the 2560 px main version. */
const size = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
