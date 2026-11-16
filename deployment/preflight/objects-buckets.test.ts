// P2.18s (ADR 0050 Decision 2): the bucket setup's own decisions, with Docker as the one double (TE-1). The real store
// is objects.image.test.ts's (objects_buckets_created_by_stack).
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
    expect(ensureBuckets(COMPOSE, listFails.docker)).toBe("the object store's shell could not list the buckets");
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
      "the object store's shell could not list the buckets",
    );
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
