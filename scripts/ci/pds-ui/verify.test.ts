import { describe, expect, test } from "vitest";
import { PAIRS, type Pair, uiDirectoryOf } from "./contract.ts";
import { artifacts, type Item, image, tar } from "./fixtures/native.ts";
import { archive, compareImages, verifyArtifact } from "./verify.ts";

const PAIR = PAIRS["0.4.5037"] as Pair;
const ui = uiDirectoryOf(PAIR);
const file = { name: "app/provider.js", body: "original" };
const link = { name: "app/provider-link", type: "symlink" as const, linkname: "provider.js" };
const config = { Env: ["NODE_ENV=production"], Cmd: ["node", "index.ts"] };
async function pair(change: Item[], runtime = config, prefix = true) {
  const baseLayer = await tar([
    { name: "app", type: "directory", mode: 0o755 },
    file,
    link,
    { name: `${ui}/old.js`, body: "old" },
  ]);
  const base = await image([baseLayer], config, true);
  const candidate = await image([...(prefix ? [baseLayer] : []), await tar(change)], runtime);
  return { base, candidate };
}
async function check(change: Item[], runtime = config, prefix = true) {
  const { base, candidate } = await pair(change, runtime, prefix);
  return compareImages(base.bytes, base.digest, candidate.bytes, candidate.digest, ui);
}
describe("immutable PDS frontend boundary", () => {
  test("accepts real nonempty OCI archives and only logical dist whiteout/replacement", async () => {
    const result = await check([
      { name: `${ui.slice(0, ui.lastIndexOf("/"))}/.wh.dist` },
      { name: `${ui}/new.js`, body: "new" },
    ]);
    expect(result.outsideEntries).toBe(3);
    expect(result.ui.get("new.js")?.data?.toString()).toBe("new");
  });
  test.each([
    ["provider bytes", [{ ...file, body: "changed" }]],
    ["provider mode", [{ ...file, mode: 0o755 }]],
    ["provider ownership", [{ ...file, uid: 1000 }]],
    ["provider symlink", [{ ...link, linkname: "other.js" }]],
    ["ancestor metadata", [{ name: "app", type: "directory", mode: 0o777 }]],
    ["ancestor whiteout", [{ name: "app/.wh.node_modules" }]],
    ["opaque ancestor", [{ name: "app/.wh..wh..opq" }]],
    ["physical whiteout escape", [{ name: `${ui}/.wh...` }]],
    ["traversing path", [{ name: `${ui}/../provider.js` }]],
    ["symlink escape", [{ name: `${ui}/escape`, type: "symlink", linkname: "../../../../provider.js" }]],
    ["hardlink escape", [{ name: `${ui}/escape`, type: "link", linkname: "app/provider.js" }]],
    ["unsupported type", [{ name: `${ui}/fifo`, type: "fifo" }]],
    ["unsupported PAX", [{ name: `${ui}/file`, pax: { "SCHILY.xattr.bad": "yes" } }]],
  ] as [string, Item[]][])("rejects %s", async (_name, change) => {
    await expect(check(change)).rejects.toThrow();
  });
  test("rejects complete runtime Config drift", async () => {
    await expect(check([], { ...config, Env: [...config.Env, "EXTRA=yes"] })).rejects.toThrow(/Config/);
  });
  test("rejects missing official layer prefix", async () => {
    await expect(check([], config, false)).rejects.toThrow(/prefix/);
  });
  test("rejects malformed, duplicate and unsupported physical PAX/GNU headers", async () => {
    const valid = await tar([{ name: "pax", body: "15 path=file.x\n", type: "file" }]);
    const reheader = (raw: Buffer, type: string) => {
      raw[156] = type.charCodeAt(0);
      raw.fill(32, 148, 156);
      const sum = raw.subarray(0, 512).reduce((a, b) => a + b, 0);
      raw.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
      return raw;
    };
    for (const type of ["x", "g", "L", "K", "S"])
      await expect(archive(reheader(Buffer.from(valid), type))).rejects.toThrow();
    const duplicate = await tar([{ name: "pax", body: "12 path=one\n12 path=two\n" }]);
    await expect(archive(reheader(duplicate, "x"))).rejects.toThrow();
  });
  test("rejects duplicates and noncanonical archive paths", async () => {
    for (const names of [["same", "same"], ["./same"], ["a//b"], ["/absolute"], ["../escape"]]) {
      await expect(archive(await tar(names.map((name) => ({ name }))))).rejects.toThrow();
    }
  });
  test("rejects malformed checksums, numeric metadata and future symlink ancestors", async () => {
    const corrupt = await tar([file]);
    corrupt[0] = 1;
    await expect(archive(corrupt)).rejects.toThrow();
    const numeric = await tar([file]);
    numeric.write("9999999", 108);
    await expect(archive(numeric)).rejects.toThrow();
    await expect(
      check([
        { name: `${ui}/link/file`, body: "x" },
        { name: `${ui}/link`, type: "symlink", linkname: "other" },
      ]),
    ).rejects.toThrow();
    await expect(archive(await tar([{ name: "hard", type: "link", linkname: "../escape" }]))).rejects.toThrow();
  });
  test("rejects truncation and mismatching immutable image digest", async () => {
    await expect(archive((await tar([file])).subarray(0, 600))).rejects.toThrow();
    const { base, candidate } = await pair([]);
    await expect(
      compareImages(base.bytes, `sha256:${"0".repeat(64)}`, candidate.bytes, candidate.digest, ui),
    ).rejects.toThrow();
  });
  test("validates all native manifest entries and real referenced hashes", () => {
    expect(verifyArtifact(artifacts())).toBe(5);
  });
  test.each(["missing-entry", "missing-file", "hash", "reference", "manifest-path", "inline-data", "mime"])(
    "rejects artifact %s",
    (mutation) => {
      const files = artifacts();
      const manifest = JSON.parse(files.get("bundle-manifest.json")?.toString() ?? "");
      if (mutation === "missing-entry") delete manifest["account-page.js"];
      if (mutation === "missing-file") files.delete("account-page.js");
      if (mutation === "hash") files.set("account-page.js", Buffer.from("tampered"));
      if (mutation === "reference") manifest["account-page.js"].dynamicImports = ["missing.js"];
      if (mutation === "mime") manifest["shared.css"].mime = "application/javascript";
      if (mutation === "inline-data") manifest["account-page.js"].data = "bWFsaWNpb3Vz";
      if (mutation === "manifest-path") manifest["../escape"] = manifest["account-page.js"];
      files.set("bundle-manifest.json", Buffer.from(JSON.stringify(manifest)));
      expect(() => verifyArtifact(files)).toThrow();
    },
  );
});
