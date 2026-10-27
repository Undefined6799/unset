// P1.28o: the edge image ships no package manager (step book P1.28o; architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 3, point 4). The Caddy Alpine runtime base carries
// apk-tools, and `apk del` of curl and libcap left it in place, so the final stage deletes apk-tools last. This test
// builds the image and proves apk is gone, both at its path and on PATH. It builds the image, so it lives in an
// *.image.test.ts file with no skip of its own (P1.28j, P1.28r).
//
// Deleting apk-tools also purges what only it needed, ca-certificates-bundle among them (Alpine v3.23). Caddy still
// needs the system roots for ACME: Go reads the first file in its list that exists, and
// /etc/ssl/certs/ca-certificates.crt comes first (go1.27.1 src/crypto/x509/root_linux.go, certFiles). The base's
// `ca-certificates` package, which stays, keeps that file, so the second test proves it matches the base byte for byte,
// is a regular file, and holds only certificates that parse (architecture amendment in the P1.28o record): a
// same-as-base comparison alone would accept an empty or truncated upstream file.
import { spawnSync } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { BUILD_CALL_MS, buildTestBudget, CALL_MS, removalBudget, runOrKill } from "./docker-call.ts";
import { removeEveryTag } from "./image-cleanup.ts";

const EDGE = import.meta.dirname;
const docker = (args: readonly string[], timeoutMs: number) => runOrKill(spawnSync, "docker", args, timeoutMs);
const CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
const built: string[] = [];
// Every docker call is killed at its own budget with SIGKILL by docker-call.ts (P1.27t). Each test's budget is one
// build slot plus CALL_MS for each other docker call it makes, which keeps the sum of its kills under that budget and
// the budget under run.ts's 600 s (P1.27h, N1; docker-call.ts buildTestBudget). The afterAll's removals are one `rmi`
// per tag, one tag per test that builds (BUILDS of them), each killed at CALL_MS.
const BUILDS = 2;

/** The edge's runtime base, pinned by index digest in deployment/images/bases.lock.json. */
function runtimeBase(): string {
  const lock = JSON.parse(readFileSync(join(EDGE, "..", "images", "bases.lock.json"), "utf8"));
  return `${lock.caddy.ref}:${lock.caddy.tag}@${lock.caddy.digest}`;
}

/** A file's bytes in an image, read with its own `cat` and no network. */
function fileIn(image: string, path: string): string {
  const read = docker(["run", "--rm", "--network", "none", "--entrypoint", "cat", image, path], CALL_MS);
  if (read.code !== 0) throw new Error(`reading ${path} failed: ${read.err.slice(-2000)}`);
  return read.out;
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----\n[\s\S]*?\n-----END CERTIFICATE-----/g;

/** Every way a CA bundle fails to be a list of certificates: none at all, or a block that does not parse. */
function bundleProblems(bundle: string): string[] {
  const blocks = bundle.match(PEM_BLOCK) ?? [];
  const problems = blocks.length === 0 ? ["no PEM certificate"] : [];
  if (blocks.length !== bundle.split("-----BEGIN CERTIFICATE-----").length - 1) problems.push("an unterminated block");
  for (const [at, block] of blocks.entries()) {
    try {
      new X509Certificate(block);
    } catch {
      problems.push(`block ${at + 1} does not parse`);
    }
  }
  return problems;
}

/**
 * Builds deployment/edge/Dockerfile with deployment/edge as the context under its own tag; the tag (P1.27z, as P1.27x
 * does for product tests). Two builds of one context share an image id on CI's classic image store, so removing by id
 * with -f removed the image under every other edge test; `rmi <tag>` removes the image only with its last tag
 * (docs.docker.com, "docker image rm"). Plain progress, not -q, so a failure keeps the failing step's own log lines.
 */
function buildEdgeImage(): string {
  const tag = `unset-test-${randomBytes(8).toString("hex")}`;
  const result = docker(["build", "--progress=plain", "-t", tag, "-f", join(EDGE, "Dockerfile"), EDGE], BUILD_CALL_MS);
  if (result.code !== 0) throw new Error(`edge image build failed: ${failedStep(result.err)}`);
  built.push(tag);
  return tag;
}

/** BuildKit's summary of the failing step to the end of its output (docker buildx 0.35.0), else the last 4000 chars. */
function failedStep(stderr: string): string {
  const from = stderr.lastIndexOf("\n------\n > ");
  return (from === -1 ? stderr : stderr.slice(from + 1)).slice(-4_000);
}

describe("edge image package manager", () => {
  afterAll(() => {
    // The tag only, never -f: an image another edge test built from the same context stays (P1.27z). Every tag is
    // tried, and each result checked, even after a removal fails or is killed (P1.11r).
    removeEveryTag(built, (tag) => {
      const removed = docker(["rmi", tag], CALL_MS);
      if (removed.code !== 0) throw new Error(removed.err.trim().slice(-500));
    });
    if (built.length > BUILDS) throw new Error(`${built.length} builds, but this hook's budget covers ${BUILDS}`);
  }, removalBudget(BUILDS));

  // Its docker calls after the build: apk by path, then on PATH (2).
  test("edge_image_has_no_apk", { timeout: buildTestBudget(2) }, () => {
    const image = buildEdgeImage();
    // Docker exits 127 when the entrypoint cannot be found; the message says whether by path or on PATH.
    const byPath = docker(
      ["run", "--rm", "--network", "none", "--entrypoint", "/sbin/apk", image, "--version"],
      CALL_MS,
    );
    expect({ code: byPath.code, missing: /no such file or directory/i.test(byPath.err) }, byPath.out).toEqual({
      code: 127,
      missing: true,
    });
    const onPath = docker(["run", "--rm", "--network", "none", "--entrypoint", "apk", image, "--version"], CALL_MS);
    expect({ code: onPath.code, missing: /executable file not found in \$PATH/i.test(onPath.err) }, onPath.out).toEqual(
      { code: 127, missing: true },
    );
  });

  // Its docker calls after the build: the base's bundle, the image's bundle, then stat (3).
  test("edge_image_keeps_ca_bundle", { timeout: buildTestBudget(3) }, () => {
    const image = buildEdgeImage();
    const base = fileIn(runtimeBase(), CA_BUNDLE);
    const shipped = fileIn(image, CA_BUNDLE);
    expect(shipped === base, CA_BUNDLE).toBe(true);
    expect(bundleProblems(shipped)).toEqual([]);
    // busybox stat: "regular file", never "symbolic link" to a path a later deletion could remove.
    const kind = docker(
      ["run", "--rm", "--network", "none", "--entrypoint", "stat", image, "-c", "%F", CA_BUNDLE],
      CALL_MS,
    );
    expect(kind.out.trim(), kind.err).toBe("regular file");
    // The bundle check itself: an empty file, a block cut short and a block that is not a certificate all fail.
    const one = shipped.match(PEM_BLOCK)?.[0] ?? "";
    expect(bundleProblems("")).toEqual(["no PEM certificate"]);
    expect(bundleProblems(`${one}\n${one.slice(0, 200)}`)).toEqual(["an unterminated block"]);
    expect(bundleProblems(`${one}\n-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n`)).toEqual([
      "block 2 does not parse",
    ]);
  });
});
