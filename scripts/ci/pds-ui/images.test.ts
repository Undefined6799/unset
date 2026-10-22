import { describe, expect, test } from "vitest";
import { image, sha, tar } from "./fixtures/native.ts";
import { compareImages, manifestConfig, platformManifest, UI_DIRECTORY } from "./images.ts";

const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
function index(manifests: { digest: string; platform: string }[]) {
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: manifests.map(({ digest, platform }) => {
        const [os, architecture] = platform.split("/");
        return { mediaType: MANIFEST, digest, size: 1, platform: { os, architecture } };
      }),
    }),
  );
  return { bytes, digest: `sha256:${sha(bytes)}` };
}
async function images() {
  const baseLayer = await tar([{ name: "app/provider.js", body: "original" }]);
  const uiLayer = await tar([{ name: `${UI_DIRECTORY}/new.js`, body: "new" }]);
  // A classic-store save: the archive's own manifest, never the registry index the lock pins.
  const base = await image([baseLayer]);
  const candidate = await image([baseLayer, uiLayer]);
  return { base, candidate, pinned: `sha256:${"a".repeat(64)}` };
}

describe("pinned base saved by a classic image store", () => {
  test("accepts a saved manifest whose config the pinned index names", async () => {
    const { base, candidate, pinned } = await images();
    const pin = { digest: pinned, config: base.config };
    const result = await compareImages(base.bytes, pin, candidate.bytes, candidate.digest);
    expect(result.ui.get("new.js")?.data.toString()).toBe("new");
  });
  test("rejects a saved manifest with any other config", async () => {
    const { base, candidate, pinned } = await images();
    const pin = { digest: pinned, config: `sha256:${"b".repeat(64)}` };
    await expect(compareImages(base.bytes, pin, candidate.bytes, candidate.digest)).rejects.toThrow(
      "immutable image config drift",
    );
  });
  test("keeps the exact digest rule when no pinned config is given", async () => {
    const { base, candidate, pinned } = await images();
    await expect(compareImages(base.bytes, pinned, candidate.bytes, candidate.digest)).rejects.toThrow(
      "immutable image digest drift",
    );
  });
  test("never relaxes the candidate's digest", async () => {
    const { base, candidate } = await images();
    const pin = { digest: base.digest, config: base.config };
    await expect(compareImages(base.bytes, pin, candidate.bytes, `sha256:${"c".repeat(64)}`)).rejects.toThrow(
      "immutable image digest drift",
    );
  });
});

describe("pinned registry documents", () => {
  test("follows the pinned index to its platform manifest and that manifest's config", async () => {
    const { base } = await images();
    const manifest = `sha256:${sha(base.manifest)}`;
    const pinned = index([
      { digest: manifest, platform: "linux/amd64" },
      { digest: `sha256:${"d".repeat(64)}`, platform: "linux/arm64" },
    ]);
    expect(platformManifest(pinned.bytes, pinned.digest, "linux/amd64")).toBe(manifest);
    expect(manifestConfig(base.manifest, manifest)).toBe(base.config);
  });
  test("rejects an index that does not hash to the pin", () => {
    const pinned = index([{ digest: `sha256:${"d".repeat(64)}`, platform: "linux/amd64" }]);
    expect(() => platformManifest(pinned.bytes, `sha256:${"e".repeat(64)}`, "linux/amd64")).toThrow(
      "pinned index digest drift",
    );
  });
  test("rejects a missing or ambiguous platform", () => {
    const twice = index([
      { digest: `sha256:${"d".repeat(64)}`, platform: "linux/amd64" },
      { digest: `sha256:${"e".repeat(64)}`, platform: "linux/amd64" },
    ]);
    expect(() => platformManifest(twice.bytes, twice.digest, "linux/amd64")).toThrow(/ambiguous/);
    expect(() => platformManifest(twice.bytes, twice.digest, "linux/arm64")).toThrow(/ambiguous/);
  });
  test("rejects a manifest that does not hash to the digest the index named", async () => {
    const { base } = await images();
    expect(() => manifestConfig(base.manifest, `sha256:${"f".repeat(64)}`)).toThrow(
      "pinned platform manifest digest drift",
    );
  });
});
