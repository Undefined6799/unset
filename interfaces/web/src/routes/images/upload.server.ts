// A member's picture upload (ADR 0070 point 2, stages 1, 2 and 4; ADR 0076's numbers): web's intake around the
// review process and the private store. The route (+server.ts) has passed the gate: a signed-in member, the CSRF
// gate and a declared length within the route's cap. Here, in order: uploads open on this stack, one upload per
// member and a few site-wide in memory, the hourly, daily and quota limits before the body is read, then the body,
// review's versions, the row, and the objects. A failure after the row deletes what this upload wrote.
// Once the body is read the rest gets its own time (policy.ts `deadlineMs`), so a slow upload does not leave review
// too little; and review is sent only as many pictures as it decodes at once, so none waits in its queue past web's
// 30 s timeout.
//
// Memory (measured 2026-11-20, Node 26.12, undici's multipart parser): a 64 MiB file read through
// `request.formData()` then `file.arrayBuffer()` peaks at about four copies for one upload and about 510 MiB for four
// at once, and holds one copy (64 MiB) per upload while review works. Four in flight therefore fit web's 1 GB.
import {
  type ImageAdmission,
  type ImageProcessor,
  type ImageRefusal,
  type ImageVersion,
  imageVersions,
  UPLOAD_LIMITS,
} from "@unset/domains-content";

/** The member's image rows, bound to their DID; each call ends at the deadline it is given (imageStore). */
export type ImageRows = {
  readonly admit: (deadline: AbortSignal) => Promise<ImageAdmission>;
  readonly store: (
    image: { kind: "image"; width: number; height: number; bytes: number },
    deadline: AbortSignal,
  ) => Promise<{ ok: true; id: string } | { ok: false; code: "image.quota" }>;
  readonly discard: (id: string, deadline: AbortSignal) => Promise<boolean>;
};

/** The private store under the member's own prefix, `drafts/<did>/i/` (ADR 0070 point 2.4). */
export type DraftObjects = {
  readonly put: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ ok: boolean }>;
  readonly deletePrefix: (path: string) => Promise<{ ok: boolean }>;
};

export type UploadCode =
  | ImageRefusal
  | Exclude<ImageAdmission, { ok: true }>["code"]
  | "image.quota"
  | "image.closed"
  | "image.one_at_a_time"
  | "image.missing";

export type UploadResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly width: number;
      readonly height: number;
      readonly versions: readonly string[];
    }
  | { readonly ok: false; readonly code: UploadCode };

/** One upload per member and `siteWide` in all, held in this process (ADR 0070 point 4). A slot is always released. */
export function createUploadSlots(siteWide: number) {
  const members = new Set<string>();
  return {
    take(member: string): "ok" | "image.one_at_a_time" | "image.busy" {
      if (members.has(member)) return "image.one_at_a_time";
      if (members.size >= siteWide) return "image.busy";
      members.add(member);
      return "ok";
    },
    release(member: string): void {
      members.delete(member);
    },
  };
}

export type UploadSlots = ReturnType<typeof createUploadSlots>;

/**
 * Review's lanes: at most `lanes` pictures sent at once, the rest waiting here in order. Review decodes REVIEW_CHILDREN
 * at once and makes the rest wait on its own 20 s job clock, so a picture queued there could outlast web's 30 s
 * timeout; waiting here, it waits on this request's own deadline instead. `enter` resolves false if that ends first.
 */
export function createReviewLanes(lanes: number) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  return {
    async enter(deadline: AbortSignal): Promise<boolean> {
      if (deadline.aborted) return false;
      if (busy < lanes) {
        busy += 1;
        return true;
      }
      return new Promise((resolve) => {
        const turn = () => {
          deadline.removeEventListener("abort", giveUp);
          resolve(true); // `leave` passed its lane on, so busy is unchanged
        };
        const giveUp = () => {
          waiting.splice(waiting.indexOf(turn), 1);
          resolve(false);
        };
        waiting.push(turn);
        deadline.addEventListener("abort", giveUp, { once: true });
      });
    },
    leave(): void {
      const next = waiting.shift();
      if (next === undefined) busy -= 1;
      else next();
    },
  };
}

