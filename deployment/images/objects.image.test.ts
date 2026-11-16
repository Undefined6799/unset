// The built objects image fails closed on its identities (P2.18s, ADR 0041; weed/s3api/auth_credentials.go:386-427 at
// 4.53): with no identities file, or an empty one, the server stops; with a file that holds no identity it runs and
// refuses every anonymous request. The stack's bucket setup (deployment/preflight/objects-buckets.ts) makes both
// buckets through the store's own shell, with versioning left off (ADR 0050). It builds an image, so it lives in an
// *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than
// skips.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";
import { BUCKETS, type Docker, ensureBuckets, listedBuckets } from "../preflight/objects-buckets.ts";

const IMAGES = import.meta.dirname;
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 8 * CALL_MS;
const SECRET = "/run/secrets/objects_s3";
const RUN = ["run", "--read-only", "--network", "none", "--tmpfs", "/tmp", "--tmpfs", "/data:uid=1000,gid=1000"];

/** A one-file folder holding `body` as the identities file, readable by the image's user. */
function identities(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "objects-ids-"));
  const file = join(dir, "objects_s3");
  writeFileSync(file, body);
  chmodSync(file, 0o644);
  return file;
}

/** The bucket setup's own calls, `compose … exec -T objects <command>`, run in `container` instead. */
function inContainer(container: string, inputs: string[] = []): Docker {
  return {
    run: (args, input, timeoutMs) => {
      const command = args.slice(args.indexOf("objects") + 1);
      inputs.push(input);
      const ran = docker(["exec", "-i", container, ...command], { timeoutMs, input });
      return { status: ran.code, stdout: ran.out };
    },
    now: () => performance.now(),
    sleep: (ms) => {
      docker(["exec", container, "sleep", `${Math.ceil(ms / 1000)}`], { timeoutMs: CALL_MS });
    },
  };
}

/** The anonymous S3 answer to GET `path` from inside the container, once the server answers at all (busybox wget). */
function anonymousAnswer(container: string, path = "/"): string {
  for (let attempt = 0; attempt < 30; attempt++) {
    const ran = docker(["exec", container, "wget", "-S", "-O", "/dev/null", `http://127.0.0.1:8333${path}`], {
      timeoutMs: CALL_MS,
    });
    if (!ran.err.includes("Connection refused")) return ran.out + ran.err;
    docker(["exec", container, "sleep", "1"], { timeoutMs: CALL_MS });
  }
  return "no answer";
}

