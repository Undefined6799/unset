import { createECDH, randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cleanUpAll, docker, failAfterCleanup } from "../../support/docker.ts";
import { nativeClient } from "./client.ts";
import { sha256, stageInputs } from "./inputs.ts";
import { rpc, startTransport } from "./transport.ts";

const LABEL = "sh.unset.pds-ui-fixture";
const CALL_MS = 10_000;
const checked = (args: string[], input?: string) => {
  const result = docker(args, { timeoutMs: CALL_MS, ...(input === undefined ? {} : { input }) });
  if (result.code !== 0)
    throw new Error(
      `fixture docker ${args[0]} failed (${result.err.includes("mount") ? "mount refused" : result.err.includes("No space") ? "VM space" : "runtime refused"})`,
    );
  return result.out.trim();
};
/** Max two serving containers/two internal networks during sentinel check, <=384MiB PDS data and 5min whole lifecycle. */
export async function startPdsUiFixture() {
  const owner = `unset-pds-h-${randomBytes(8).toString("hex")}`;
  const dir = mkdtempSync(join(import.meta.dirname, "../../../node_modules/.pds-h-"));
  const containers = new Set<string>(),
    networks = new Set<string>();
  let transport: Awaited<ReturnType<typeof startTransport>> | undefined;
  const closeResources = () =>
    cleanUpAll(
      ...[...containers].map((name) => () => removeOwned("container", name)),
      ...[...networks].map((name) => () => removeOwned("network", name)),
      () => rmSync(dir, { recursive: true, force: true }),
    );
  function removeOwned(kind: "container" | "network", name: string) {
    const field = kind === "container" ? ".Config.Labels" : ".Labels";
    const found = docker([kind, "inspect", "--format", `{{index ${field} "${LABEL}"}}`, name], { timeoutMs: CALL_MS });
    if (found.code !== 0) {
      if (found.err.includes("No such")) return;
      throw new Error("fixture cleanup inspection failed");
    }
    if (found.out.trim() !== owner) throw new Error("fixture cleanup owner mismatch");
    checked(kind === "container" ? ["rm", "-f", "-v", name] : ["network", "rm", name]);
  }
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const close = async () => {
    clearTimeout(watchdog);
    transport?.close();
    closeResources();
    containers.clear();
    networks.clear();
  };
  try {
    const inputs = await stageInputs(dir);
    for (const file of ["helper.ts", "mail.ts"]) copyFileSync(join(import.meta.dirname, file), join(dir, file));
    const helperHash = sha256(readFileSync(join(dir, "helper.ts")));
    const hardening = [
      "--pull=never",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=96",
      "--log-driver=none",
      "--dns=127.0.0.1",
      "--cpus=0.5",
    ];
    const network = owner;
    networks.add(network);
    checked([
      "network",
      "create",
      "--internal",
      "--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated",
      "--label",
      `${LABEL}=${owner}`,
      network,
    ]);
    async function startHelper(name: string, privateNetwork: string) {
      containers.add(name);
      checked([
        "run",
        "-d",
        `--name=${name}`,
        `--label=${LABEL}=${owner}`,
        `--network=${privateNetwork}`,
        "--network-alias=helper",
        ...hardening,
        "--memory=192m",
        `--mount=type=bind,src=${dir},dst=/runtime,readonly`,
        inputs.node,
        "node",
        "/runtime/helper.ts",
        "serve",
      ]);
      for (let n = 0; ; n++) {
        const ready = docker(
          [
            "exec",
            name,
            "node",
            "-e",
            'fetch("http://127.0.0.1:2590/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))',
          ],
          { timeoutMs: CALL_MS },
        );
        if (ready.code === 0) return;
        if (n >= 20) throw new Error("fixture helper readiness timeout");
        await delay(100);
      }
    }
    const helper = `${owner}-helper`;
    await startHelper(helper, network);
    transport = await startTransport(helper);
    const { port, send } = transport;
    const baseUrl = "https://pds.fixture.test";
    // A live controlled sentinel on another owned internal network, removed before PDS starts.
    // Max two simultaneous containers; no probe contacts public/operated services.
    const deniedNetwork = `${owner}-denied`,
      sentinel = `${owner}-sentinel`;
    networks.add(deniedNetwork);
    checked([
      "network",
      "create",
      "--internal",
      "--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated",
      "--label",
      `${LABEL}=${owner}`,
      deniedNetwork,
    ]);
    await startHelper(sentinel, deniedNetwork);
    const sentinelIp = JSON.parse(checked(["inspect", sentinel]))[0].NetworkSettings.Networks[deniedNetwork]
      .IPAddress as string;
    const denial = await rpc(helper, { kind: "deny", port, path: sentinelIp, method: "GET", headers: {}, body: "" });
    const refusal = JSON.parse(denial.body) as {
      denied: boolean;
      dnsDenied: boolean;
      forwardingDenied: boolean;
      noDefaultRoute: boolean;
    };
    if (!refusal.denied) throw new Error("fixture egress probe admitted a target");
    checked(["rm", "-f", sentinel]);
    containers.delete(sentinel);
    checked(["network", "rm", deniedNetwork]);
    networks.delete(deniedNetwork);
    const pds = `${owner}-pds`;
    const key = createECDH("secp256k1");
    key.generateKeys();
    const fixtureEnv: Record<string, string> = {
      PDS_HOSTNAME: "pds.fixture.test",
      PDS_PORT: String(port),
      PDS_DEV_MODE: "false",
      PDS_DISABLE_SSRF_PROTECTION: "false",
      PDS_DATA_DIRECTORY: "/data",
      PDS_BLOBSTORE_DISK_LOCATION: "/data/blobs",
      PDS_JWT_SECRET: randomBytes(32).toString("hex"),
      PDS_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
      PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX: key.getPrivateKey("hex"),
      PDS_DID_PLC_URL: "http://helper:2582",
      PDS_EMAIL_SMTP_URL: "smtp://helper:1025",
      PDS_EMAIL_FROM_ADDRESS: "sender@fixture.test",
      PDS_INVITE_REQUIRED: "false",
      PDS_SERVICE_HANDLE_DOMAINS: ".test",
      PDS_CRAWLERS: "",
      LOG_ENABLED: "false",
    };
    writeFileSync(
      join(dir, "fixture.env"),
      Object.entries(fixtureEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      { mode: 0o600 },
    );
    containers.add(pds);
    checked([
      "run",
      "-d",
      `--name=${pds}`,
      `--label=${LABEL}=${owner}`,
      `--network=${network}`,
      "--network-alias=pds",
      ...hardening,
      "--memory=512m",
      "--tmpfs=/data:rw,nosuid,nodev,size=384m",
      "--tmpfs=/tmp:rw,nosuid,nodev,size=16m",
      `--env-file=${join(dir, "fixture.env")}`,
      inputs.pds,
    ]);
    rmSync(join(dir, "fixture.env"));
    // Only read-only startup probes retry; native mutations are never retried.
    for (let n = 0; ; n++) {
      const response = await send(
        "/account/sign-in",
        "GET",
        { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
        "",
      ).catch(() => null);
      if (response?.status === 200) break;
      if (n >= 20)
        throw new Error(
          `fixture native readiness timeout (${checked(["inspect", "--format", "{{.State.Status}}/{{.State.ExitCode}}", pds])})`,
        );
      await delay(100);
    }
    const inspected = JSON.parse(checked(["inspect", pds]))[0];
    const image = JSON.parse(checked(["image", "inspect", inputs.pds]))[0];
    const nativeCommand = ["Entrypoint", "Cmd", "WorkingDir"].every(
      (field) => JSON.stringify(inspected.Config[field]) === JSON.stringify(image.Config[field]),
    );
    // Docker gateway mode isolated removes the host bridge address (port-publishing/#gateway-modes).
    const inspectedNetwork = JSON.parse(checked(["network", "inspect", network]))[0];
    const internal =
      inspectedNetwork.Internal === true &&
      inspectedNetwork.EnableIPv6 === false &&
      inspectedNetwork.Options["com.docker.network.bridge.gateway_mode_ipv4"] === "isolated";
    const flags = inspected.Config.Env as string[];
    const ssrfProtection = flags.includes("PDS_DEV_MODE=false") && flags.includes("PDS_DISABLE_SSRF_PROTECTION=false");
    const helperInspected = JSON.parse(checked(["inspect", helper]))[0];
    const attachmentSafe = [inspected, helperInspected].every(
      (container) =>
        JSON.stringify(Object.keys(container.NetworkSettings.Networks)) === JSON.stringify([network]) &&
        JSON.stringify(container.HostConfig.Dns) === '["127.0.0.1"]' &&
        container.HostConfig.ReadonlyRootfs === true &&
        container.NetworkSettings.Networks[network].Gateway === "" &&
        container.NetworkSettings.Networks[network].IPv6Gateway === "",
    );
    const attached = Object.keys(inspected.NetworkSettings.Networks);
    if (
      inspected.Config.User !== (image.Config.User ?? "") ||
      !nativeCommand ||
      !internal ||
      !attachmentSafe ||
      !ssrfProtection ||
      attached.length !== 1 ||
      attached[0] !== network
    )
      throw new Error(
        `fixture isolation mismatch (command=${nativeCommand}, internal=${internal}, protection=${ssrfProtection}, networks=${attached.length})`,
      );
    watchdog = setTimeout(() => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    }, 300_000);
    watchdog.unref();
    return {
      baseUrl,
      evidence: {
        internal,
        ssrfProtection,
        nativeCommand,
        ...refusal,
        platform: `${image.Os}/${image.Architecture}`,
        image: image.Id as string,
        configSha256: sha256(JSON.stringify(image.Config)),
        helperHash,
        ...inputs,
      },
      client: () => nativeClient(baseUrl, send),
      mailbox: {
        async code(recipient: string, purpose: string): Promise<string> {
          for (let n = 0; n < 30; n++) {
            const reply = await rpc(helper, {
              kind: "mail",
              port,
              path: "/mail",
              method: "POST",
              headers: {},
              body: JSON.stringify({ recipient, purpose }),
            });
            if (reply.status !== 200) throw new Error("fixture mailbox refused");
            const code = (JSON.parse(reply.body) as { code: string | null }).code;
            if (code) return code;
            await delay(100);
          }
          throw new Error("fixture native mail timeout");
        },
      },
      async plcContains(did: string) {
        const reply = await rpc(helper, { kind: "plc", port, path: `/${did}`, method: "GET", headers: {}, body: "" });
        const document = JSON.parse(reply.body) as { id: string };
        return reply.status === 200 && document.id === did;
      },
      resourcesRemain: () =>
        checked(["ps", "-a", "--filter", `label=${LABEL}=${owner}`, "--format", "{{.ID}}"]) !== "" ||
        checked(["network", "ls", "--filter", `label=${LABEL}=${owner}`, "--format", "{{.ID}}"]) !== "",
      close,
    };
  } catch (failure) {
    clearTimeout(watchdog);
    transport?.close();
    failAfterCleanup(failure, closeResources);
  }
}
