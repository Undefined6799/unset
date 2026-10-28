// OCI image-spec v1.1.1: descriptor digest covers stored blob; config rootfs.diff_ids
// covers uncompressed tar. layer.md defines whiteouts before changes in the same layer.
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import { archive, type Entry, linkTarget, metadata, pathName, requireThat, sha256 } from "./archive.ts";

const inside = (ui: string, p: string): boolean => p === ui || p.startsWith(`${ui}/`);
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
// Docker's classic image store keeps only the pulled platform and `docker image save` writes a manifest of its own
// (moby v28.5.2 image/tarexport/save.go: uncompressed layers, config digest = image ID). Such an archive cannot carry
// the pinned index digest, so it is tied to the pin through the config digest the pinned index names instead.
export type ImagePin = { digest: string; config?: string };
const IMAGE_INDEX = "application/vnd.oci.image.index.v1+json";
const IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
/** The manifest digest a pinned index names for one platform; the index bytes must hash to the pin. */
export function platformManifest(index: Buffer, pinned: string, platform: string): string {
  requireThat(DIGEST.test(pinned) && `sha256:${sha256(index)}` === pinned, "pinned index digest drift");
  const parsed = json(index) as { mediaType?: string; manifests?: Descriptor[] };
  requireThat(parsed.mediaType === IMAGE_INDEX, "pinned base is not an image index");
  const matches = (parsed.manifests ?? []).filter((d) => `${d.platform?.os}/${d.platform?.architecture}` === platform);
  requireThat(
    matches.length === 1 && matches[0]?.mediaType === IMAGE_MANIFEST && DIGEST.test(matches[0].digest),
    "missing or ambiguous pinned platform manifest",
  );
  return matches[0].digest;
}
/** The config digest of a platform manifest; the manifest bytes must hash to the digest the index named. */
export function manifestConfig(manifest: Buffer, digest: string): string {
  requireThat(`sha256:${sha256(manifest)}` === digest, "pinned platform manifest digest drift");
  const parsed = json(manifest) as { mediaType?: string; config?: Descriptor };
  requireThat(
    parsed.mediaType === IMAGE_MANIFEST && DIGEST.test(parsed.config?.digest ?? ""),
    "invalid pinned platform manifest",
  );
  return (parsed.config as Descriptor).digest;
}
async function load(bytes: Buffer, pin: ImagePin, platform: string) {
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
  const top = index.manifests?.length === 1 ? index.manifests[0] : undefined;
  const pinned = top?.digest === pin.digest;
  requireThat(
    top && (pinned || (pin.config !== undefined && top.mediaType === IMAGE_MANIFEST)),
    "immutable image digest drift",
  );
  let descriptor = top;
  if (descriptor.mediaType === IMAGE_INDEX) {
    const platforms = (json(blob(descriptor)) as { manifests: Descriptor[] }).manifests.filter(
      (d) => `${d.platform?.os}/${d.platform?.architecture}` === platform,
    );
    requireThat(platforms.length === 1 && platforms[0], "missing or ambiguous image platform");
    descriptor = platforms[0];
  }
  requireThat(descriptor.mediaType === IMAGE_MANIFEST, "unsupported image manifest");
  const manifest = json(blob(descriptor)) as Manifest;
  requireThat(pinned || manifest.config?.digest === pin.config, "immutable image config drift");
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
/** `ui` is the one mutable directory for a candidate layer, or null for an official base layer. */
function whiteout(tree: Map<string, Entry>, path: string, entry: Entry, ui: string | null): void {
  requireThat(entry.header.type === "file" && entry.data.length === 0, "invalid whiteout");
  const leaf = posix.basename(path);
  const parent = posix.dirname(path);
  const opaque = leaf === ".wh..wh..opq";
  const target = opaque ? parent : pathName(posix.join(parent, leaf.slice(4)));
  requireThat(ui === null || inside(ui, target), "whiteout escapes UI directory");
  requireThat(![".", "..", ""].includes(leaf.slice(4)), "ambiguous whiteout target");
  if (opaque) {
    for (const key of tree.keys()) if (key.startsWith(`${target}/`)) tree.delete(key);
  } else remove(tree, target);
}
function install(tree: Map<string, Entry>, path: string, entry: Entry, ui: string | null): void {
  if (ui !== null && !inside(ui, path))
    requireThat(
      ui.startsWith(`${path}/`) &&
        entry.header.type === "directory" &&
        tree.has(path) &&
        metadata(tree.get(path) as Entry) === metadata(entry),
      "outside UI filesystem change",
    );
  if (["link", "symlink"].includes(entry.header.type)) {
    const target = linkTarget(path, entry.header.linkname, entry.header.type === "link");
    requireThat(ui === null || !inside(ui, path) || inside(ui, target), "link escapes UI directory");
    if (entry.header.type === "link") {
      const referent = tree.get(target);
      requireThat(referent && ["file", "link"].includes(referent.header.type), "unresolved hardlink");
      entry.data = referent.data;
    }
  }
  if (entry.header.type !== "directory" && tree.get(path)?.header.type === "directory") remove(tree, path);
  tree.set(path, entry);
}
function apply(tree: Map<string, Entry>, layer: Map<string, Entry>, ui: string | null): void {
  for (const [path, entry] of layer) {
    checkAncestors(tree, layer, path);
    if (posix.basename(path).startsWith(".wh.")) whiteout(tree, path, entry, ui);
  }
  for (const [path, entry] of layer) {
    if (posix.basename(path).startsWith(".wh.")) continue;
    checkAncestors(tree, layer, path);
    install(tree, path, entry, ui);
  }
}
export async function compareImages(
  baseArchive: Buffer,
  basePin: string | ImagePin,
  candidateArchive: Buffer,
  candidateDigest: string,
  uiDirectory: string,
  platform = "linux/arm64",
) {
  const base = await load(baseArchive, typeof basePin === "string" ? { digest: basePin } : basePin, platform);
  const candidate = await load(candidateArchive, { digest: candidateDigest }, platform);
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
  for (const layer of base.layers) apply(baseline, layer, null);
  const tree = new Map(baseline);
  for (const layer of candidate.layers.slice(base.layers.length)) apply(tree, layer, uiDirectory);
  const outside = [...baseline].filter(([path]) => !inside(uiDirectory, path));
  requireThat(
    outside.length > 0 && outside.length === [...tree.keys()].filter((p) => !inside(uiDirectory, p)).length,
    "outside tree entry drift",
  );
  for (const [path, entry] of outside)
    requireThat(
      tree.has(path) && metadata(entry) === metadata(tree.get(path) as Entry),
      "outside tree metadata/content drift",
    );
  const ui = new Map(
    [...tree].filter(([p]) => p.startsWith(`${uiDirectory}/`)).map(([p, e]) => [p.slice(uiDirectory.length + 1), e]),
  );
  requireThat(ui.size > 0, "missing UI artifact");
  return { outsideEntries: outside.length, ui, packages: tree };
}
