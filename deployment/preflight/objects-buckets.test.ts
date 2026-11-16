// P2.18s (ADR 0050 Decision 2): the bucket setup's own decisions, with Docker as the one double (TE-1). The real store
// is objects.image.test.ts's (objects_buckets_created_by_stack).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  BUCKETS,
  type Call,
  composeArgs,
  DEADLINE_MS,
  type Docker,
  ensureBuckets,
  listedBuckets,
} from "./objects-buckets.ts";

const SCRIPT = join(import.meta.dirname, "objects-buckets.ts");
const COMPOSE = ["compose", "-f", "/c/compose.dev.yaml", "--env-file", "/e/dev-public.env"];
const listing = (names: readonly string[]) => names.map((name) => `  ${name}\tsize:0\tlogical:0\tchunk:0\n`).join("");

/** A store that becomes healthy after `healthyAfter` asks, holds `buckets`, and answers each shell line by `answer`. */
function store({ healthyAfter = 0, buckets = [] as string[], answer = (_line: string): number | null => 0 } = {}) {
  let clock = 0;
  const lines: string[] = [];
  const argv: string[][] = [];
  let asked = 0;
  const docker: Docker = {
    run: (args, input, timeoutMs): Call => {
      argv.push(args);
      expect(timeoutMs).toBeGreaterThan(0);
      clock += 10;
      if (args.includes("wget")) return { status: asked++ >= healthyAfter ? 0 : 1, stdout: "" };
      lines.push(input);
      const status = answer(input);
      if (status === 0 && input.startsWith("s3.bucket.create -name "))
        buckets.push(input.trim().split(" ").at(-1) ?? "");
      return { status, stdout: input.startsWith("s3.bucket.list") ? listing(buckets) : "" };
    },
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
    },
  };
  return { docker, lines, argv, buckets };
}

