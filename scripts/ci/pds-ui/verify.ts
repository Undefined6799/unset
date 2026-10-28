import { createHash } from "node:crypto";
import { extname } from "node:path";
import { gunzipSync } from "node:zlib";
import { archive, type Entry, pathName, requireThat, sha256 } from "./archive.ts";
import { type Pair, packagesOf } from "./contract.ts";

export { archive } from "./archive.ts";
export { compareImages } from "./images.ts";
export type SourceLock = { revision: string; archiveSha256: string; lockSha256: string };
export async function verifySource(bytes: Buffer, lock: SourceLock, pair: Pair): Promise<void> {
  requireThat(
    /^[0-9a-f]{40}$/.test(lock.revision) && bytes.length <= 512 * 1024 * 1024 && sha256(bytes) === lock.archiveSha256,
    "source archive/revision drift",
  );
  const raw = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }) : bytes;
  const files = await archive(raw, lock.revision);
  const root = `atproto-${lock.revision}`;
  validateSourceTree(files, root);
  const frozen = files.get(`${root}/pnpm-lock.yaml`);
  requireThat(frozen?.header.type === "file" && sha256(frozen.data) === lock.lockSha256, "upstream lock drift");
  for (const [path, name, version] of packagesOf(pair)) {
    const entry = files.get(`${root}/${path}/package.json`);
    requireThat(entry?.header.type === "file", "missing source package");
    const pkg = JSON.parse(entry.data.toString());
    requireThat(pkg.name === name && pkg.version === version, "source package version drift");
  }
}
function sourceHardlink(files: Map<string, Entry>, path: string, root: string): void {
  let entry = files.get(path);
  const seen = new Set<string>();
  while (entry?.header.type === "link") {
    const target = entry.header.linkname;
    requireThat(
      target.startsWith(`${root}/`) && !seen.has(target) && seen.size < 64,
      "source hardlink escapes or cycles",
    );
    seen.add(target);
    entry = files.get(target);
  }
  requireThat(entry?.header.type === "file", "source hardlink must resolve to a regular file");
}
function sourceSymlink(files: Map<string, Entry>, directories: Set<string>, path: string, root: string): void {
  const parts = path.split("/").slice(0, -1);
  const pending = (files.get(path)?.header.linkname ?? "").split("/");
  requireThat(pending[0] !== "", "absolute source symlink");
  let followed = 0;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    if (part === "" || part === ".") continue;
    if (part === "..") {
      requireThat(parts.length > 1, "source symlink escapes root");
      parts.pop();
      continue;
    }
    parts.push(part);
    requireThat(parts[0] === root, "source symlink escapes root");
    const target = parts.join("/");
    const entry = files.get(target);
    if (entry?.header.type === "symlink") {
      requireThat(!entry.header.linkname.startsWith("/") && ++followed <= 64, "source symlink escapes or cycles");
      parts.pop();
      pending.unshift(...entry.header.linkname.split("/"));
    } else if (pending.length > 0) requireThat(directories.has(target), "source link has a non-directory ancestor");
  }
  const target = parts.join("/");
  requireThat(files.has(target) || directories.has(target), "source symlink target is unresolved");
}
function validateSourceTree(files: Map<string, Entry>, root: string): void {
  const directories = new Set([root]);
  for (const [path, entry] of files) {
    requireThat(path === root || path.startsWith(`${root}/`), "source root/revision drift");
    if (entry.header.type === "directory") directories.add(path);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      requireThat(
        !files.has(parent) || files.get(parent)?.header.type === "directory",
        "source writes through non-directory ancestor",
      );
      directories.add(parent);
    }
  }
  for (const [path, entry] of files) {
    if (entry.header.type === "link") sourceHardlink(files, path, root);
    if (entry.header.type === "symlink") sourceSymlink(files, directories, path, root);
  }
}
// Native upstream format: pinned atproto rolldown-plugin-bundle-manifest/src/index.ts,
// commit a7c8604d876a200a1e4fa4aec83d4189ac4f1c12 (provider consumes this exact map).
export function verifyArtifact(files: Map<string, Buffer>): number {
  const raw = files.get("bundle-manifest.json");
  requireThat(raw, "missing native bundle manifest");
  const manifest = JSON.parse(raw.toString()) as Record<
    string,
    {
      type: string;
      mime?: string;
      sha256: string;
      dynamicImports?: string[];
      isEntry?: boolean;
      isDynamicEntry?: boolean;
      name?: string;
    }
  >;
  requireThat(manifest && !Array.isArray(manifest) && typeof manifest === "object", "invalid native manifest");
  const entries = new Set<string>();
  for (const [name, item] of Object.entries(manifest)) {
    pathName(name);
    requireThat(
      item && ["chunk", "asset"].includes(item.type) && !Object.hasOwn(item, "data"),
      "invalid manifest item or embedded data",
    );
    const mime: Record<string, string> = {
      ".js": "application/javascript",
      ".map": "application/json",
      ".css": "text/css",
    };
    requireThat(Object.hasOwn(mime, extname(name)) && item.mime === mime[extname(name)], "unexpected artifact MIME");
    const data = files.get(name);
    requireThat(
      data && createHash("sha256").update(data).digest("base64") === item.sha256,
      "asset missing or hash drift",
    );
    if (item.type === "chunk") {
      requireThat(
        item.mime === "application/javascript" &&
          typeof item.isEntry === "boolean" &&
          typeof item.isDynamicEntry === "boolean" &&
          typeof item.name === "string" &&
          Array.isArray(item.dynamicImports),
        "invalid native chunk",
      );
      requireThat(
        item.dynamicImports.every(
          (ref) => typeof ref === "string" && Object.hasOwn(manifest, pathName(ref)) && files.has(ref),
        ),
        "missing dynamic import",
      );
      if (item.isEntry) {
        requireThat(!entries.has(item.name), "duplicate manifest entry");
        entries.add(item.name);
      }
    }
  }
  const required = ["account-page", "authorization-page", "error-page", "cookie-error-page"];
  requireThat(
    entries.size === required.length && required.every((name) => entries.has(name)),
    "missing or unexpected manifest entry",
  );
  requireThat(
    Object.keys(manifest).length > 0 &&
      [...files.keys()].every((p) => p === "bundle-manifest.json" || Object.hasOwn(manifest, p)),
    "unmanifested artifact file",
  );
  return Object.keys(manifest).length;
}
