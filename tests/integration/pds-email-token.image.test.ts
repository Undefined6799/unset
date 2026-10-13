// tests/support/pds-email-token.ts against real Docker (P1.29h): the PDS's env.js in the pinned image has no outbound
// key the wrapper has not classified (architecture record 2026-10-13-p129h-local-token-reader, Amendment 3, S2'), and
// the inspect template prints only the keys it names (coordinator's second review of #786, N3).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../support/docker.ts";
import { envFormat, outboundDrift } from "../support/pds-email-token.ts";

type LockEntry = { ref: string; tag: string; digest: string };
const lock = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../deployment/images/bases.lock.json"), "utf8"),
) as Record<string, LockEntry>;
const NODE = `${lock.node?.ref}:${lock.node?.tag}@${lock.node?.digest}`;
// The PDS image the dev stack runs, by tag and digest.
const PDS = /^ {4}image: (ghcr\.io\/bluesky-social\/pds:\S+@sha256:[0-9a-f]{64})$/m.exec(
  readFileSync(join(import.meta.dirname, "../../deployment/compose.dev.yaml"), "utf8"),
)?.[1];
// The image installs its service with pnpm under /app (bluesky-social/pds Dockerfile, WORKDIR /app, COPY ./service);
// the package link resolves into pnpm's store.
const ENV_JS = "/app/node_modules/@atproto/pds/dist/config/env.js";

const TEST_MS = 300_000;

describe("tests/support/pds-email-token.ts with Docker", () => {
  test("email_token_outbound_keys_match_the_pinned_pds", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    const call = { timeoutMs: killBefore(TEST_MS) };
    const read = docker(["run", "--rm", "--network", "none", "--entrypoint", "cat", PDS as string, ENV_JS], call);
    expect(read.code, read.err).toBe(0);
    expect(outboundDrift(read.out)).toEqual([]);
  });

  test("email_token_inspect_template_prints_only_named_keys", { timeout: TEST_MS }, () => {
    const name = `unset-test-${randomBytes(8).toString("hex")}`;
    const call = { timeoutMs: killBefore(TEST_MS / 2) };
    withCleanup(
      () => {
        const made = docker(
          ["create", "--name", name, "--network", "none", "-e", "PDS_HOSTNAME=pds.example.test"]
            .concat(["-e", "PDS_CRAWLERS=http://plc:2582/a=b,https://relay.localhost", "-e", "PDS_EMPTY="])
            .concat(["-e", "PDS_JWT_SECRET=jwt-secret-fixture", "-e", "PDS_HOSTNAME_2=other", NODE, "true"]),
          call,
        );
        expect(made.code, made.err).toBe(0);
        const keys = ["PDS_HOSTNAME", "PDS_CRAWLERS", "PDS_EMPTY", "PDS_UNSET"];
        const printed = docker(["inspect", "--format", envFormat(keys), name], call);
        expect(printed.code, printed.err).toBe(0);
        // In the container's own Config.Env order, which the daemon decides (CI's printed them sorted, this
        // container's Docker in creation order); the reader keys each line by name, so only the set is pinned.
        const lines = printed.out.split("\n").filter((line) => line !== "");
        expect(lines.sort()).toEqual([
          '"PDS_CRAWLERS=http://plc:2582/a=b,https://relay.localhost"',
          '"PDS_EMPTY="',
          '"PDS_HOSTNAME=pds.example.test"',
        ]);
      },
      () => void docker(["rm", "-f", name], call),
    );
  });
});
