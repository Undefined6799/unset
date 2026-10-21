// Vitest5.0.4 run.Cm2sd7-x.js:3354-3369,3405-3407,3919: timeout aborts
// context.signal; onTestFinished is awaited independently of startup returning.
import { setTimeout as delay } from "node:timers/promises";
import { fixtureProcess } from "./fixture-process.ts";

export const FIXTURE_TEST_MS = 240_000;
export type FixtureContext = {
  signal: AbortSignal;
  onTestFinished: (fn: () => Promise<void>, timeout?: number) => void;
};
type Cleanup = (signal: AbortSignal) => void | Promise<void>;
export class FixtureLifetime {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: Cleanup[] = [];
  private closing?: Promise<void>;
  private readonly cleanupMs: number;
  constructor(ctx: FixtureContext, budgetMs = 180_000, cleanupMs = 50_000) {
    this.cleanupMs = cleanupMs;
    this.deadline = Date.now() + budgetMs;
    this.signal = AbortSignal.any([ctx.signal, this.controller.signal]);
    this.timer = setTimeout(() => this.controller.abort(new Error("fixture lifecycle deadline exceeded")), budgetMs);
    ctx.onTestFinished(() => this.close(), 60_000);
  }
  check(signal = this.signal) {
    if (Date.now() >= this.deadline) this.controller.abort(new Error("fixture lifecycle deadline exceeded"));
    this.signal.throwIfAborted();
    signal.throwIfAborted();
  }
  defer(cleanup: Cleanup) {
    this.check();
    this.cleanups.push(cleanup);
  }
  track<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const operation = Promise.resolve()
      .then(() => {
        this.check();
        return work(this.signal);
      })
      .then((value) => {
        this.check();
        return value;
      })
      .finally(() => this.pending.delete(operation));
    this.pending.add(operation);
    return operation;
  }
  command(file: string, args: readonly string[], timeoutMs: number, input?: string, signal = this.signal) {
    return this.track(() => {
      this.check(signal);
      return fixtureProcess(
        file,
        args,
        AbortSignal.any([this.signal, signal]),
        Math.max(1, Math.min(timeoutMs, this.deadline - Date.now())),
        input,
      );
    });
  }
  wait(ms: number, signal = this.signal): Promise<void> {
    return this.track(() => delay(ms, undefined, { signal: AbortSignal.any([this.signal, signal]) }));
  }
  poll<T>(stage: string, attempt: (signal: AbortSignal) => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
    return this.track(async () => {
      const signal = AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        for (;;) {
          this.check(signal);
          const value = await attempt(signal);
          this.check(signal);
          if (value !== null) return value;
          await this.wait(100, signal);
        }
      } catch (failure) {
        if (signal.aborted) throw new Error(`fixture ${stage} canceled or timed out`);
        throw failure;
      }
    });
  }
  close(): Promise<void> {
    this.closing ??= this.finish();
    return this.closing;
  }
  private async finish() {
    clearTimeout(this.timer);
    this.controller.abort(new Error("fixture closed"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("fixture cleanup deadline exceeded")), this.cleanupMs);
    const failures: unknown[] = [];
    let abort: () => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("fixture cleanup deadline exceeded"));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      try {
        await Promise.race([Promise.allSettled([...this.pending]), deadline]);
      } catch (failure) {
        failures.push(failure);
      }
      for (const cleanup of this.cleanups.reverse()) {
        try {
          await Promise.race([Promise.resolve().then(() => cleanup(controller.signal)), deadline]);
        } catch (failure) {
          failures.push(failure);
        }
      }
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
    }
    if (failures.length) throw new AggregateError(failures, "fixture cleanup failed");
  }
  async fail(failure: unknown): Promise<never> {
    try {
      await this.close();
    } catch (cleanupFailure) {
      throw new AggregateError([failure, cleanupFailure], "fixture failed; cleanup also failed");
    }
    throw failure;
  }
}
