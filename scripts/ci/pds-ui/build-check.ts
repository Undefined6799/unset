// CI-only orchestration; the separately registered builder leaf is never imported.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archive, requireThat } from "./archive.ts";
import { buildCommands, inputProof, observeInputs, sameInputs, stageInputs, verifyContext } from "./build-inputs.ts";
import { ROOT, readArtifact, readBounded, verifyInputs } from "./cli.ts";
import { parseLock, recipeContract } from "./contract.ts";
import { planPatches } from "./source-patches.ts";
import { verifySource } from "./verify.ts";

async function main(): Promise<void> {
  const registered = recipeContract(ROOT);
  if (registered === null) {
    console.log("pds-ui: no candidate recipe or source lock");
    return;
  }
  const observed = observeInputs(ROOT);
  const lock = parseLock((observed.files.get("deployment/pds/source.lock.json") as Buffer).toString());
  requireThat(
    process.platform === "linux" && lock.base.platform === `linux/${process.arch === "x64" ? "amd64" : process.arch}`,
    "PDS CI verification requires its declared native Linux platform",
  );
  const scratch = mkdtempSync(join(tmpdir(), "pds-ui-check-"));
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", timeout: 20 * 60_000 });
  try {
    const source = join(scratch, "source.tar.gz");
    run("curl", [
      "--fail",
      "--location",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-time",
      "120",
      "--max-filesize",
      String(512 * 1024 * 1024),
      "--output",
      source,
      `https://codeload.github.com/bluesky-social/atproto/tar.gz/${lock.source.revision}`,
    ]);
    const sourceFiles = await verifySource(readBounded(source), lock.source);
    if (observed.mode === "local") {
      planPatches(sourceFiles, lock.source.revision, observed.files);
      mkdirSync(join(scratch, "context"));
      stageInputs(observed, join(scratch, "context"));
    }
    sameInputs(observed, observeInputs(ROOT));
    for (const args of buildCommands(observed, lock.base.platform, scratch)) {
      if (observed.mode === "local") verifyContext(observed, join(scratch, "context"));
      run("docker", args);
      if (observed.mode === "local") verifyContext(observed, join(scratch, "context"));
    }
    const iid = readFileSync(join(scratch, "iid"), "utf8").trim();
    requireThat(/^sha256:[0-9a-f]{64}$/.test(iid), "invalid candidate content id");
    run("docker", ["image", "save", "--output", join(scratch, "candidate.tar"), iid]);
    run("docker", ["pull", "--platform", lock.base.platform, lock.base.ref]);
    run("docker", ["image", "save", "--output", join(scratch, "base.tar"), lock.base.ref]);
    const candidate = readBounded(join(scratch, "candidate.tar"));
    const saved = await archive(candidate);
    const index = JSON.parse(saved.get("index.json")?.data.toString() ?? "");
    requireThat(index.manifests?.length === 1, "ambiguous candidate archive");
    const proof = await verifyInputs(
      lock,
      readBounded(source),
      readBounded(join(scratch, "base.tar")),
      candidate,
      index.manifests[0].digest,
      readArtifact(join(scratch, "artifact/dist")),
    );
    sameInputs(observed, observeInputs(ROOT));
    const receipt = {
      schema: 1,
      ...inputProof(observed),
      ...proof,
    };
    const serialized = JSON.stringify(receipt);
    // RUNNER_TEMP is outside the checkout; no recipe may mutate the trusted proof.
    const output = process.env.RUNNER_TEMP;
    requireThat(output, "RUNNER_TEMP is required for the verification receipt");
    writeFileSync(join(output, "pds-ui-proof.json"), `${serialized}\n`, { flag: "wx" });
    console.log(serialized);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
