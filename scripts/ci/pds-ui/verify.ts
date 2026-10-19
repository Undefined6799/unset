import { createHash } from "node:crypto";
import { extname } from "node:path";
import { archive, pathName, requireThat, sha256 } from "./archive.ts";

export { archive } from "./archive.ts";
export { compareImages, UI_DIRECTORY } from "./images.ts";
export const PACKAGES = {
  "packages/pds": ["@atproto/pds", "0.5.37"],
  "packages/oauth/oauth-provider": ["@atproto/oauth-provider", "0.23.1"],
  "packages/oauth/oauth-provider-ui": ["@atproto/oauth-provider-ui", "0.10.5"],
} as const;
export type SourceLock = { revision: string; archiveSha256: string; lockSha256: string };
export async function verifySource(bytes: Buffer, lock: SourceLock): Promise<void> {
  requireThat(
    /^[0-9a-f]{40}$/.test(lock.revision) && sha256(bytes) === lock.archiveSha256,
    "source archive/revision drift",
  );
  const files = await archive(bytes, lock.revision);
  const root = `atproto-${lock.revision}`;
  requireThat(
    [...files.keys()].every((p) => p === root || p.startsWith(`${root}/`)),
    "source root/revision drift",
  );
  const frozen = files.get(`${root}/pnpm-lock.yaml`);
  requireThat(frozen?.header.type === "file" && sha256(frozen.data) === lock.lockSha256, "upstream lock drift");
  for (const [path, [name, version]] of Object.entries(PACKAGES)) {
    const entry = files.get(`${root}/${path}/package.json`);
    requireThat(entry?.header.type === "file", "missing source package");
    const pkg = JSON.parse(entry.data.toString());
    requireThat(pkg.name === name && pkg.version === version, "source package version drift");
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
