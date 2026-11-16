import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PAIRS, type Pair, parseLock, recipeContract, uiDirectoryOf } from "./contract.ts";

const UI_DIRECTORY = uiDirectoryOf(PAIRS["0.4.5051"] as Pair);

const locked = {
  schema: 1,
  base: {
    ref: "ghcr.io/bluesky-social/pds:0.4.5051@sha256:8e58b79746da8a0e85698aa7ba9b53e508b94db2021d963653b6d1bfc14889c6",
    platform: "linux/amd64",
  },
  builder: {
    ref: "docker.io/library/node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec",
    node: "26.12.1",
    pnpm: "11.11.0",
  },
  source: {
    revision: "fb16c8e0247fb5159fd23ce0e5301249532d1b4e",
    archiveSha256: "8ec64f48214236a37ffe739b17fe80bfd060c2cf438ff028484cb24ebcc4dc08",
    lockSha256: "371a48189e93b5868a3538ffc9eb576a1dae48ad671aa029adda9851def1b2e5",
  },
  uiDirectory: UI_DIRECTORY,
};
/** The pair P1.38o dropped once the 0.4.5051 re-pin (#1611) merged; it had the same builder. */
const dropped = {
  ...locked,
  base: {
    ...locked.base,
    ref: "ghcr.io/bluesky-social/pds:0.4.5049@sha256:cca85fd07701ea3370ff5a3a0f38a4c108d45d49aa75944e38f45c186d9528cf",
  },
  uiDirectory: UI_DIRECTORY.replace("@0.11.0/", "@0.10.7/"),
};
/** The builder of 0.4.5037, which P1.38m dropped. */
const oldBuilder = {
  ref: "docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33",
  node: "26.10.0",
  pnpm: "11.11.0",
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
  test("pds_lock_accepts_only_the_reviewed_pair_with_its_ui_directory", () => {
    expect(Object.keys(PAIRS)).toEqual(["0.4.5051"]);
    expect(parseLock(JSON.stringify(locked))).toEqual(locked);
    expect(() => parseLock(JSON.stringify(dropped))).toThrow();
    expect(() => parseLock(JSON.stringify({ ...locked, uiDirectory: dropped.uiDirectory }))).toThrow();
    const unreviewed = { ...locked.base, ref: `ghcr.io/bluesky-social/pds:0.4.5040@sha256:${"c".repeat(64)}` };
    expect(() => parseLock(JSON.stringify({ ...locked, base: unreviewed }))).toThrow();
  });
  test("pds_lock_accepts_only_its_pairs_exact_builder", () => {
    expect((PAIRS["0.4.5051"] as Pair).builder).toEqual({ ref: locked.builder.ref, node: locked.builder.node });
    for (const builder of [
      oldBuilder,
      { ...locked.builder, node: "26.10.0" },
      { ...locked.builder, ref: oldBuilder.ref },
      { ...locked.builder, ref: `docker.io/library/node:26.12.1-trixie-slim@sha256:${"0".repeat(64)}` },
    ])
      expect(() => parseLock(JSON.stringify({ ...locked, builder }))).toThrow();
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
