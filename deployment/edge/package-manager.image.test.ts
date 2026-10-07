// P1.28o: the edge image ships no package manager (step book P1.28o; architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 3, point 4). The Caddy Alpine runtime base carries
// apk-tools, and `apk del` of curl and libcap left it in place, so the final stage deletes apk-tools last. This test
// builds the image and proves apk is gone, both at its path and on PATH. It builds the image, so it lives in an
// *.image.test.ts file with no skip of its own (P1.28j, P1.28r).
//
// Deleting apk-tools also purges what only it needed, ca-certificates-bundle among them (Alpine v3.23). Caddy still
// needs the system roots for ACME: Go reads the first file in its list that exists, and
// /etc/ssl/certs/ca-certificates.crt comes first (go1.27.1 src/crypto/x509/root_linux.go, certFiles). The base's
// `ca-certificates` package, which stays, keeps that file, so the second test proves it matches the base byte for byte.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const EDGE = import.meta.dirname;
const CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
const built: string[] = [];

function docker(args: readonly string[]): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

/** The edge's runtime base, pinned by index digest in deployment/images/bases.lock.json. */
function runtimeBase(): string {
  const lock = JSON.parse(readFileSync(join(EDGE, "..", "images", "bases.lock.json"), "utf8"));
  return `${lock.caddy.ref}:${lock.caddy.tag}@${lock.caddy.digest}`;
}

/** A file's bytes in an image, read with its own `cat` and no network. */
function fileIn(image: string, path: string): string {
  const read = docker(["run", "--rm", "--network", "none", "--entrypoint", "cat", image, path]);
  if (read.code !== 0) throw new Error(`reading ${path} failed: ${read.err.slice(-2000)}`);
  return read.out;
}

/** Builds deployment/edge/Dockerfile with deployment/edge as the context; the image id. */
function buildEdgeImage(): string {
  const result = docker(["build", "-q", "-f", join(EDGE, "Dockerfile"), EDGE]);
  if (result.code !== 0) throw new Error(`edge image build failed: ${result.err.slice(-2000)}`);
  built.push(result.out.trim());
  return result.out.trim();
}

describe("edge image package manager", () => {
  afterAll(() => {
    for (const image of built) docker(["rmi", "-f", image]);
  });

  test("edge_image_has_no_apk", () => {
    const image = buildEdgeImage();
    // Docker exits 127 when the entrypoint cannot be found; the message says whether by path or on PATH.
    const byPath = docker(["run", "--rm", "--network", "none", "--entrypoint", "/sbin/apk", image, "--version"]);
    expect({ code: byPath.code, missing: /no such file or directory/i.test(byPath.err) }, byPath.out).toEqual({
      code: 127,
      missing: true,
    });
    const onPath = docker(["run", "--rm", "--network", "none", "--entrypoint", "apk", image, "--version"]);
    expect({ code: onPath.code, missing: /executable file not found in \$PATH/i.test(onPath.err) }, onPath.out).toEqual(
      { code: 127, missing: true },
    );
  }, 600_000);

  test("edge_image_keeps_ca_bundle", () => {
    const image = buildEdgeImage();
    const base = fileIn(runtimeBase(), CA_BUNDLE);
    expect(base).toMatch(/-----BEGIN CERTIFICATE-----/);
    expect(fileIn(image, CA_BUNDLE) === base, CA_BUNDLE).toBe(true);
  }, 600_000);
});
