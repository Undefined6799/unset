// Exact, checks-only recipe registration. No Compose/vendor admission or deploy import exception.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localInputs } from "./local-inputs.ts";
export const UI_DIRECTORY =
  "app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.5/node_modules/@atproto/oauth-provider-ui/dist";
export type Lock = {
  schema: 1;
  base: { ref: string; platform: "linux/amd64" | "linux/arm64" };
  builder: { ref: string; node: string; pnpm: string };
  source: { revision: string; archiveSha256: string; lockSha256: string };
  uiDirectory: string;
};
const HASH = /^[0-9a-f]{64}$/;
export function parseLock(text: string): Lock {
  const lock = JSON.parse(text) as Lock;
  if (
    lock.schema !== 1 ||
    lock.uiDirectory !== UI_DIRECTORY ||
    !["linux/amd64", "linux/arm64"].includes(lock.base.platform) ||
    !/^ghcr\.io\/bluesky-social\/pds:0\.4\.5037@sha256:[0-9a-f]{64}$/.test(lock.base.ref) ||
    !/^docker\.io\/library\/node:26-trixie-slim@sha256:[0-9a-f]{64}$/.test(lock.builder.ref) ||
    lock.builder.node !== "26.10.0" ||
    lock.builder.pnpm !== "11.11.0" ||
    !/^[0-9a-f]{40}$/.test(lock.source.revision) ||
    !HASH.test(lock.source.archiveSha256) ||
    !HASH.test(lock.source.lockSha256)
  )
    throw new Error("invalid PDS source lock");
  const fields = (object: object, allowed: string[]) =>
    Object.keys(object).every((key) => allowed.includes(key)) && Object.keys(object).length === allowed.length;
  if (
    !fields(lock, ["schema", "base", "builder", "source", "uiDirectory"]) ||
    !fields(lock.base, ["ref", "platform"]) ||
    !fields(lock.builder, ["ref", "node", "pnpm"]) ||
    !fields(lock.source, ["revision", "archiveSha256", "lockSha256"])
  )
    throw new Error("unexpected PDS lock field");
  return lock;
}
export function recipeContract(root: string): Lock | null {
  const dir = join(root, "deployment/pds");
  const recipePath = join(dir, "Dockerfile");
  const lockPath = join(dir, "source.lock.json");
  const recipeStat = lstatSync(recipePath, { throwIfNoEntry: false });
  const lockStat = lstatSync(lockPath, { throwIfNoEntry: false });
  if (!recipeStat && !lockStat) return null;
  if (!recipeStat?.isFile() || !lockStat?.isFile()) throw new Error("PDS recipe/lock must be regular files");
  const lock = parseLock(readFileSync(lockPath, "utf8"));
  const lines = readFileSync(recipePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (!lines.includes(`FROM ${lock.builder.ref} AS ui-build`) || !lines.includes("FROM scratch AS ui-artifact"))
    throw new Error("missing pinned UI builder/artifact stage");
  const sourceAdd = `ADD --checksum=sha256:${lock.source.archiveSha256} https://codeload.github.com/bluesky-social/atproto/tar.gz/${lock.source.revision} /tmp/atproto.tar.gz`;
  if (
    !lines.includes(sourceAdd) ||
    lines.filter((line) => /^ADD /i.test(line)).length !== 1 ||
    lines.filter((line) => /^FROM /i.test(line)).length !== 3
  )
    throw new Error("source input or stage drift");
  const final = lines.slice(lines.findLastIndex((line) => /^FROM /i.test(line)));
  const expected = [
    `FROM ${lock.base.ref}`,
    `RUN rm -rf /${UI_DIRECTORY}`,
    `COPY --from=ui-artifact /dist/ /${UI_DIRECTORY}/`,
  ];
  if (JSON.stringify(final) !== JSON.stringify(expected))
    throw new Error("PDS runtime recipe exceeds exact distribution replacement");
  localInputs(root);
  return lock;
}
