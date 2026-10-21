import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";
import { FixtureLifetime } from "../../integration/pds-ui/fixture-lifetime.ts";
import { runOrKill } from "../../support/docker.ts";

async function waitForFile(path: string) {
  for (let i = 0; i < 100; i++) {
    if (existsSync(path)) return;
    await delay(10);
  }
  throw new Error("controlled child failed to start");
}

test("cancellation kills slow startup, awaits cleanup and forbids later creation", async (ctx) => {
  const controller = new AbortController();
  let finish: (() => Promise<void>) | undefined;
  const lifetime = new FixtureLifetime({
    signal: controller.signal,
    onTestFinished: (fn) => {
      finish = fn;
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "pds-lifetime-"));
  ctx.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const marker = join(dir, "owned"),
    later = join(dir, "later");
  lifetime.defer(() => {
    rmSync(marker, { force: true });
  });
  const startup = lifetime
    .command(
      process.execPath,
      [
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setTimeout(()=>{},10000)`,
      ],
      5_000,
    )
    .then(() => {
      lifetime.check();
      writeFileSync(later, "created");
    });
  const outcome = startup.then(
    () => null,
    (error: unknown) => error,
  );
  await waitForFile(marker);
  const pid = Number(readFileSync(marker, "utf8"));
  controller.abort(new Error("controlled cancellation"));
  expect(await outcome).toBeInstanceOf(Error);
  expect(finish).toBeDefined();
  const closing = lifetime.close();
  expect(lifetime.close()).toBe(closing);
  await finish?.();
  await closing;
  expect(() => process.kill(pid, 0)).toThrow();
  await delay(30);
  expect(existsSync(marker)).toBe(false);
  expect(existsSync(later)).toBe(false);
});

test("lifetime deadline cancels pending staging before resource creation", async (ctx) => {
  const lifetime = new FixtureLifetime(ctx, 60);
  let created = false;
  const staging = lifetime.wait(5_000).then(() => {
    lifetime.check();
    created = true;
  });
  await expect(staging).rejects.toThrow();
  await lifetime.close();
  expect(lifetime.signal.aborted).toBe(true);
  expect(created).toBe(false);
});

test("phase deadline bounds readiness/mail and no attempt runs after cancellation", async (ctx) => {
  const lifetime = new FixtureLifetime(ctx);
  let attempts = 0;
  await expect(
    lifetime.poll(
      "controlled readiness",
      async (signal) => {
        attempts++;
        await lifetime.wait(5_000, signal);
        return null;
      },
      60,
    ),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
  await lifetime.close();
  await expect(
    lifetime.poll("late mail", async () => {
      attempts++;
      return true;
    }),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
});

test("cleanup preserves primary failure and attempts other removals", async (ctx) => {
  const lifetime = new FixtureLifetime({ signal: ctx.signal, onTestFinished: () => undefined });
  const primary = new Error("startup failed"),
    removal = new Error("removal failed");
  let otherRemoved = false;
  lifetime.defer(() => {
    otherRemoved = true;
  });
  lifetime.defer(() => {
    throw removal;
  });
  await expect(lifetime.fail(primary)).rejects.toMatchObject({
    errors: [primary, expect.objectContaining({ errors: [removal] })],
  });
  expect(otherRemoved).toBe(true);
});

test("Vitest timeout awaits independent fixture cleanup before the next serial test", () => {
  const dir = mkdtempSync(join(tmpdir(), "pds-vitest-timeout-"));
  const marker = join(dir, "owned"),
    pidFile = join(dir, "pid"),
    cleaned = join(dir, "cleaned"),
    late = join(dir, "late");
  const lifetimePath = join(import.meta.dirname, "../../integration/pds-ui/fixture-lifetime.ts");
  const childScript = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'owned');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},10000)`;
  try {
    writeFileSync(
      join(dir, "vitest.config.mjs"),
      `export default { root: ${JSON.stringify(dir)}, test: { include: ['timeout.test.ts'], fileParallelism: false } }`,
    );
    writeFileSync(
      join(dir, "timeout.test.ts"),
      `
      import { test, expect } from 'vitest';
      import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
      import { FixtureLifetime } from ${JSON.stringify(lifetimePath)};
      test('controlled startup timeout', async (ctx) => {
        const life = new FixtureLifetime(ctx, 1500);
        life.defer(() => { rmSync(${JSON.stringify(marker)}, {force:true}); writeFileSync(${JSON.stringify(cleaned)}, 'done'); });
        await life.command(process.execPath, ['-e', ${JSON.stringify(childScript)}], 5000);
        life.check(); writeFileSync(${JSON.stringify(late)}, 'forbidden');
      }, 200);
      test('following serial test sees completed cleanup', () => {
        expect(existsSync(${JSON.stringify(cleaned)})).toBe(true);
        expect(existsSync(${JSON.stringify(marker)})).toBe(false);
        expect(existsSync(${JSON.stringify(late)})).toBe(false);
        const pid=Number(readFileSync(${JSON.stringify(pidFile)}, 'utf8'));
        expect(() => process.kill(pid,0)).toThrow();
      });
    `,
    );
    const result = runOrKill(
      process.execPath,
      [
        join(import.meta.dirname, "../../../node_modules/vitest/vitest.mjs"),
        "run",
        "--fsModuleCache=false",
        "--config",
        join(dir, "vitest.config.mjs"),
        "--reporter=json",
        "--outputFile",
        join(dir, "result.json"),
      ],
      { timeoutMs: 10_000 },
    );
    const report = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as {
      testResults: { assertionResults: { status: string; failureMessages: string[] }[] }[];
    };
    expect(result.code).toBe(1);
    const results = report.testResults.flatMap((file) => file.assertionResults);
    expect(results.map((item) => item.status)).toEqual(["failed", "passed"]);
    expect(results[0]?.failureMessages.join(" ")).toContain("timed out");
    expect(existsSync(late)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("cleanup deadline reports an uncooperative wait and blocks its late continuation", async (ctx) => {
  const lifetime = new FixtureLifetime({ signal: ctx.signal, onTestFinished: () => undefined }, 1000, 50);
  let lateCreation = false,
    removed = false;
  lifetime.defer(() => {
    removed = true;
  });
  const wait = lifetime
    .track(async () => {
      await delay(150);
      return true;
    })
    .then(() => {
      lateCreation = true;
    });
  const observed = wait.catch(() => undefined);
  await delay(10);
  await expect(lifetime.close()).rejects.toThrow("cleanup failed");
  await observed;
  expect(lateCreation).toBe(false);
  expect(removed).toBe(true);
});

import { missingFixtureResource } from "../../integration/pds-ui/fixture-process.ts";

test("cleanup recognizes removed Docker networks without masking daemon failures", () => {
  expect(
    missingFixtureResource({ code: 1, out: "[]", err: "Error response from daemon: network owned-sentinel not found" }),
  ).toBe(true);
  expect(missingFixtureResource({ code: 1, out: "", err: "Error: No such object: owned-sentinel" })).toBe(true);
  expect(missingFixtureResource({ code: 1, out: "", err: "Docker context configuration not found" })).toBe(false);
});
