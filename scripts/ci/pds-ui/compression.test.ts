import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { archive } from "./archive.ts";
import { PAIRS, type Pair, uiDirectoryOf } from "./contract.ts";
import { image, tar } from "./fixtures/native.ts";
import { compareImages } from "./images.ts";

const config = { Env: ["NODE_ENV=production"], Cmd: ["node", "index.ts"] };
async function inputs() {
  const baseLayer = await tar([{ name: "app/provider.js", body: "original" }]);
  const uiLayer = await tar([{ name: `${ui}/new.js`, body: "new" }]);
  return { baseLayer, uiLayer, base: await image([baseLayer]) };
}
const pair = PAIRS["0.4.5037"] as Pair;
const ui = uiDirectoryOf(pair);

describe("exact OCI compression interpretation", () => {
  test.each(["plain", "gzip"])("accepts a correctly declared %s layer", async (compression) => {
    const { baseLayer, uiLayer, base } = await inputs();
    const candidate = await image([baseLayer, uiLayer], config, false, compression === "gzip" ? [1] : []);
    const result = await compareImages(base.bytes, base.digest, candidate.bytes, candidate.digest, ui);
    expect(result.ui.get("new.js")?.data.toString()).toBe("new");
  });
  test("rejects gzip bytes labelled as plain tar with a compressed-byte diffID", async () => {
    const { baseLayer, uiLayer, base } = await inputs();
    const candidate = await image([baseLayer, gzipSync(uiLayer)]);
    await expect(compareImages(base.bytes, base.digest, candidate.bytes, candidate.digest, ui)).rejects.toThrow();
  });
  test("rejects nested gzip even when the outer compressed descriptor and inner gzip diffID match", async () => {
    const { baseLayer, uiLayer, base } = await inputs();
    const candidate = await image([baseLayer, gzipSync(uiLayer)], config, false, [1]);
    await expect(compareImages(base.bytes, base.digest, candidate.bytes, candidate.digest, ui)).rejects.toThrow();
  });
  test("raw archive parsing never decompresses its input", async () => {
    const raw = await tar([{ name: "asset.js", body: "data" }]);
    expect((await archive(raw)).get("asset.js")?.data.toString()).toBe("data");
    await expect(archive(gzipSync(raw))).rejects.toThrow();
  });
});
