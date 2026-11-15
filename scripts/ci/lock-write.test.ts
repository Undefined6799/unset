// P2.26l: the bump is written by a script from the lock a publish run verified, never typed by hand.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { bumpedFiles, COMPOSE_PATH, LOCK_PATH } from "./lock-write.ts";
import type { ImageLock, LockEntry } from "./verify-images.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const ours = (name: string, digest: string, gitCommit: string): LockEntry => ({
  ref: `ghcr.io/undefined6799/unset/${name}@sha256:${digest.repeat(64)}`,
  origin: "first-party",
  gitCommit,
  verify: "cosign-keyless",
});
const newt: LockEntry = {
  ref: `ghcr.io/undefined6799/mirror/newt@sha256:${"9".repeat(64)}`,
  origin: "upstream",
  upstreamSource: `docker.io/fosrl/newt:1.19.0@sha256:${"9".repeat(64)}`,
  verify: "cosign-keyless",
};
const current: ImageLock = { web: ours("web", "1", OLD), newt, edge: ours("edge", "2", OLD) };
const compose = (lock: ImageLock) =>
  ["services:", ...Object.entries(lock).flatMap(([name, e]) => [`  ${name}:`, `    image: ${e.ref}`]), ""].join("\n");
const published: ImageLock = { edge: ours("edge", "4", NEW), web: ours("web", "3", NEW) };
const write = (pub: unknown, lock: ImageLock = current, composeText = compose(lock), commit = NEW) =>
  bumpedFiles(JSON.stringify(pub), `${JSON.stringify(lock, null, 2)}\n`, composeText, commit);

describe("lock write", () => {
  test("replaces_first_party_entries_and_keeps_order_and_mirrors", () => {
    const result = write(published);
    const expected: ImageLock = { web: ours("web", "3", NEW), newt, edge: ours("edge", "4", NEW) };
    expect(result.lock).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(Object.keys(JSON.parse(result.lock))).toEqual(["web", "newt", "edge"]);
    expect(result.compose).toBe(compose(expected));
  });

  test("an_unchanged_digest_changes_only_its_commit", () => {
    const same: ImageLock = { edge: ours("edge", "2", NEW), web: ours("web", "3", NEW) };
    const result = write(same);
    expect(JSON.parse(result.lock).edge).toEqual(ours("edge", "2", NEW));
    expect(result.compose).toBe(compose({ web: ours("web", "3", NEW), newt, edge: ours("edge", "2", NEW) }));
  });

  test("the_committed_files_round_trip", () => {
    // Writing the committed lock's own first-party entries back changes neither file, so the format is the writer's.
    const lockText = readFileSync(join(ROOT, LOCK_PATH), "utf8");
    const composeText = readFileSync(join(ROOT, COMPOSE_PATH), "utf8");
    const lock = JSON.parse(lockText) as ImageLock;
    const first = Object.entries(lock).filter(([, entry]) => entry.origin === "first-party");
    expect(first.length).toBeGreaterThan(0);
    const commit = first[0]?.[1].gitCommit ?? "";
    expect(bumpedFiles(JSON.stringify(Object.fromEntries(first)), lockText, composeText, commit)).toEqual({
      lock: lockText,
      compose: composeText,
    });
  });

  test("refuses_input_that_is_not_a_publish_run_lock", () => {
    const bad: [string, unknown][] = [
      ["not a lock", []],
      ["not a lock", { web: "x" }],
      ["names commit", { ...published, web: ours("web", "3", OLD) }],
      ["not a first-party keyless entry", { ...published, web: { ...ours("web", "3", NEW), origin: "upstream" } }],
      ["not a first-party keyless entry", { ...published, web: { ...ours("web", "3", NEW), verify: "none" } }],
      ["does not hold exactly", { ...published, web: { ...ours("web", "3", NEW), identity: "x" } }],
      ["by digest", { ...published, web: { ...ours("web", "3", NEW), ref: ours("edge", "3", NEW).ref } }],
      ["by digest", { ...published, web: { ...ours("web", "3", NEW), ref: "ghcr.io/undefined6799/unset/web:latest" } }],
      [
        "by digest",
        { ...published, web: { ...ours("web", "3", NEW), ref: `ghcr.io/evil/unset/web@sha256:${"3".repeat(64)}` } },
      ],
      ["by digest", { ...published, web: { ...ours("web", "3", NEW), ref: `${ours("web", "3", NEW).ref}@x` } }],
    ];
    for (const [message, input] of bad) expect(() => write(input), message).toThrow(message);
    expect(() => write(published, current, compose(current), "main")).toThrow("40 lowercase hex");
    expect(() => bumpedFiles("{", "{}", "", NEW)).toThrow();
  });

  test("refuses_to_add_drop_or_convert_an_entry", () => {
    expect(() => write({ ...published, objects: ours("objects", "5", NEW) })).toThrow(
      "objects: not a first-party entry of the committed lock",
    );
    expect(() => write({ web: published.web })).toThrow("edge: locked but not published");
    // A mirror entry never becomes ours through a bump.
    const mirrorNamed = { ...published, newt: ours("newt", "5", NEW) };
    expect(() => write(mirrorNamed)).toThrow("newt: not a first-party entry of the committed lock");
    expect(() => write({}, { newt })).toThrow("no first-party entry");
  });

  test("refuses_a_compose_file_that_does_not_run_the_lock", () => {
    const other = compose({ ...current, web: ours("web", "7", OLD) });
    expect(() => write(published, current, other)).toThrow(`web: ${COMPOSE_PATH} does not run the locked ref`);
    const stray = `${compose(current)}# was ${current.web?.ref}\n`;
    expect(() => write(published, current, stray)).toThrow("names the old ref outside an image line");
  });
});
