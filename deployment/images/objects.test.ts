// The objects image's start line (P2.18s, ADR 0041): which listeners leave loopback, where identities come from, and
// the at-rest and vacuum flags. A change to any of them is a change to this test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DOCKERFILE = readFileSync(join(import.meta.dirname, "objects.Dockerfile"), "utf8");

/** The JSON-array form of one instruction, joined across its continuation lines. */
function execForm(instruction: string): string[] {
  const joined = DOCKERFILE.replace(/\\\n\s*/g, " ");
  const line = joined.split("\n").find((candidate) => candidate.startsWith(`${instruction} [`));
  if (line === undefined) throw new Error(`no exec-form ${instruction}`);
  return JSON.parse(line.slice(instruction.length + 1)) as string[];
}

describe("objects image", () => {
  test("objects_start_line_pinned", () => {
    expect(execForm("ENTRYPOINT")).toEqual(["/usr/bin/weed"]);
    expect(execForm("CMD")).toEqual([
      "server",
      "-dir=/data",
      // Master, volume and filer, and the filer's unauthenticated IAM gRPC, stay on loopback.
      "-ip=127.0.0.1",
      "-ip.bind=127.0.0.1",
      // S3 alone listens beyond it.
      "-s3",
      "-s3.ip.bind=0.0.0.0",
      "-s3.port.iceberg=0",
      "-s3.port.lance=0",
      // No embedded IAM API; identities only from the mounted secret, which fails closed.
      "-s3.iam=false",
      "-s3.config=/run/secrets/objects_s3",
      "-volume.max=0",
      "-filer.encryptVolumeData",
      "-master.garbageThreshold=0.01",
    ]);
    // Nothing else picks up credentials: no ENV line, so no AWS_* identity (auth_credentials.go
    // loadEnvironmentVariableCredentials at 4.53) is baked in.
    expect(DOCKERFILE).not.toMatch(/^ENV /m);
  });
});
