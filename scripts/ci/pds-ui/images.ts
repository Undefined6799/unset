// OCI image-spec v1.1.1: descriptor digest covers stored blob; config rootfs.diff_ids
// covers uncompressed tar. layer.md defines whiteouts before changes in the same layer.
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import { archive, type Entry, linkTarget, metadata, pathName, requireThat, sha256 } from "./archive.ts";
import { UI_DIRECTORY } from "./contract.ts";

export { UI_DIRECTORY } from "./contract.ts";

const inside = (p: string): boolean => p === UI_DIRECTORY || p.startsWith(`${UI_DIRECTORY}/`);
type Descriptor = { digest: string; size: number; mediaType: string; platform?: { os: string; architecture: string } };
type Manifest = { config: Descriptor; layers: Descriptor[] };
type Configuration = {
  os: string;
  architecture: string;
  variant?: string;
  config: unknown;
  rootfs: { type: string; diff_ids: string[] };
};
function json(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf8"));
}
async function load(bytes: Buffer, digest: string, platform: string) {
  const files = await archive(bytes);
  requireThat(
    [...files.values()].every((entry) => ["file", "directory"].includes(entry.header.type)),
    "OCI envelope contains links",
  );
  const blob = (d: Descriptor): Buffer => {
    requireThat(/^sha256:[0-9a-f]{64}$/.test(d.digest), "invalid OCI digest");
    const data = files.get(`blobs/sha256/${d.digest.slice(7)}`)?.data;
    requireThat(
      data && data.length === d.size && `sha256:${sha256(data)}` === d.digest,
      "OCI blob digest or size drift",
    );
    return data;
  };
  const index = json(files.get("index.json")?.data ?? Buffer.alloc(0)) as { manifests: Descriptor[] };
  requireThat(index.manifests?.length === 1 && index.manifests[0]?.digest === digest, "immutable image digest drift");
  let descriptor = index.manifests[0];
  if (descriptor.mediaType === "application/vnd.oci.image.index.v1+json") {
    const platforms = (json(blob(descriptor)) as { manifests: Descriptor[] }).manifests.filter(
      (d) => `${d.platform?.os}/${d.platform?.architecture}` === platform,
    );
    requireThat(platforms.length === 1 && platforms[0], "missing or ambiguous image platform");
    descriptor = platforms[0];
  }
  requireThat(descriptor.mediaType === "application/vnd.oci.image.manifest.v1+json", "unsupported image manifest");
  const manifest = json(blob(descriptor)) as Manifest;
  const config = json(blob(manifest.config)) as Configuration;
  requireThat(
    `${config.os}/${config.architecture}` === platform && config.rootfs?.type === "layers",
    "unsupported image platform/rootfs",
  );
  requireThat(
    manifest.layers?.length > 0 &&
      manifest.layers.length <= 128 &&
      manifest.layers.length === config.rootfs.diff_ids.length,
    "image layer count mismatch",
  );
  const layers: Map<string, Entry>[] = [];
  let expandedBytes = 0;
  for (const [i, descriptor] of manifest.layers.entries()) {
    requireThat(
      [
        "application/vnd.oci.image.layer.v1.tar",
        "application/vnd.oci.image.layer.v1.tar+gzip",
        "application/vnd.docker.image.rootfs.diff.tar.gzip",
      ].includes(descriptor.mediaType),
      "unsupported OCI layer",
    );
    const stored = blob(descriptor);
    const layer = descriptor.mediaType.endsWith("gzip")
      ? gunzipSync(stored, { maxOutputLength: 512 * 1024 * 1024 })
      : stored;
    expandedBytes += layer.length;
    requireThat(expandedBytes <= 512 * 1024 * 1024, "expanded image exceeds limit");
    requireThat(`sha256:${sha256(layer)}` === config.rootfs.diff_ids[i], "uncompressed layer digest drift");
    layers.push(await archive(layer));
  }
  return { config, layers, descriptors: manifest.layers };
}
function parents(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
function remove(tree: Map<string, Entry>, target: string): void {
  for (const key of tree.keys()) if (key === target || key.startsWith(`${target}/`)) tree.delete(key);
}
function checkAncestors(tree: Map<string, Entry>, layer: Map<string, Entry>, path: string): void {
  for (const parent of parents(path))
    requireThat(
      (!tree.has(parent) || tree.get(parent)?.header.type === "directory") &&
        (!layer.has(parent) || layer.get(parent)?.header.type === "directory"),
      "archive writes through non-directory ancestor",
    );
}
function whiteout(tree: Map<string, Entry>, path: string, entry: Entry, added: boolean): void {
  requireThat(entry.header.type === "file" && entry.data.length === 0, "invalid whiteout");
  const leaf = posix.basename(path);
  const parent = posix.dirname(path);
  const opaque = leaf === ".wh..wh..opq";
  const target = opaque ? parent : pathName(posix.join(parent, leaf.slice(4)));
  requireThat(!added || inside(target), "whiteout escapes UI directory");
  requireThat(![".", "..", ""].includes(leaf.slice(4)), "ambiguous whiteout target");
  if (opaque) {
    for (const key of tree.keys()) if (key.startsWith(`${target}/`)) tree.delete(key);
  } else remove(tree, target);
}
function install(tree: Map<string, Entry>, path: string, entry: Entry, added: boolean): void {
  if (added && !inside(path))
    requireThat(
      UI_DIRECTORY.startsWith(`${path}/`) &&
        entry.header.type === "directory" &&
        tree.has(path) &&
        metadata(tree.get(path) as Entry) === metadata(entry),
      "outside UI filesystem change",
    );
  if (["link", "symlink"].includes(entry.header.type)) {
    const target = linkTarget(path, entry.header.linkname, entry.header.type === "link");
    requireThat(!added || !inside(path) || inside(target), "link escapes UI directory");
    if (entry.header.type === "link") {
      const referent = tree.get(target);
      requireThat(referent && ["file", "link"].includes(referent.header.type), "unresolved hardlink");
      entry.data = referent.data;
    }
  }
  if (entry.header.type !== "directory" && tree.get(path)?.header.type === "directory") remove(tree, path);
  tree.set(path, entry);
}
function apply(tree: Map<string, Entry>, layer: Map<string, Entry>, added: boolean): void {
  for (const [path, entry] of layer) {
    checkAncestors(tree, layer, path);
    if (posix.basename(path).startsWith(".wh.")) whiteout(tree, path, entry, added);
  }
  for (const [path, entry] of layer) {
    if (posix.basename(path).startsWith(".wh.")) continue;
    checkAncestors(tree, layer, path);
    install(tree, path, entry, added);
  }
}
export async function compareImages(
  baseArchive: Buffer,
  baseDigest: string,
  candidateArchive: Buffer,
  candidateDigest: string,
  platform = "linux/arm64",
) {
  const base = await load(baseArchive, baseDigest, platform);
  const candidate = await load(candidateArchive, candidateDigest, platform);
  requireThat(isDeepStrictEqual(base.config.config, candidate.config.config), "complete runtime Config drift");
  requireThat(
    base.config.os === candidate.config.os &&
      base.config.architecture === candidate.config.architecture &&
      base.config.variant === candidate.config.variant,
    "platform drift",
  );
  requireThat(
    base.config.rootfs.diff_ids.length <= candidate.config.rootfs.diff_ids.length &&
      base.config.rootfs.diff_ids.every((id, i) => id === candidate.config.rootfs.diff_ids[i]),
    "official base layer prefix drift",
  );
  requireThat(
    isDeepStrictEqual(base.descriptors, candidate.descriptors.slice(0, base.descriptors.length)),
    "official stored layer prefix drift",
  );
  const baseline = new Map<string, Entry>();
  for (const layer of base.layers) apply(baseline, layer, false);
  const tree = new Map(baseline);
  for (const layer of candidate.layers.slice(base.layers.length)) apply(tree, layer, true);
  const outside = [...baseline].filter(([path]) => !inside(path));
  requireThat(
    outside.length > 0 && outside.length === [...tree.keys()].filter((p) => !inside(p)).length,
    "outside tree entry drift",
  );
  for (const [path, entry] of outside)
    requireThat(
      tree.has(path) && metadata(entry) === metadata(tree.get(path) as Entry),
      "outside tree metadata/content drift",
    );
  const ui = new Map(
    [...tree].filter(([p]) => p.startsWith(`${UI_DIRECTORY}/`)).map(([p, e]) => [p.slice(UI_DIRECTORY.length + 1), e]),
  );
  requireThat(ui.size > 0, "missing UI artifact");
  return { outsideEntries: outside.length, ui, packages: tree };
}