export type ReviewLanes = ReturnType<typeof createReviewLanes>;

const CONTENT_TYPES: Readonly<Record<ImageVersion["format"], string>> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export type UploadDeps = {
  readonly open: boolean;
  readonly member: string;
  readonly slots: UploadSlots;
  readonly lanes: ReviewLanes;
  readonly rows: ImageRows;
  readonly processor: ImageProcessor;
  readonly objects: DraftObjects;
  /** The request's own deadline, which covers the body's window and the work after it. */
  readonly deadline: AbortSignal;
  /** The time review and the store get once the body is read (policy.ts `deadlineMs`). */
  readonly afterBodyMs: number;
};

const TIMEOUT: UploadResult = { ok: false, code: "image.timeout" };

/** The whole intake; `readFile` reads the body only once every check before it has passed. */
export async function uploadImage(deps: UploadDeps, readFile: () => Promise<Uint8Array | null>): Promise<UploadResult> {
  if (!deps.open) return { ok: false, code: "image.closed" };
  const slot = deps.slots.take(deps.member);
  if (slot !== "ok") return { ok: false, code: slot };
  try {
    const admission = await deps.rows.admit(deps.deadline);
    if (!admission.ok) return { ok: false, code: admission.code };
    const bytes = await readFile();
    if (bytes === null) return { ok: false, code: "image.missing" };
    const deadline = AbortSignal.any([deps.deadline, AbortSignal.timeout(deps.afterBodyMs)]);
    return await answerBy(deadline, afterBody(deps, bytes, deadline));
  } finally {
    deps.slots.release(deps.member);
  }
}

/**
 * The work's answer, or a timeout once the deadline ends, so the member hears before the edge stops waiting. Work
 * still running stops at its next call, which takes the same deadline; a row it stored meanwhile is the sweep's.
 */
function answerBy(deadline: AbortSignal, work: Promise<UploadResult>): Promise<UploadResult> {
  if (deadline.aborted) return Promise.resolve(TIMEOUT);
  const ended = new Promise<UploadResult>((resolve) =>
    deadline.addEventListener("abort", () => resolve(TIMEOUT), { once: true }),
  );
  return Promise.race([work, ended]);
}

/** Review, in its turn, then the row and objects. */
async function afterBody(deps: UploadDeps, bytes: Uint8Array, deadline: AbortSignal): Promise<UploadResult> {
  if (!(await deps.lanes.enter(deadline))) return TIMEOUT;
  let processed: Awaited<ReturnType<ImageProcessor["process"]>>;
  try {
    processed = await deps.processor.process(bytes, UPLOAD_LIMITS, imageVersions());
  } finally {
    deps.lanes.leave();
  }
  if (processed.kind === "refused") return { ok: false, code: processed.code };
  if (deadline.aborted) return TIMEOUT;
  return await keep(deps, processed.versions, deadline);
}

/** The row first, so the quota decides before anything is written; then every version, or none of them. */
async function keep(deps: UploadDeps, versions: readonly ImageVersion[], deadline: AbortSignal): Promise<UploadResult> {
  const main = versions.find((version) => version.name === "main");
  if (main === undefined) return { ok: false, code: "image.cannot_use" };
  const bytes = versions.reduce((sum, version) => sum + version.bytes.length, 0);
  const row = await deps.rows.store({ kind: "image", width: main.width, height: main.height, bytes }, deadline);
  if (!row.ok) return row;
  for (const version of versions) {
    const path = `${row.id}/${version.name}.${version.format}`;
    const put = await deps.objects.put(path, version.bytes, CONTENT_TYPES[version.format]);
    if (!put.ok) {
      // The row goes only once its objects have: otherwise the sweep finds it after a day and deletes both.
      const cleared = await deps.objects.deletePrefix(`${row.id}/`);
      if (cleared.ok) await deps.rows.discard(row.id, deadline);
      return { ok: false, code: "image.busy" };
    }
  }
  return { ok: true, id: row.id, width: main.width, height: main.height, versions: versions.map((v) => v.name) };
}
