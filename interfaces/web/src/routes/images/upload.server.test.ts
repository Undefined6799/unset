// The upload intake (ADR 0070 points 2 and 4) over stand-ins for the rows, review and the store: the order of the
// checks, the one-per-member and site-wide slots, and that a failure leaves nothing behind. Types are read off the
// module under test, since a test beside a route imports no domain.
import { describe, expect, test } from "vitest";
import {
  createReviewLanes,
  createUploadSlots,
  type DraftObjects,
  type ImageRows,
  type UploadDeps,
  uploadImage,
} from "./upload.server.ts";

type Processor = UploadDeps["processor"];
type Result = Awaited<ReturnType<Processor["process"]>>;
type Version = Extract<Result, { kind: "ok" }>["versions"][number];

const version = (name: string, format: Version["format"], width: number, height: number, size = 10): Version => ({
  name,
  format,
  width,
  height,
  bytes: new Uint8Array(size),
  sha256: "0".repeat(64),
});
const VERSIONS = [version("main", "jpeg", 2560, 1707, 1000), version("w480", "webp", 480, 320)];
const OK: Result = { kind: "ok", source: { format: "jpeg", width: 6000, height: 4000 }, versions: VERSIONS };

type Over = {
  rows?: Partial<ImageRows>;
  result?: Result;
  process?: () => Promise<Result>;
  put?: boolean;
  clear?: boolean;
  afterBodyMs?: number;
  lanes?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stack(over: Over = {}) {
  const calls = { read: 0, processed: 0, puts: [] as string[], cleared: [] as string[], discarded: [] as string[] };
  const stored: unknown[] = [];
  const rows: ImageRows = {
    admit: async () => ({ ok: true }),
    store: async (image) => {
      stored.push(image);
      return { ok: true, id: "img-1" };
    },
    discard: async (id) => {
      calls.discarded.push(id);
      return true;
    },
    ...over.rows,
  };
  const objects: DraftObjects = {
    put: async (path) => {
      calls.puts.push(path);
      return { ok: over.put ?? true };
    },
    deletePrefix: async (path) => {
      calls.cleared.push(path);
      return { ok: over.clear ?? true };
    },
  };
  const processor: Processor = {
    process: async () => {
      calls.processed += 1;
      return over.process ? over.process() : (over.result ?? OK);
    },
  };
  const slots = createUploadSlots(4);
  const lanes = createReviewLanes(over.lanes ?? 2);
  const request = new AbortController();
  const deps = (member = "did:plc:a", open = true): UploadDeps => ({
    open,
    member,
    slots,
    lanes,
    rows,
    processor,
    objects,
    deadline: request.signal,
    afterBodyMs: over.afterBodyMs ?? 10_000,
  });
  const read = async () => {
    calls.read += 1;
    return new Uint8Array(60_000_000);
  };
  return { calls, stored, deps, read, slots, request };
}

describe("image upload intake", () => {
  test("upload.stores_every_version_under_its_row", async () => {
    const s = stack();
    expect(await uploadImage(s.deps(), s.read)).toEqual({
      ok: true,
      id: "img-1",
      width: 2560,
      height: 1707,
      versions: ["main", "w480"],
    });
    expect(s.stored).toEqual([{ kind: "image", width: 2560, height: 1707, bytes: 1010 }]);
    expect(s.calls.puts).toEqual(["img-1/main.jpeg", "img-1/w480.webp"]);
  });

  test("upload.closed_stack_reads_nothing", async () => {
    const s = stack();
    expect(await uploadImage(s.deps("did:plc:a", false), s.read)).toEqual({ ok: false, code: "image.closed" });
    expect(s.calls.read).toBe(0);
  });

  // The numbers themselves, and that a busy day fits inside them, are domains/content library.test.ts and
  // tests/integration/postgres/image-store.test.ts; here, that each refusal stops the upload before its body.
  test.each(["image.hourly_limit", "image.daily_limit", "image.quota"] as const)(
    "upload.limits_refuse_before_the_body_is_read: %s",
    async (code) => {
      const s = stack({ rows: { admit: async () => ({ ok: false, code }) } });
      expect(await uploadImage(s.deps(), s.read)).toEqual({ ok: false, code });
      expect(s.calls.read).toBe(0);
    },
  );

  test("upload.one_at_a_time_per_member_and_four_site_wide", async () => {
    const s = stack();
    let finish: (bytes: Uint8Array) => void = () => undefined;
    const slow = () => new Promise<Uint8Array>((resolve) => (finish = resolve));
    const first = uploadImage(s.deps("did:plc:a"), slow);
    await Promise.resolve();
    // A double click: the same member's second upload is refused, and reads nothing.
    expect(await uploadImage(s.deps("did:plc:a"), s.read)).toEqual({ ok: false, code: "image.one_at_a_time" });
    for (const member of ["did:plc:b", "did:plc:c", "did:plc:d"]) expect(s.slots.take(member)).toBe("ok");
    expect(await uploadImage(s.deps("did:plc:e"), s.read)).toEqual({ ok: false, code: "image.busy" });
    expect(s.calls.read).toBe(0);
    finish(new Uint8Array(1));
    expect((await first).ok).toBe(true);
    // The slot is free again once the upload has answered.
    expect(await uploadImage(s.deps("did:plc:a"), s.read)).toMatchObject({ ok: true });
  });

  test("upload.normal_use_fits: one member uploading pictures one after another is never refused", async () => {
    const s = stack();
    for (let i = 0; i < 20; i += 1) expect((await uploadImage(s.deps(), s.read)).ok).toBe(true);
  });

  test("upload.slot_is_released_when_the_body_fails", async () => {
    const s = stack();
    await expect(uploadImage(s.deps(), () => Promise.reject(new TypeError("aborted")))).rejects.toThrow(TypeError);
    expect(await uploadImage(s.deps(), s.read)).toMatchObject({ ok: true });
  });

  test("upload.refusals_from_review_and_quota_write_nothing", async () => {
    const refused = stack({ result: { kind: "refused", code: "image.unsupported" } });
    expect(await uploadImage(refused.deps(), refused.read)).toEqual({ ok: false, code: "image.unsupported" });
    expect(refused.stored).toEqual([]);
    const full = stack({ rows: { store: async () => ({ ok: false, code: "image.quota" }) } });
    expect(await uploadImage(full.deps(), full.read)).toEqual({ ok: false, code: "image.quota" });
    expect(full.calls.puts).toEqual([]);
    const missing = stack();
    expect(await uploadImage(missing.deps(), async () => null)).toEqual({ ok: false, code: "image.missing" });
    expect(missing.calls.processed).toBe(0);
  });

  test("upload.store_failure_removes_what_it_wrote", async () => {
    const s = stack({ put: false });
    expect(await uploadImage(s.deps(), s.read)).toEqual({ ok: false, code: "image.busy" });
    expect(s.calls.cleared).toEqual(["img-1/"]);
    expect(s.calls.discarded).toEqual(["img-1"]);
  });

  test("upload.row_stays_for_the_sweep_when_its_objects_could_not_go", async () => {
    const s = stack({ put: false, clear: false });
    expect(await uploadImage(s.deps(), s.read)).toEqual({ ok: false, code: "image.busy" });
    expect(s.calls.discarded).toEqual([]);
  });

  // ADR 0076: a 64 MiB picture on a slow link takes most of the body window; review and the store still get their own.
  test("upload.slow_body_leaves_review_its_own_time", async () => {
    const s = stack({ afterBodyMs: 40 });
    const slowBody = async () => {
      await sleep(60);
      return new Uint8Array(1);
    };
    expect(await uploadImage(s.deps(), slowBody)).toMatchObject({ ok: true });
  });

  // Review of #1844: a review call past the deadline still holds the body, so its slot stays taken until it ends.
  test("upload.timeout_answers_at_the_deadline_and_keeps_the_slot_until_review_ends", async () => {
    let finish: (result: Result) => void = () => undefined;
    const s = stack({ afterBodyMs: 30, process: () => new Promise<Result>((resolve) => (finish = resolve)) });
    const started = performance.now();
    expect(await uploadImage(s.deps(), s.read)).toEqual({ ok: false, code: "image.timeout" });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(await uploadImage(s.deps(), s.read)).toEqual({ ok: false, code: "image.one_at_a_time" });
    finish({ kind: "refused", code: "image.busy" });
    await sleep(0);
    expect(s.slots.take("did:plc:a")).toBe("ok");
  });

  // Review of #1840: four in flight, review decodes two; the others wait in web, not on review's job clock.
  test("upload.review_gets_no_more_than_its_lanes_and_the_rest_wait_their_turn", async () => {
    let open = 0;
    let most = 0;
    const s = stack({
      lanes: 2,
      process: async () => {
        open += 1;
        most = Math.max(most, open);
        await sleep(20);
        open -= 1;
        return OK;
      },
    });
    const all = ["did:plc:a", "did:plc:b", "did:plc:c", "did:plc:d"].map((member) =>
      uploadImage(s.deps(member), s.read),
    );
    const results = await Promise.all(all);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(most).toBe(2);
  });

  test("upload.a_wait_for_review_ends_with_the_deadline", async () => {
    const s = stack({ lanes: 1, afterBodyMs: 30, process: () => new Promise<Result>(() => undefined) });
    const first = uploadImage(s.deps("did:plc:a"), s.read);
    const second = uploadImage(s.deps("did:plc:b"), s.read);
    expect(await second).toEqual({ ok: false, code: "image.timeout" });
    expect(await first).toEqual({ ok: false, code: "image.timeout" });
  });
});
