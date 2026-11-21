// The privacy save waits, a few seconds at most, until the index (which the public page reads) has the member's new
// choice (staging break test 2026-11-21, second pass: the page still showed for about 2 s after "Privacy saved").
import { expect, test } from "vitest";
import { ANSWER_MS, type CatchUpDeps, publicPageShows } from "./index-catch-up.ts";

/** A clock that only moves when the wait sleeps, and an index that answers from a list, one read at a time. */
function world(answers: readonly unknown[]) {
  let at = 0;
  let reads = 0;
  const deps: CatchUpDeps = {
    read: async () => answers[Math.min(reads++, answers.length - 1)],
    now: () => at,
    sleep: async (ms) => {
      at += ms;
    },
    signal: new AbortController().signal,
    deadlineAt: 30_000,
  };
  return { deps, reads: () => reads, elapsed: () => at };
}

const record = (visibility?: string) => ({
  $type: "sh.unset.profile",
  displayName: "Ada",
  ...(visibility ? { visibility } : {}),
});

test("answers at once when the index already has the choice", async () => {
  const w = world([record("ownerOnly")]);
  expect(await publicPageShows("ownerOnly", w.deps)).toBe(true);
  expect(w.reads()).toBe(1);
});

test("waits until the index has the choice", async () => {
  const w = world([record(), record(), record("signedIn")]);
  expect(await publicPageShows("signedIn", w.deps)).toBe(true);
  expect(w.reads()).toBe(3);
});

test("public is what a record without a visibility means", async () => {
  expect(await publicPageShows("public", world([record()]).deps)).toBe(true);
});

test("an account the index does not show has nothing to catch up", async () => {
  expect(await publicPageShows("ownerOnly", world([null]).deps)).toBe(true);
});

test("gives up after a few seconds, so the save still answers", async () => {
  const w = world([record()]);
  expect(await publicPageShows("ownerOnly", w.deps)).toBe(false);
  expect(w.elapsed()).toBeLessThanOrEqual(5_000);
});

test("stops when the request's deadline ends, and a failed read counts as not caught up", async () => {
  const stopped = new AbortController();
  stopped.abort();
  const w = world([record()]);
  expect(await publicPageShows("ownerOnly", { ...w.deps, signal: stopped.signal })).toBe(false);
  const failing = world([]);
  expect(
    await publicPageShows("ownerOnly", {
      ...failing.deps,
      read: async () => {
        throw new Error("down");
      },
    }),
  ).toBe(false);
});

test("ends early enough that the request still answers inside its deadline", async () => {
  // With less than CATCH_UP_MS left, the wait stops ANSWER_MS before the deadline, so the redirect is sent instead of
  // the hooks' 503 (Codex review of #1906).
  const w = world([record()]);
  expect(await publicPageShows("ownerOnly", { ...w.deps, deadlineAt: 2_000 })).toBe(false);
  expect(w.elapsed()).toBeLessThanOrEqual(2_000 - ANSWER_MS);
  const late = world([record("ownerOnly")]);
  expect(await publicPageShows("ownerOnly", { ...late.deps, deadlineAt: ANSWER_MS })).toBe(false);
  expect(late.reads()).toBe(0);
});

test("a fractional clock, as performance.now() reads, still waits and answers", async () => {
  // Codex review of #1906: AbortSignal.timeout throws on a fractional delay.
  const w = world([record(), record("ownerOnly")]);
  let at = 0.25;
  const sleep = async (ms: number) => {
    at += ms + 0.375;
  };
  const deps = { ...w.deps, now: () => at, sleep, deadlineAt: 9_999.5 };
  expect(await publicPageShows("ownerOnly", deps)).toBe(true);
});

test("a read still in flight at the cutoff is not waited for", async () => {
  // Codex review of #1906: the store's query may outlive its signal, so the wait must not hang on it.
  const w = world([]);
  const start = performance.now();
  const deps = { ...w.deps, now: () => performance.now() - start, deadlineAt: ANSWER_MS + 50 };
  const hanging = { ...deps, read: () => new Promise<unknown>(() => undefined) };
  expect(await publicPageShows("ownerOnly", hanging)).toBe(false);
  expect(performance.now() - start).toBeLessThan(1_000);
});
