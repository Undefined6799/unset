// P1.29t against real Docker: the pinned PDS image's uid and volume, and APP_HOST / PDS_HOST aliases on a throwaway
// network. A full compose stack (client_id GET through the edge, OAuth as Alice or Bob) is P1.33z: this environment
// and the check job have no unset-dev-env, and session containers cannot pull the PDS image for a compose up.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../support/docker.ts";
import { composeNetworkName, PDS_UID, PROJECT, pdsVolumeVerdict } from "../support/local-stack.ts";

const PDS = /^ {4}image: (ghcr\.io\/bluesky-social\/pds:\S+@sha256:[0-9a-f]{64})$/m.exec(
  readFileSync(join(import.meta.dirname, "../../deployment/compose.local.yaml"), "utf8"),
)?.[1];

const TEST_MS = 300_000;
const CALL_MS = killBefore(TEST_MS);
const call = { timeoutMs: CALL_MS };
const hex = (): string => randomBytes(6).toString("hex");

const pdsSh = (volume: string, target: string, script: string): string[] => [
  "run",
  "--rm",
  "--network",
  "none",
  "--read-only",
  "--user",
  "1000:1000",
  "--entrypoint",
  "sh",
  "-v",
  `${volume}:${target}`,
  PDS as string,
  "-c",
  script,
];

describe("running local stack with Docker (P1.29t)", () => {
  test("pds_runs_as_uid_1000", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    // Compose sets user: "1000:1000". The image's base is node alpine; uid 1000 is the node user
    // (nodejs/docker-node 24/alpine3.23/Dockerfile:5-6, cited from compose.dev.yaml).
    const run = docker(
      ["run", "--rm", "--network", "none", "--user", "1000:1000", "--entrypoint", "id", PDS as string, "-u"],
      call,
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    expect(run.out.trim()).toBe(String(PDS_UID));
  });

  test("pds_data_directory_owned_by_1000", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    const volume = `unset-test-pdsdata-${hex()}`;
    withCleanup(
      () => {
        expect(docker(["volume", "create", volume], call).code).toBe(0);
        // A fresh named volume at /home/node copies that directory's owner (uid 1000) from the image.
        const script = "id -u; stat -c %u /home/node; touch /home/node/write-ok && echo write-ok";
        const run = docker(pdsSh(volume, "/home/node", script), call);
        expect(run.code, run.err.slice(-2000)).toBe(0);
        const [uid, owner, write] = run.out.trim().split("\n");
        expect(pdsVolumeVerdict({ uid: Number(uid), ownerUid: Number(owner), writeOk: write === "write-ok" })).toBe(
          "ok",
        );
      },
      () => void docker(["volume", "rm", volume], call),
    );
  });

  test("pds_root_owned_volume_fails", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    const volume = `unset-test-pdsroot-${hex()}`;
    withCleanup(
      () => {
        expect(docker(["volume", "create", volume], call).code).toBe(0);
        // /pds is not in the image, so a fresh volume there is root-owned (P1.29a: never mount /pds).
        const script = "id -u; stat -c %u /pds; touch /pds/write-ok && echo write-ok";
        const run = docker(pdsSh(volume, "/pds", script), call);
        const lines = run.out.trim().split("\n");
        const writeOk = lines.includes("write-ok") && run.code === 0;
        expect(pdsVolumeVerdict({ uid: Number(lines[0]), ownerUid: Number(lines[1]), writeOk })).not.toBe("ok");
        expect(Number(lines[1]) === 0 || writeOk === false).toBe(true);
      },
      () => void docker(["volume", "rm", volume], call),
    );
  });

  test("app_host_and_pds_host_resolve_to_the_edge", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    const network = `unset-test-edge-${hex()}`;
    const edge = `unset-test-edgec-${hex()}`;
    const app = "app.unset.localhost";
    const pdsHost = "pds.unset.localhost";
    withCleanup(
      () => {
        expect(docker(["network", "create", network], call).code).toBe(0);
        const started = docker(
          [
            "run",
            "-d",
            "--name",
            edge,
            "--network",
            network,
            "--network-alias",
            app,
            "--network-alias",
            pdsHost,
            "--entrypoint",
            "sleep",
            PDS as string,
            "120",
          ],
          call,
        );
        expect(started.code, started.err.slice(-2000)).toBe(0);
        const inspected = docker(["inspect", edge], call);
        expect(inspected.code, inspected.err.slice(-2000)).toBe(0);
        const info = JSON.parse(inspected.out) as {
          NetworkSettings: { Networks: Record<string, { IPAddress: string } | undefined> };
        }[];
        const edgeIp = info[0]?.NetworkSettings.Networks[network]?.IPAddress ?? "";
        expect(edgeIp).not.toBe("");
        const lookup = `const dns=require("node:dns");
Promise.all(${JSON.stringify([app, pdsHost])}.map((n)=>dns.promises.lookup(n,{all:true})))
  .then((a)=>console.log(JSON.stringify(a)));`;
        const fromPds = docker(
          ["run", "--rm", "--network", network, "--entrypoint", "node", PDS as string, "-e", lookup],
          call,
        );
        expect(fromPds.code, fromPds.err.slice(-2000)).toBe(0);
        const answers = JSON.parse(fromPds.out) as { address: string }[][];
        expect(answers).toHaveLength(2);
        for (const list of answers) {
          expect(list.length).toBeGreaterThan(0);
          expect(list.every((row) => row.address === edgeIp)).toBe(true);
        }
        expect(composeNetworkName(PROJECT, "edge")).toBe("unset-local_edge");
      },
      () => {
        docker(["rm", "-f", edge], call);
        docker(["network", "rm", network], call);
      },
    );
  });
});
