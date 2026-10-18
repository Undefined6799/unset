// P1.29t: running-local-stack judgements with stand-ins. Docker and the PDS are unmanaged; the image tests run the
// same helpers against real containers. Nothing here creates an account or calls the email-token reader.
import { describe, expect, test } from "vitest";
import {
  argvCreatesAccount,
  CLIENT_ID_PATH,
  clientIdProbePlan,
  clientMetadataProblem,
  composeNetworkName,
  deviceRowVerdict,
  edgeAddressFromInspect,
  hostResolvesToEdge,
  LOCAL_HANDLES,
  PDS_UID,
  PROJECT,
  pdsVolumeVerdict,
  probeEnv,
} from "../tests/support/local-stack.ts";

const EDGE_IP = "172.18.0.2";
const CLIENT_IP = "203.0.113.50";
const APP_HOST = "app.unset.localhost";
const CLIENT_ID = `https://${APP_HOST}${CLIENT_ID_PATH}`;
const CA = "-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----\n";
const inspect = (ip: string, project = PROJECT, network = "edge") => ({
  NetworkSettings: { Networks: { [composeNetworkName(project, network)]: { IPAddress: ip } } },
});

describe("running local stack (P1.29t)", () => {
  test("probe_runs_under_local_only", () => {
    expect(probeEnv("local")).toBe("ok");
    for (const env of [undefined, "dev", "prod", "LOCAL", ""]) {
      expect(probeEnv(env), String(env)).toBe("probe.not_local");
      expect(clientIdProbePlan({ env, inspect: inspect(EDGE_IP), appHost: APP_HOST, ca: CA })).toEqual({
        ok: false,
        reason: "probe.not_local",
      });
      expect(deviceRowVerdict({ env, handle: LOCAL_HANDLES[0], deviceIp: EDGE_IP, inspect: inspect(EDGE_IP) })).toEqual(
        {
          ok: false,
          reason: "probe.not_local",
        },
      );
    }
  });

  test("client_id_probe_pins_the_edge_address_and_dev_root", () => {
    const missing = clientIdProbePlan({ env: "local", inspect: {}, appHost: APP_HOST, ca: CA });
    expect(missing).toEqual({ ok: false, reason: "probe.edge_address_missing" });
    const plan = clientIdProbePlan({ env: "local", inspect: inspect(EDGE_IP), appHost: APP_HOST, ca: CA });
    expect(plan).toEqual({
      ok: true,
      get: { host: APP_HOST, path: CLIENT_ID_PATH, address: EDGE_IP, ca: CA, rejectUnauthorized: true },
    });
    if (!plan.ok) throw new Error("expected a GET plan");
    expect(plan.get.address).not.toBe(CLIENT_IP);
    expect(JSON.stringify(plan)).not.toContain(CLIENT_IP);
  });

  test("client_id_body_parses_as_client_metadata", () => {
    expect(clientMetadataProblem({ client_id: CLIENT_ID }, CLIENT_ID)).toBeNull();
    expect(clientMetadataProblem({ client_id: "https://other.example/oauth-client-metadata.json" }, CLIENT_ID)).toBe(
      "probe.client_id_not_metadata",
    );
    expect(clientMetadataProblem("not json", CLIENT_ID)).toBe("probe.client_id_not_metadata");
    expect(clientMetadataProblem(null, CLIENT_ID)).toBe("probe.client_id_not_metadata");
  });

  test("pds_device_row_has_no_client_ip", () => {
    const seen = inspect(EDGE_IP);
    expect(edgeAddressFromInspect(seen)).toBe(EDGE_IP);
    expect(deviceRowVerdict({ env: "local", handle: "alice.unset.im", deviceIp: EDGE_IP, inspect: seen })).toEqual({
      ok: true,
    });
    expect(deviceRowVerdict({ env: "local", handle: "bob.unset.im", deviceIp: EDGE_IP, inspect: seen })).toEqual({
      ok: true,
    });
    const leaked = deviceRowVerdict({
      env: "local",
      handle: "alice.unset.im",
      deviceIp: CLIENT_IP,
      inspect: seen,
    });
    expect(leaked).toEqual({ ok: false, reason: "pds.device_row_has_client_ip" });
    expect(JSON.stringify(leaked)).not.toContain(CLIENT_IP);
    expect(JSON.stringify(leaked)).not.toContain("alice");
    expect(deviceRowVerdict({ env: "local", handle: "carol.unset.im", deviceIp: EDGE_IP, inspect: seen })).toEqual({
      ok: false,
      reason: "probe.handle_not_local_test_account",
    });
  });

  test("app_host_and_pds_host_resolve_to_the_edge", () => {
    expect(hostResolvesToEdge([EDGE_IP], EDGE_IP)).toBe("ok");
    expect(hostResolvesToEdge([CLIENT_IP], EDGE_IP)).toBe("probe.host_not_edge");
    expect(hostResolvesToEdge([EDGE_IP, CLIENT_IP], EDGE_IP)).toBe("probe.host_not_edge");
    expect(hostResolvesToEdge([], EDGE_IP)).toBe("probe.host_not_edge");
    expect(hostResolvesToEdge([EDGE_IP], "")).toBe("probe.edge_address_missing");
  });

  test("pds_user_and_volume_are_uid_1000", () => {
    expect(pdsVolumeVerdict({ uid: PDS_UID, ownerUid: PDS_UID, writeOk: true })).toBe("ok");
    expect(pdsVolumeVerdict({ uid: 0, ownerUid: PDS_UID, writeOk: true })).toBe("pds.not_uid_1000");
    expect(pdsVolumeVerdict({ uid: PDS_UID, ownerUid: 0, writeOk: false })).toBe("pds.volume_not_owned_by_1000");
    expect(pdsVolumeVerdict({ uid: PDS_UID, ownerUid: PDS_UID, writeOk: false })).toBe("pds.volume_not_writable");
  });

  test("local_up_creates_no_account", () => {
    expect(argvCreatesAccount(["node", "scripts/dev-precheck.ts", "docker", "compose", "up"])).toBe(false);
    expect(argvCreatesAccount(["node", "scripts/dev-seed.ts"])).toBe(true);
    expect(argvCreatesAccount(["createAccount"])).toBe(true);
    expect(argvCreatesAccount([".seeded.json"])).toBe(true);
    expect(argvCreatesAccount(["pds-token-reader"])).toBe(true);
  });
});
