import { mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { readArtifact, readBounded, verifyInputs } from "./cli.ts";
import { parseLock, UI_DIRECTORY } from "./contract.ts";
import { artifacts, image, sha, tar } from "./fixtures/native.ts";
import { verifySource } from "./verify.ts";

const ui = UI_DIRECTORY;
const file = { name: "app/provider.js", body: "original" };
const link = { name: "app/provider-link", type: "symlink" as const, linkname: "provider.js" };
const temporary: string[] = [];
afterAll(() => {
  for (const path of temporary) rmSync(path, { recursive: true, force: true });
});
describe("source and installed artifact coupling", () => {
  test("reads real artifact files and refuses symlink inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "pds-artifact-"));
    temporary.push(root);
    writeFileSync(join(root, "asset.js"), "bytes");
    expect(readArtifact(root).get("asset.js")?.toString()).toBe("bytes");
    symlinkSync(join(root, "asset.js"), join(root, "link"));
    expect(() => readBounded(join(root, "link"))).toThrow();
    expect(() => readArtifact(root)).toThrow();
  });
  test("bounds artifact output before reading oversized files", () => {
    const root = mkdtempSync(join(tmpdir(), "pds-artifact-large-"));
    temporary.push(root);
    const file = join(root, "oversized.js");
    writeFileSync(file, "");
    truncateSync(file, 128 * 1024 * 1024 + 1);
    expect(() => readArtifact(root)).toThrow(/artifact.*limit/);
  });
  test("binds actual source, installed packages and every installed artifact byte", async () => {
    const revision = "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12";
    const packages = {
      "packages/pds": ["@atproto/pds", "0.5.37"],
      "packages/oauth/oauth-provider": ["@atproto/oauth-provider", "0.23.1"],
      "packages/oauth/oauth-provider-ui": ["@atproto/oauth-provider-ui", "0.10.5"],
    };
    const source = await tar([
      { name: `atproto-${revision}/pnpm-lock.yaml`, body: "frozen" },
      ...Object.entries(packages).map(([path, [name, version]]) => ({
        name: `atproto-${revision}/${path}/package.json`,
        body: JSON.stringify({ name, version }),
      })),
    ]);
    const packageEntries = Object.values(packages).map(([name, version]) => ({
      name: `app/node_modules/.pnpm/${name?.replace("/", "+")}@${version}/node_modules/${name}/package.json`,
      body: JSON.stringify({ name, version }),
    }));
    const artifact = artifacts();
    const baseLayer = await tar([file, link, ...packageEntries]);
    const base = await image([baseLayer]);
    const candidate = await image([
      baseLayer,
      await tar([...artifact].map(([name, body]) => ({ name: `${ui}/${name}`, body }))),
    ]);
    const lock = parseLock(
      JSON.stringify({
        schema: 1,
        base: { ref: `ghcr.io/bluesky-social/pds:0.4.5037@${base.digest}`, platform: "linux/arm64" },
        builder: {
          ref: `docker.io/library/node:26-trixie-slim@sha256:${"0".repeat(64)}`,
          node: "26.10.0",
          pnpm: "11.11.0",
        },
        source: { revision, archiveSha256: sha(source), lockSha256: sha("frozen") },
        uiDirectory: ui,
      }),
    );
    const proof = await verifyInputs(lock, source, base.bytes, candidate.bytes, candidate.digest, artifact);
    expect(proof.manifestFiles).toBe(5);
    expect(proof.candidateDigest).toBe(candidate.digest);
    const tampered = new Map(artifact);
    tampered.set("shared.css", Buffer.from("changed"));
    const manifest = JSON.parse(tampered.get("bundle-manifest.json")?.toString() ?? "");
    manifest["shared.css"].sha256 = Buffer.from(sha("changed"), "hex").toString("base64");
    tampered.set("bundle-manifest.json", Buffer.from(JSON.stringify(manifest)));
    await expect(verifyInputs(lock, source, base.bytes, candidate.bytes, candidate.digest, tampered)).rejects.toThrow(
      /installed UI differs/,
    );
    const wrongPackage = await image([
      await tar([
        {
          ...packageEntries[0],
          name: packageEntries[0]?.name ?? "",
          body: JSON.stringify({ name: "@atproto/pds", version: "0.5.38" }),
        },
        ...packageEntries.slice(1),
        ...[...artifact].map(([name, body]) => ({ name: `${ui}/${name}`, body })),
        file,
        link,
      ]),
    ]);
    const wrongLock = {
      ...lock,
      base: { ...lock.base, ref: `ghcr.io/bluesky-social/pds:0.4.5037@${wrongPackage.digest}` },
    };
    await expect(
      verifyInputs(wrongLock, source, wrongPackage.bytes, wrongPackage.bytes, wrongPackage.digest, artifact),
    ).rejects.toThrow(/image\/source package drift/);
  });
  test("binds source archive revision, upstream lock and package versions", async () => {
    const revision = "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12";
    const root = `atproto-${revision}`;
    const packages = {
      "packages/pds": ["@atproto/pds", "0.5.37"],
      "packages/oauth/oauth-provider": ["@atproto/oauth-provider", "0.23.1"],
      "packages/oauth/oauth-provider-ui": ["@atproto/oauth-provider-ui", "0.10.5"],
    };
    const source = await tar([
      { name: `${root}/pnpm-lock.yaml`, body: "frozen" },
      ...Object.entries(packages).map(([path, [name, version]]) => ({
        name: `${root}/${path}/package.json`,
        body: JSON.stringify({ name, version }),
      })),
    ]);
    const global = (await tar([{ name: "pax_global_header", body: `52 comment=${revision}\n` }])).subarray(0, 1024);
    global[156] = 103;
    global.fill(32, 148, 156);
    const checksum = global.subarray(0, 512).reduce((a, b) => a + b, 0);
    global.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    const native = Buffer.concat([global, source]);
    await expect(
      verifySource(native, { revision, archiveSha256: sha(native), lockSha256: sha("frozen") }),
    ).resolves.toBeUndefined();
    const lock = { revision, archiveSha256: sha(source), lockSha256: sha("frozen") };
    await expect(verifySource(source, lock)).resolves.toBeUndefined();
    const badSource = await tar([
      { name: `${root}/pnpm-lock.yaml`, body: "frozen" },
      ...Object.entries(packages).map(([path, [name, version]]) => ({
        name: `${root}/${path}/package.json`,
        body: JSON.stringify({ name, version: path.endsWith("provider-ui") ? "0.10.6" : version }),
      })),
    ]);
    await expect(verifySource(badSource, { ...lock, archiveSha256: sha(badSource) })).rejects.toThrow(/version/);
    for (const delta of [
      { revision: "0".repeat(40) },
      { archiveSha256: "0".repeat(64) },
      { lockSha256: "0".repeat(64) },
    ])
      await expect(verifySource(source, { ...lock, ...delta })).rejects.toThrow();
  });
});
