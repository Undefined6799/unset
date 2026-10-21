import { createECDH, randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeClient } from "./client.ts";
import { type FixtureContext, FixtureLifetime } from "./fixture-lifetime.ts";
import { fixtureProcess, missingFixtureResource } from "./fixture-process.ts";
import { sha256, stageInputs } from "./inputs.ts";
import { rpc, startTransport } from "./transport.ts";

const LABEL = "sh.unset.pds-ui-fixture";
const CALL_MS = 10_000;
/** One cancellation/deadline covers staging, startup and native work; finished hooks independently await cleanup. */
export async function startPdsUiFixture(ctx: FixtureContext) {
  const lifetime = new FixtureLifetime(ctx);
  const owner = `unset-pds-h-${randomBytes(8).toString("hex")}`;
  lifetime.check();
  const dir = mkdtempSync(join(import.meta.dirname, "../../../node_modules/.pds-h-"));
  lifetime.defer(() => rmSync(dir, { recursive: true, force: true }));
  const checked = async (args: string[], input?: string, signal = lifetime.signal) => {
    const result = await lifetime.command("docker", args, CALL_MS, input, signal);
    if (result.code !== 0) throw new Error(`fixture docker ${args[0]} failed`);
    return result.out.trim();
  };
  async function cleanupCommand(args: string[], signal: AbortSignal) {
    const result = await fixtureProcess("docker", args, signal, 5_000);
    if (result.code !== 0) throw new Error("fixture cleanup command failed");
    return result.out.trim();
  }
  function own(kind: "container" | "network", name: string) {
    const field = kind === "container" ? ".Config.Labels" : ".Labels";
    const removal = kind === "container" ? ["rm", "-f", "-v", name] : ["network", "rm", name];
    lifetime.defer(async (signal) => {
      const found = await fixtureProcess(
        "docker",
        [kind, "inspect", "--format", `{{index ${field} "${LABEL}"}}`, name],
        signal,
        5_000,
      );
      if (found.code !== 0) {
        if (missingFixtureResource(found)) return;
        throw new Error("fixture cleanup inspection failed");
      }
      if (found.out.trim() !== owner) throw new Error("fixture cleanup owner mismatch");
      await cleanupCommand(removal, signal);
    });
  }
  const resourcesRemain = async (signal = AbortSignal.timeout(10_000)) => {
    return (
      (await cleanupCommand(["ps", "-a", "--filter", `label=${LABEL}=${owner}`, "--format", "{{.ID}}"], signal)) !==
        "" ||
      (await cleanupCommand(
        ["network", "ls", "--filter", `label=${LABEL}=${owner}`, "--format", "{{.ID}}"],
        signal,
      )) !== ""
    );
  };
  // Registered before every resource callback, so reverse-order cleanup checks inventory last.
  lifetime.defer(async (signal) => {
    if (await resourcesRemain(signal)) throw new Error("fixture owned resources remain");
  });
  try {
    const inputs = await stageInputs(dir, lifetime);
    lifetime.check();
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
    own("network", network);
    await checked([
      "network",
      "create",
      "--internal",
      "--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated",
      "--label",
      `${LABEL}=${owner}`,
      network,
    ]);
    async function startHelper(name: string, privateNetwork: string) {
      own("container", name);
      await checked([
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
      await lifetime.poll("helper readiness", async (signal) => {
        const ready = await lifetime.command(
          "docker",
          [
            "exec",
            name,
            "node",
            "-e",
            'fetch("http://127.0.0.1:2590/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))',
          ],
          CALL_MS,
          undefined,
          signal,
        );
        return ready.code === 0 ? true : null;
      });
    }
    const helper = `${owner}-helper`;
    await startHelper(helper, network);
    const transport = await startTransport(helper, lifetime);
    const { port, send } = transport;
    const baseUrl = "https://pds.fixture.test";
    // A live controlled sentinel on another owned internal network, removed before PDS starts.
    // Max two simultaneous containers; no probe contacts public/operated services.
    const deniedNetwork = `${owner}-denied`,
      sentinel = `${owner}-sentinel`;
    own("network", deniedNetwork);
    await checked([
      "network",
      "create",
      "--internal",
      "--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated",
      "--label",
      `${LABEL}=${owner}`,
      deniedNetwork,
    ]);
    await startHelper(sentinel, deniedNetwork);
    const sentinelIp = JSON.parse(await checked(["inspect", sentinel]))[0].NetworkSettings.Networks[deniedNetwork]
      .IPAddress as string;
    const denial = await rpc(lifetime, helper, {
      kind: "deny",
      port,
      path: sentinelIp,
      method: "GET",
      headers: {},
      body: "",
    });
    const refusal = JSON.parse(denial.body) as {
      denied: boolean;
      dnsDenied: boolean;
      reservedNameUnresolved: boolean;
      noDefaultRoute: boolean;
    };
    if (!refusal.denied) throw new Error("fixture egress probe admitted a target");
    await checked(["rm", "-f", sentinel]);

    await checked(["network", "rm", deniedNetwork]);

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
    lifetime.check();
    writeFileSync(
      join(dir, "fixture.env"),
      Object.entries(fixtureEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      { mode: 0o600 },
    );
    own("container", pds);
    await checked([
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
    await lifetime.poll("native readiness", async (signal) => {
      const response = await send(
        "/account/sign-in",
        "GET",
        { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
        "",
        signal,
      ).catch(() => null);
      return response?.status === 200 ? true : null;
    });
    const inspected = JSON.parse(await checked(["inspect", pds]))[0];
    const image = JSON.parse(await checked(["image", "inspect", inputs.pds]))[0];
    const nativeCommand = ["Entrypoint", "Cmd", "WorkingDir"].every(
      (field) => JSON.stringify(inspected.Config[field]) === JSON.stringify(image.Config[field]),
    );
    // Docker gateway mode isolated removes the host bridge address (port-publishing/#gateway-modes).
    const inspectedNetwork = JSON.parse(await checked(["network", "inspect", network]))[0];
    const internal =
      inspectedNetwork.Internal === true &&
      inspectedNetwork.EnableIPv6 === false &&
      inspectedNetwork.Options["com.docker.network.bridge.gateway_mode_ipv4"] === "isolated";
    const flags = inspected.Config.Env as string[];
    const ssrfProtection = flags.includes("PDS_DEV_MODE=false") && flags.includes("PDS_DISABLE_SSRF_PROTECTION=false");
    const helperInspected = JSON.parse(await checked(["inspect", helper]))[0];
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
          return lifetime.poll("native mail", async (signal) => {
            const reply = await rpc(
              lifetime,
              helper,
              {
                kind: "mail",
                port,
                path: "/mail",
                method: "POST",
                headers: {},
                body: JSON.stringify({ recipient, purpose }),
              },
              signal,
            );
            if (reply.status !== 200) throw new Error("fixture mailbox refused");
            return (JSON.parse(reply.body) as { code: string | null }).code;
          });
        },
      },
      async plcContains(did: string) {
        const reply = await rpc(lifetime, helper, {
          kind: "plc",
          port,
          path: `/${did}`,
          method: "GET",
          headers: {},
          body: "",
        });
        const document = JSON.parse(reply.body) as { id: string };
        return reply.status === 200 && document.id === did;
      },
      resourcesRemain,
      close: () => lifetime.close(),
    };
  } catch (failure) {
    return lifetime.fail(failure);
  }
}
