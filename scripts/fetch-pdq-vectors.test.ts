import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { fetchPdqVectors, PDQ_VECTORS, THREATEXCHANGE_COMMIT } from "./fetch-pdq-vectors.ts";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const temps: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "pdq-vectors-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fetchPdqVectors", () => {
  test("vectors_fetched_pinned", async () => {
    const files = await fetchPdqVectors(temp());
    expect([...files.keys()]).toEqual(PDQ_VECTORS.map((v) => v.path));
    for (const { path, sha256: pinned } of PDQ_VECTORS)
      expect(sha256(readFileSync(files.get(path) as string))).toBe(pinned);
  }, 120_000);

  test("downloads_only_at_the_pinned_commit", async () => {
    const urls: string[] = [];
    const record = async (url: string) => {
      urls.push(url);
      return new Uint8Array();
    };
    await expect(fetchPdqVectors(temp(), record)).rejects.toThrow(/is not the pinned/);
    expect(urls[0]).toBe(
      `https://raw.githubusercontent.com/facebook/ThreatExchange/${THREATEXCHANGE_COMMIT}/${PDQ_VECTORS[0]?.path}`,
    );
  });

  test("changed_file_fails_and_is_not_cached", async () => {
    const cache = temp();
    const tampered = new Uint8Array([1, 2, 3]);
    await expect(fetchPdqVectors(cache, async () => tampered)).rejects.toThrow(/is not the pinned/);
    // The tampered bytes were never written under the pinned name, so a later run downloads again.
    let calls = 0;
    const counted = async () => {
      calls++;
      return tampered;
    };
    await expect(fetchPdqVectors(cache, counted)).rejects.toThrow(/is not the pinned/);
    expect(calls).toBe(1);
  });

  test("corrupted_cache_is_downloaded_again", async () => {
    const cache = temp();
    const first = PDQ_VECTORS[0] as (typeof PDQ_VECTORS)[number];
    writeFileSync(join(cache, first.sha256), "not the image");
    let calls = 0;
    const counted = async () => {
      calls++;
      return new Uint8Array();
    };
    await expect(fetchPdqVectors(cache, counted)).rejects.toThrow(/is not the pinned/);
    expect(calls).toBe(1);
  });
});
