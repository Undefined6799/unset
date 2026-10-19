import { describe, expect, test } from "vitest";
import { type Item, sha, tar } from "./fixtures/native.ts";
import { verifySource } from "./verify.ts";

const revision = "a7c8604d876a200a1e4fa4aec83d4189ac4f1c12";
const root = `atproto-${revision}`;
const records: Item[] = [
  { name: `${root}/pnpm-lock.yaml`, body: "frozen" },
  ...Object.entries({
    "packages/pds": ["@atproto/pds", "0.5.37"],
    "packages/oauth/oauth-provider": ["@atproto/oauth-provider", "0.23.1"],
    "packages/oauth/oauth-provider-ui": ["@atproto/oauth-provider-ui", "0.10.5"],
  }).map(([path, [name, version]]) => ({
    name: `${root}/${path}/package.json`,
    body: JSON.stringify({ name, version }),
  })),
  { name: `${root}/plain`, body: "data" },
  { name: `${root}/dir`, type: "directory" },
];
async function verify(extra: Item[]) {
  const bytes = await tar([...records, ...extra]);
  return verifySource(bytes, { revision, archiveSha256: sha(bytes), lockSha256: sha("frozen") });
}
describe("source archive root and link containment", () => {
  test("accepts contained relative symlinks and regular-file hardlink chains", async () => {
    await expect(
      verify([
        { name: `${root}/relative`, type: "symlink", linkname: "plain" },
        { name: `${root}/dir/relative`, type: "symlink", linkname: "../plain" },
        { name: `${root}/hard`, type: "link", linkname: `${root}/plain` },
        { name: `${root}/hard-chain`, type: "link", linkname: `${root}/hard` },
      ]),
    ).resolves.toBeUndefined();
  });
  test.each([
    ["absolute symlink", [{ name: `${root}/escape`, type: "symlink", linkname: "/etc" }]],
    ["absolute root spelling", [{ name: `${root}/escape`, type: "symlink", linkname: `/${root}/plain` }]],
    ["relative symlink", [{ name: `${root}/escape`, type: "symlink", linkname: "../outside" }]],
    ["hardlink outside source root", [{ name: `${root}/escape`, type: "link", linkname: "outside" }]],
    ["unresolved hardlink", [{ name: `${root}/escape`, type: "link", linkname: `${root}/missing` }]],
    ["directory hardlink", [{ name: `${root}/escape`, type: "link", linkname: `${root}/dir` }]],
    [
      "symlink hardlink",
      [
        { name: `${root}/alias`, type: "symlink", linkname: "plain" },
        { name: `${root}/escape`, type: "link", linkname: `${root}/alias` },
      ],
    ],
    [
      "hardlink cycle",
      [
        { name: `${root}/one`, type: "link", linkname: `${root}/two` },
        { name: `${root}/two`, type: "link", linkname: `${root}/one` },
      ],
    ],
    [
      "symlink cycle",
      [
        { name: `${root}/one`, type: "symlink", linkname: "two" },
        { name: `${root}/two`, type: "symlink", linkname: "one" },
      ],
    ],
    [
      "write through symlink",
      [
        { name: `${root}/redirect`, type: "symlink", linkname: "dir" },
        { name: `${root}/redirect/file`, body: "overwrite" },
      ],
    ],
    [
      "future symlink ancestor",
      [
        { name: `${root}/redirect/file`, body: "overwrite" },
        { name: `${root}/redirect`, type: "symlink", linkname: "dir" },
      ],
    ],
    ["write through file", [{ name: `${root}/plain/child`, body: "overwrite" }]],
    [
      "write through hardlink",
      [
        { name: `${root}/hard`, type: "link", linkname: `${root}/plain` },
        { name: `${root}/hard/child`, body: "overwrite" },
      ],
    ],
    [
      "symlink followed before dotdot",
      [
        { name: `${root}/dir/up`, type: "symlink", linkname: ".." },
        { name: `${root}/escape`, type: "symlink", linkname: "dir/up/../outside" },
      ],
    ],
  ] as [string, Item[]][])("rejects %s", async (_name, extra) => {
    await expect(verify(extra)).rejects.toThrow();
  });
});
