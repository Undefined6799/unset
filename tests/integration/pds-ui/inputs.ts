import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker, runOrKill } from "../../support/docker.ts";

const PLC_SHA512 = "GtxxHcOrOQ6fNI1ufq3Zqjc2PtWqPZOdsuzlwtxiH9XibUGwDkb0GmaBHyU5GiOxOKZEW1GspZ8mreBA6XOlTQ==";
const PLC_EXECUTABLE = "ed096a3438e99aa489e6cc170c6c0b94ec7515046395589b29858a6cb4339dfa";
export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function verifiedPlc(bytes: Buffer): Buffer {
  if (bytes.length !== 3_741_629 || createHash("sha512").update(bytes).digest("base64") !== PLC_SHA512)
    throw new Error("PLC archive integrity failure");
  return bytes;
}
// Fixed npm artifact: no user URL, no redirects, <=4MiB, <=30s including body.
async function downloadPlc(): Promise<Buffer> {
  try {
    const response = await fetch("https://registry.npmjs.org/@did-plc/server/-/server-0.0.1.tgz", {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) throw new Error("input unavailable");
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > 4_194_304) throw new Error("input limit");
      parts.push(part);
    }
    return Buffer.concat(parts);
  } catch {
    throw new Error("fixed PLC input staging failed");
  }
}
function stageImage(ref: string, platform: string) {
  if (!/^[-a-z0-9./:]+@sha256:[a-f0-9]{64}$/.test(ref)) throw new Error("invalid fixed image pin");
  if (process.env.CI === "true") {
    if (docker(["pull", "--platform", platform, ref], { timeoutMs: 60_000 }).code !== 0)
      throw new Error("fixed image staging failed");
  }
  if (docker(["image", "inspect", ref], { timeoutMs: 10_000 }).code !== 0)
    throw new Error("fixed cached image unavailable");
}
/** All software is staged before the internal network exists. Local runs never fetch or pull. */
export async function stageInputs(dir: string) {
  const lock = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../deployment/pds/source.lock.json"), "utf8"),
  ) as {
    base: { ref: string; platform: string };
    builder: { ref: string };
  };
  const archive = join(dir, "plc.tgz");
  const cached = "/tmp/unset-pds-ui-probe/plc-server-0.0.1.tgz";
  let bytes: Buffer;
  if (existsSync(cached)) bytes = readFileSync(cached);
  else {
    if (process.env.CI !== "true") throw new Error("fixed PLC input unavailable locally");
    bytes = await downloadPlc();
  }
  writeFileSync(archive, verifiedPlc(bytes), { mode: 0o600 });
  const extracted = runOrKill("tar", ["-xOf", archive, "package/dist/index.js"], { timeoutMs: 10_000 });
  if (extracted.code !== 0 || sha256(extracted.out) !== PLC_EXECUTABLE)
    throw new Error("PLC executable integrity failure");
  writeFileSync(join(dir, "plc.cjs"), extracted.out, { mode: 0o600 });
  const refs = [lock.base.ref, lock.builder.ref];
  for (const ref of refs) stageImage(ref, lock.base.platform);
  return { pds: lock.base.ref, node: lock.builder.ref, plcSha256: PLC_EXECUTABLE, archiveSha256: sha256(bytes) };
}