describe("objects bucket setup (P2.18s)", () => {
  test("lists_creates_the_missing_buckets_and_lists_again", () => {
    const s = store({ healthyAfter: 3, buckets: ["unset-pds"] });
    expect(ensureBuckets(COMPOSE, s.docker)).toBeNull();
    expect(s.lines).toEqual(["s3.bucket.list\n", "s3.bucket.create -name unset-private\n", "s3.bucket.list\n"]);
    // Every call is `docker compose <the stack's files> exec -T objects …`, never a run, never a lock.
    for (const args of s.argv) expect(args.slice(0, COMPOSE.length + 3)).toEqual([...COMPOSE, "exec", "-T", "objects"]);
    expect(s.lines.join("")).not.toContain("withLock");
  });

  test("an_existing_store_gets_no_create", () => {
    const s = store({ buckets: [...BUCKETS] });
    expect(ensureBuckets(COMPOSE, s.docker)).toBeNull();
    expect(s.lines).toEqual(["s3.bucket.list\n", "s3.bucket.list\n"]);
  });

  test("each_failure_is_named_and_fails_the_setup", () => {
    expect(ensureBuckets(COMPOSE, store({ healthyAfter: Number.POSITIVE_INFINITY }).docker)).toBe(
      "the object store did not become healthy in time",
    );
    const listFails = store({ answer: (line) => (line.startsWith("s3.bucket.list") ? 1 : 0) });
    expect(ensureBuckets(COMPOSE, listFails.docker)).toBe(
      "the object store's shell could not list the buckets in time",
    );
    // After a first list has succeeded there is a leader, so a failed second list is final.
    let lists = 0;
    const secondFails = store({ answer: (line) => (line.startsWith("s3.bucket.list") && lists++ > 0 ? 1 : 0) });
    expect(ensureBuckets(COMPOSE, secondFails.docker)).toBe("the object store's shell could not list the buckets");
    expect(secondFails.lines.filter((line) => line.startsWith("s3.bucket.list"))).toHaveLength(2);
    const createFails = store({ answer: (line) => (line.startsWith("s3.bucket.create") ? 1 : 0) });
    expect(ensureBuckets(COMPOSE, createFails.docker)).toBe("the object store did not create unset-private");
    // A create that reports success but leaves no bucket is caught by the second list.
    const silent = store();
    const lying: Docker = {
      ...silent.docker,
      run: (args, input, timeoutMs) =>
        input.startsWith("s3.bucket.create") ? { status: 0, stdout: "" } : silent.docker.run(args, input, timeoutMs),
    };
    expect(ensureBuckets(COMPOSE, lying)).toBe("the object store lacks unset-private, unset-pds after setup");
    // A killed call (status null) is a failure, not a pass.
    expect(ensureBuckets(COMPOSE, store({ answer: () => null }).docker)).toBe(
      "the object store's shell could not list the buckets in time",
    );
  });

  test("the_first_list_waits_for_a_leader", () => {
    // Healthy before a leader exists (a restart with raft state, staging 2026-11-16): the first lists fail, then one
    // succeeds, and the pauses between them double up to 8 s.
    let failures = 6;
    const s = store({ answer: (line) => (line.startsWith("s3.bucket.list") && failures-- > 0 ? 1 : 0) });
    const pauses: number[] = [];
    const sleep = s.docker.sleep;
    const docker: Docker = { ...s.docker, sleep: (ms) => (pauses.push(ms), sleep(ms)) };
    expect(ensureBuckets(COMPOSE, docker)).toBeNull();
    expect(pauses).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(s.lines.filter((line) => line.startsWith("s3.bucket.create"))).toHaveLength(2);
  });

  test("a_store_with_no_leader_fails_by_the_deadline", () => {
    const s = store({ answer: (line) => (line.startsWith("s3.bucket.list") ? 1 : 0) });
    expect(ensureBuckets(COMPOSE, s.docker)).toBe("the object store's shell could not list the buckets in time");
    expect(s.docker.now()).toBeLessThanOrEqual(DEADLINE_MS + 10);
    expect(s.lines.some((line) => line.startsWith("s3.bucket.create"))).toBe(false);
  });

  test("the_wait_ends_by_the_deadline", () => {
    const s = store({ healthyAfter: Number.POSITIVE_INFINITY });
    ensureBuckets(COMPOSE, s.docker);
    expect(s.docker.now()).toBeLessThanOrEqual(DEADLINE_MS + 10);
  });

  test("the_listing_is_read_by_name_only", () => {
    expect(listedBuckets(listing(["unset-private", "unset-pds"]))).toEqual(["unset-private", "unset-pds"]);
    expect(listedBuckets("create bucket under /buckets\nunset-private\t\n")).toEqual([]);
    expect(listedBuckets("")).toEqual([]);
  });

  test("the_flags_are_the_stack_wrappers", () => {
    expect(
      composeArgs(["--", "--compose", "/c/a.yaml", "--compose", "/c/b.yaml", "--interpolation-env", "/e/x.env"]),
    ).toEqual(["compose", "-f", "/c/a.yaml", "-f", "/c/b.yaml", "--env-file", "/e/x.env"]);
    expect(() => composeArgs(["--compose", "/c/a.yaml"])).toThrow("usage");
    expect(() => composeArgs(["--interpolation-env", "/e/x.env"])).toThrow("usage");
    expect(() => composeArgs(["--compose", "/c/a.yaml", "--interpolation-env", "/e/x.env", "--other"])).toThrow();
  });
});

describe("objects bucket setup as a process (P2.18s)", () => {
  test("what_docker_prints_is_never_echoed", () => {
    // A docker on PATH that answers the health probe and the list, printing text on both streams, then fails the
    // create with text on stderr: the setup's own stderr holds only its fixed line (SE-7).
    const bin = mkdtempSync(join(tmpdir(), "objects-docker-"));
    const fake = join(bin, "docker");
    writeFileSync(
      fake,
      '#!/bin/sh\ncase "$*" in *wget*) exit 0 ;; esac\nread -r line\necho "LEAKED-STORE-OUTPUT"\necho "LEAKED-STORE-OUTPUT" >&2\n' +
        'case "$line" in s3.bucket.list) exit 0 ;; esac\nexit 1\n',
    );
    chmodSync(fake, 0o755);
    const ran = spawnSync(
      process.execPath,
      [SCRIPT, "--", "--compose", "/c/compose.dev.yaml", "--interpolation-env", "/e/dev-public.env"],
      { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` }, timeout: 30_000 },
    );
    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe("objects: the object store did not create unset-private\n");
    expect(ran.stdout).toBe("");
  });
});