describe("objects image", () => {
  test(
    "objects_identities_fail_closed",
    () => {
      const image = buildTestImage(join(IMAGES, "objects.Dockerfile"), IMAGES, { timeoutMs: BUILD_CALL_MS });
      withCleanup(
        () => {
          // No file, or an empty one: the server stops on its own, with an error.
          const missing = docker([...RUN, "--rm", image], { timeoutMs: CALL_MS });
          expect(missing.code, missing.err.slice(-500)).not.toBe(0);
          expect(missing.err).toContain(`fail to load config file ${SECRET}`);
          const empty = docker([...RUN, "--rm", "-v", `${identities("")}:${SECRET}:ro`, image], { timeoutMs: CALL_MS });
          expect(empty.code, empty.err.slice(-500)).not.toBe(0);
          expect(empty.err).toContain(`fail to load config file ${SECRET}`);
          // A file with no identity: authentication stays on and nobody is allowed.
          for (const body of ["{}", '{"identities":[]}']) {
            const started = docker([...RUN, "-d", "-v", `${identities(body)}:${SECRET}:ro`, image], {
              timeoutMs: CALL_MS,
            });
            expect(started.code, started.err).toBe(0);
            const container = started.out.trim();
            withCleanup(
              () => expect(anonymousAnswer(container), body).toContain("403"),
              () => docker(["rm", "-f", container], { timeoutMs: CALL_MS }),
            );
          }
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );

  test(
    "objects_buckets_created_by_stack",
    () => {
      const image = buildTestImage(join(IMAGES, "objects.Dockerfile"), IMAGES, { timeoutMs: BUILD_CALL_MS });
      withCleanup(
        () => {
          const started = docker([...RUN, "-d", "-v", `${identities('{"identities":[]}')}:${SECRET}:ro`, image], {
            timeoutMs: CALL_MS,
          });
          expect(started.code, started.err).toBe(0);
          const container = started.out.trim();
          withCleanup(
            () => {
              const inputs: string[] = [];
              const store = inContainer(container, inputs);
              expect(ensureBuckets(["compose", "-f", "x.yaml"], store)).toBeNull();
              const shell = (line: string) =>
                docker(["exec", "-i", container, "weed", "shell"], { timeoutMs: CALL_MS, input: `${line}\n` }).out;
              expect(listedBuckets(shell("s3.bucket.list")).sort()).toEqual([...BUCKETS].sort());
              // objects_no_versioning: neither bucket reports versioning on, and no create asked for a lock.
              for (const bucket of BUCKETS) {
                expect(shell(`s3.bucket.versioning -name ${bucket}`), bucket).toContain("Versioning: Unconfigured");
              }
              expect(inputs.filter((line) => line.startsWith("s3.bucket.create"))).toEqual(
                BUCKETS.map((bucket) => `s3.bucket.create -name ${bucket}\n`),
              );
              // With both buckets there, an anonymous caller still lists nothing and reads nothing.
              for (const path of ["/", ...BUCKETS.map((bucket) => `/${bucket}/`), `/${BUCKETS[0]}/any-object`]) {
                expect(anonymousAnswer(container, path), path).toContain("403");
              }
              // A second `up` finds both buckets and creates nothing.
              inputs.length = 0;
              expect(ensureBuckets(["compose", "-f", "x.yaml"], store)).toBeNull();
              expect(inputs.filter((line) => line.startsWith("s3.bucket.create"))).toEqual([]);
            },
            () => docker(["rm", "-f", container], { timeoutMs: CALL_MS }),
          );
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );

  test(
    "objects_each_bucket_takes_writes",
    async () => {
      // Staging, 2026-11-16: with the default 32 GB volume size and -volume.max=0, a disk with 51 GB free holds one
      // volume, the filer's own collection took it, and every PDS upload failed "No writable volumes". Each bucket is
      // its own collection and needs volumes of its own (weed/topology/volume_growth.go grows 7 per collection at
      // 4.53). So the store runs on a 40 GB /data, like staging's, and each caller writes with its own scoped key.
      const image = buildTestImage(join(IMAGES, "objects.Dockerfile"), IMAGES, { timeoutMs: BUILD_CALL_MS });
      const key = () => ({
        accessKey: randomBytes(8).toString("hex"),
        secretKey: randomBytes(24).toString("base64url"),
      });
      const callers = { "unset-pds": key(), "unset-private": key() };
      const file = identities(
        JSON.stringify({
          identities: Object.entries(callers).map(([bucket, credentials]) => ({
            name: bucket,
            credentials: [credentials],
            actions: [`Read:${bucket}`, `Write:${bucket}`, `List:${bucket}`],
          })),
        }),
      );
      try {
        const started = docker(
          ["run", "-d", "--read-only", "-p", "127.0.0.1::8333", "--tmpfs", "/tmp"].concat([
            "--tmpfs",
            "/data:uid=1000,gid=1000,size=40g",
            "-v",
            `${file}:${SECRET}:ro`,
            image,
          ]),
          { timeoutMs: CALL_MS },
        );
        expect(started.code, started.err).toBe(0);
        const container = started.out.trim();
        try {
          expect(ensureBuckets(["compose", "-f", "x.yaml"], inContainer(container))).toBeNull();
          const port = docker(["port", container, "8333/tcp"], { timeoutMs: CALL_MS }).out.split(":").at(-1)?.trim();
          for (const [bucket, { accessKey, secretKey }] of Object.entries(callers)) {
            const client = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              service: "s3",
              region: "us-east-1",
            });
            const url = `http://127.0.0.1:${port}/${bucket}/probe/one`;
            const put = await fetch(await client.sign(url, { method: "PUT", body: `bytes for ${bucket}` })); // guard-allow: egress the loopback store this test started
            expect(put.status, `${bucket}: ${await put.text()}`).toBe(200);
            const got = await fetch(await client.sign(url, { method: "GET" })); // guard-allow: egress the loopback store this test started
            expect(await got.text(), bucket).toBe(`bytes for ${bucket}`);
          }
        } finally {
          docker(["rm", "-f", container], { timeoutMs: CALL_MS });
        }
      } finally {
        removeTestImage(image, { timeoutMs: CALL_MS });
      }
    },
    TEST_MS,
  );
});
