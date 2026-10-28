import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PAIRS, type Pair, parseLock, recipeContract, uiDirectoryOf } from "./contract.ts";

const UI_DIRECTORY = uiDirectoryOf(PAIRS["0.4.5037"] as Pair);

const locked = {
  schema: 1,
  base: {
    ref: "ghcr.io/bluesky-social/pds:0.4.5037@sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4",
    platform: "linux/amd64",
  },
  builder: {
    ref: "docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33",
    node: "26.10.0",
    pnpm: "11.11.0",
  },
  source: {
    revision: "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12",
    archiveSha256: "706ab7fa7410a406ed3d4e67837662e21ade7d4be4f6a33a491703c0805b0555",
    lockSha256: "d56b93f5fe51bbad31919df7039be088e9e61f80f57017a188f02e35f2ca16f8",
  },
  uiDirectory: UI_DIRECTORY,
};
const recipe = `FROM ${locked.builder.ref} AS ui-build\nADD --checksum=sha256:${locked.source.archiveSha256} https://codeload.github.com/bluesky-social/atproto/tar.gz/${locked.source.revision} /tmp/atproto.tar.gz\nFROM scratch AS ui-artifact\nCOPY --from=ui-build /build/dist/ /dist/\nFROM ${locked.base.ref}\nRUN rm -rf /${UI_DIRECTORY}\nCOPY --from=ui-artifact /dist/ /${UI_DIRECTORY}/\n`;
function root() {
  const dir = mkdtempSync(join(tmpdir(), "pds-contract-"));
  mkdirSync(join(dir, "deployment/pds"), { recursive: true });
  return dir;
}
describe("derived PDS recipe contract", () => {
  test("is absent only before both exact product inputs exist", () => {
    const dir = root();
    expect(recipeContract(dir)).toBeNull();
    writeFileSync(join(dir, "deployment/pds/Dockerfile"), recipe);
    expect(() => recipeContract(dir)).toThrow();
    writeFileSync(join(dir, "deployment/pds/source.lock.json"), JSON.stringify(locked));
    expect(recipeContract(dir)).toEqual(locked);
  });
  test("rejects missing recipe and malformed or widened locks", () => {
    const dir = root();
    writeFileSync(join(dir, "deployment/pds/source.lock.json"), JSON.stringify(locked));
    expect(() => recipeContract(dir)).toThrow();
    for (const delta of [
      { uiDirectory: "app" },
      { source: { ...locked.source, revision: "main" } },
      { base: { ref: "latest", platform: "linux/amd64" } },
      { schema: 2 },
      { builder: { ...locked.builder, pnpm: "latest" } },
    ])
      expect(() => parseLock(JSON.stringify({ ...locked, ...delta }))).toThrow();
  });
  test("pds_lock_accepts_each_reviewed_pair_only_with_its_ui_directory", () => {
    const next = PAIRS["0.4.5049"] as Pair;
    const repinned = {
      ...locked,
      base: { ...locked.base, ref: `ghcr.io/bluesky-social/pds:0.4.5049@sha256:${"c".repeat(64)}` },
      uiDirectory: uiDirectoryOf(next),
    };
    expect(parseLock(JSON.stringify(repinned))).toEqual(repinned);
    expect(() => parseLock(JSON.stringify({ ...repinned, uiDirectory: UI_DIRECTORY }))).toThrow();
    expect(() => parseLock(JSON.stringify({ ...locked, uiDirectory: uiDirectoryOf(next) }))).toThrow();
    const unreviewed = { ...locked.base, ref: `ghcr.io/bluesky-social/pds:0.4.5040@sha256:${"c".repeat(64)}` };
    expect(() => parseLock(JSON.stringify({ ...locked, base: unreviewed }))).toThrow();
    const dir = root();
    writeFileSync(join(dir, "deployment/pds/source.lock.json"), JSON.stringify(repinned));
    writeFileSync(join(dir, "deployment/pds/Dockerfile"), recipe.replace(locked.base.ref, repinned.base.ref));
    expect(() => recipeContract(dir)).toThrow();
    writeFileSync(
      join(dir, "deployment/pds/Dockerfile"),
      recipe.replace(locked.base.ref, repinned.base.ref).replaceAll(UI_DIRECTORY, repinned.uiDirectory),
    );
    expect(recipeContract(dir)).toEqual(repinned);
  });
  test("rejects unexported UI stage and any runtime command outside exact replacement", () => {
    for (const text of [
      recipe.replace("ADD --checksum", "RUN echo ADD --checksum"),
      recipe.replace("AS ui-artifact", "AS other"),
      `${recipe}USER node\n`,
      recipe.replace(`rm -rf /${UI_DIRECTORY}`, "rm -rf /app"),
      recipe.replace(locked.builder.ref, "node:latest"),
    ]) {
      const dir = root();
      writeFileSync(join(dir, "deployment/pds/source.lock.json"), JSON.stringify(locked));
      writeFileSync(join(dir, "deployment/pds/Dockerfile"), text);
      expect(() => recipeContract(dir)).toThrow();
    }
  });
});
