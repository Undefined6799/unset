// The PR-time scan of newly pinned runtime images (P1.34m, record
// unset-plan/book-edits/2026-10-13-p134m-pr-scan-new-runtime-pins.md): only the runtime lock entries whose
// ref:tag@digest or stripped set differs from the base branch's lock are scanned; unchanged and removed entries are
// not, so mirror.yml keeps the standing scan of every pin.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { changedRuntimePins } from "./runtime-pins.ts";

const sha = (n: number) => `sha256:${String(n).repeat(64)}`;
const entry = (n: number, extra: Record<string, unknown> = {}) => ({
  ref: `docker.io/library/r${n}`,
  tag: "1",
  digest: sha(n),
  source: "upstream",
  stage: "runtime",
  buildStage: false,
  ...extra,
});
const source = (n: number) => `docker.io/library/r${n}:1@${sha(n)}`;

describe("changed runtime pins", () => {
  test("selects_only_new_or_changed_runtime_pins", () => {
    const base = {
      kept: entry(1),
      bumped: entry(2),
      removed: entry(3),
      narrowed: entry(4, { stripped: ["/usr/local/a"] }),
    };
    const head = {
      kept: entry(1),
      bumped: entry(5),
      added: entry(6),
      narrowed: entry(4, { stripped: ["/usr/local/a", "/usr/local/b"] }),
      builder: entry(7, { stage: "build" }),
    };
    expect(changedRuntimePins(base, head)).toEqual([
      { source: source(5), stripped: [] },
      { source: source(6), stripped: [] },
      { source: source(4), stripped: ["/usr/local/a", "/usr/local/b"] },
    ]);
  });

  test("a_digest_or_tag_change_alone_is_selected", () => {
    // Renovate re-pins a digest under the same tag, or moves the tag to an image it already pinned by digest; either
    // change alone selects the pin, and so does a ref change alone.
    const base = { x: entry(1) };
    expect(changedRuntimePins(base, { x: entry(1, { digest: sha(2) }) })).toEqual([
      { source: `docker.io/library/r1:1@${sha(2)}`, stripped: [] },
    ]);
    expect(changedRuntimePins(base, { x: entry(1, { tag: "2" }) })).toEqual([
      { source: `docker.io/library/r1:2@${sha(1)}`, stripped: [] },
    ]);
    expect(changedRuntimePins(base, { x: entry(1, { ref: "docker.io/library/q1" }) })).toEqual([
      { source: `docker.io/library/q1:1@${sha(1)}`, stripped: [] },
    ]);
  });

  test("a_pin_moved_to_runtime_is_selected", () => {
    expect(changedRuntimePins({ x: entry(1, { stage: "build" }) }, { x: entry(1) })).toEqual([
      { source: source(1), stripped: [] },
    ]);
  });

  test("stripped_order_alone_is_no_change", () => {
    const base = { x: entry(1, { stripped: ["/usr/local/b", "/usr/local/a"] }) };
    expect(changedRuntimePins(base, { x: entry(1, { stripped: ["/usr/local/a", "/usr/local/b"] }) })).toEqual([]);
  });

  test("malformed_lock_fails_closed", () => {
    for (const bad of [
      [],
      null,
      { x: entry(1, { digest: "sha256:short" }) },
      { x: entry(1, { stripped: "/usr/local/a" }) },
    ]) {
      expect(() => changedRuntimePins({}, bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => changedRuntimePins({ x: { ...entry(1), tag: 2 } }, {})).toThrow();
    // A stage is exactly "runtime" or "build": a missing, non-string or differently spelled stage is refused, never
    // read as build-only and skipped. A null stripped list is refused, not read as none.
    for (const bad of [
      { stage: 1 },
      { stage: undefined },
      { stage: "Runtime" },
      { stage: "runtime " },
      { stripped: null },
    ]) {
      expect(() => changedRuntimePins({}, { x: entry(1, bad) }), JSON.stringify(bad)).toThrow();
    }
    // The selection reaches shell arguments and log lines, so a ref, tag or path that could carry a newline, a
    // workflow command or a glob is refused rather than passed on, even on a build-only entry.
    for (const bad of [
      { ref: "docker.io/library/r\n::stop-commands::x" },
      { ref: "Docker.io/library/r" },
      { tag: "1 2" },
      { tag: "-1" },
      { stripped: ["/usr/local/bin/*"] },
      { stripped: ["relative/path/x"] },
      { stripped: ["/usr/../etc/x"] },
      { stage: "build", ref: "docker.io/$(id)" },
    ]) {
      expect(() => changedRuntimePins({}, { x: entry(1, bad) }), JSON.stringify(bad)).toThrow();
    }
    expect(
      changedRuntimePins({}, { x: entry(1, { ref: "ghcr.io/bluesky-social/pds", tag: "0.4.5037" }) }),
    ).toHaveLength(1);
  });

  test("cli_reads_a_missing_base_as_empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-pins-"));
    writeFileSync(join(dir, "head.json"), JSON.stringify({ x: entry(1) }));
    const cli = join(import.meta.dirname, "runtime-pins.ts");
    const ran = spawnSync(process.execPath, [cli, join(dir, "absent.json"), join(dir, "head.json")], {
      encoding: "utf8",
    });
    expect(ran.status, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual([{ source: source(1), stripped: [] }]);
    // A missing head lock is an error, never an empty selection.
    const none = spawnSync(process.execPath, [cli, join(dir, "head.json"), join(dir, "absent.json")], {
      encoding: "utf8",
    });
    expect(none.status).not.toBe(0);
  });
});
