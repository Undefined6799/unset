// tar-stream 3.2.2 extract.js / headers.js: parsing never touches disk. Its PAX decoder
// is permissive, so validate physical framing/extensions before it resolves path/linkpath.
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { gunzipSync } from "node:zlib";
import { extract, type Header } from "tar-stream";

export const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 512 * 1024 * 1024;
const TIMES = new Set(["mtime", "atime", "ctime"]);
export type Entry = { header: Header; data: Buffer };
export function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function unsafeText(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || [92, 127, 65533].includes(char.charCodeAt(0)));
}
export function pathName(name: string, directory = false): string {
  const path = directory && name.endsWith("/") ? name.slice(0, -1) : name;
  requireThat(path !== "" && !path.startsWith("/") && !unsafeText(path), "unsafe archive path");
  requireThat(
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "noncanonical archive path",
  );
  return path;
}
function paxRecords(input: Buffer): void {
  let bytes = input;
  const seen = new Set<string>();
  while (bytes.length > 0) {
    const space = bytes.indexOf(32);
    requireThat(space > 0 && /^[1-9][0-9]*$/.test(bytes.subarray(0, space).toString()), "malformed PAX length");
    const size = Number(bytes.subarray(0, space));
    requireThat(
      Number.isSafeInteger(size) && size > space + 3 && size <= bytes.length && bytes[size - 1] === 10,
      "malformed PAX record",
    );
    const record = bytes.subarray(space + 1, size - 1).toString("utf8");
    const eq = record.indexOf("=");
    const key = record.slice(0, eq);
    requireThat(
      eq > 0 && !seen.has(key) && ["path", "linkpath", ...TIMES].includes(key),
      "duplicate or unsupported PAX",
    );
    requireThat(!record.includes("\ufffd") && !record.includes("\0"), "invalid PAX encoding");
    seen.add(key);
    bytes = bytes.subarray(size);
  }
}
function physicalSize(header: Buffer): number {
  for (const [start, size] of [
    [100, 8],
    [108, 8],
    [116, 8],
    [136, 12],
    [148, 8],
    [329, 8],
    [337, 8],
  ] as const) {
    const numeric = header
      .subarray(start, start + size)
      .toString("ascii")
      .replace(/^[\0 ]+|[\0 ]+$/gu, "");
    requireThat(numeric === "" || /^[0-7]+$/.test(numeric), "unsupported archive numeric encoding");
  }
  const rawSize = header
    .subarray(124, 136)
    .toString("ascii")
    .replace(/[\0 ]+$/u, "");
  requireThat(/^[0-7]+$/.test(rawSize), "unsupported archive numeric size");
  const size = Number.parseInt(rawSize, 8);
  requireThat(Number.isSafeInteger(size) && size <= MAX_BYTES, "archive declared size");
  return size;
}
function framing(bytes: Buffer, sourceComment?: string): void {
  requireThat(bytes.length > 0 && bytes.length <= MAX_BYTES && bytes.length % 512 === 0, "archive size or truncation");
  let extension = false;
  for (let offset = 0; offset < bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      requireThat(
        !extension && bytes.subarray(offset).every((byte) => byte === 0),
        "trailing or dangling archive data",
      );
      return;
    }
    const type = String.fromCharCode(header[156] ?? 0);
    requireThat(
      ["\0", "0", "1", "2", "5", "x"].includes(type) || (type === "g" && offset === 0 && sourceComment !== undefined),
      "unsupported archive type",
    );
    const size = physicalSize(header);
    requireThat(offset + 512 + size <= bytes.length, "archive declared size");
    if (type === "g") {
      requireThat(
        bytes.subarray(offset + 512, offset + 512 + size).toString() === `52 comment=${sourceComment}\n`,
        "unexpected source global PAX",
      );
    } else if (type === "x") {
      requireThat(!extension && size <= 4 * 1024 * 1024, "ambiguous PAX extension");
      paxRecords(bytes.subarray(offset + 512, offset + 512 + size));
      extension = true;
    } else {
      extension = false;
      requireThat(["0", "\0"].includes(type) || size === 0, "non-file archive payload");
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("archive has no terminal block");
}
function entryPath(header: Header): string {
  const path = pathName(header.name, header.type === "directory");
  if (header.type === "link") pathName(header.linkname);
  if (["link", "symlink"].includes(header.type)) linkTarget(path, header.linkname, header.type === "link");
  for (const key of ["mode", "uid", "gid", "size", "devmajor", "devminor"] as const)
    requireThat(Number.isSafeInteger(header[key]) && header[key] >= 0, "invalid archive metadata");
  requireThat(header.devmajor === 0 && header.devminor === 0, "unexpected device metadata");
  return path;
}
export async function archive(compressed: Buffer, sourceComment?: string): Promise<Map<string, Entry>> {
  requireThat(compressed.length <= MAX_BYTES, "archive exceeds limit");
  const bytes =
    compressed[0] === 31 && compressed[1] === 139 ? gunzipSync(compressed, { maxOutputLength: MAX_BYTES }) : compressed;
  framing(bytes, sourceComment);
  const parser = extract();
  const result = new Map<string, Entry>();
  // Supplying chunks avoids the parser buffering the complete archive a second time.
  const feed = (async () => {
    for (let at = 0; at < bytes.length; at += 64 * 1024) {
      if (!parser.write(bytes.subarray(at, at + 64 * 1024)))
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            parser.removeListener("error", failed);
            resolve();
          };
          const failed = (error: Error) => {
            parser.removeListener("drain", done);
            reject(error);
          };
          parser.once("drain", done);
          parser.once("error", failed);
        });
    }
    parser.end(Buffer.alloc(0));
  })();
  try {
    for await (const stream of parser) {
      const header = stream.header;
      const path = entryPath(header);
      requireThat(!result.has(path) && result.size < 200_000, "duplicate archive path or entry limit");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        requireThat(Buffer.isBuffer(chunk), "invalid parser chunk");
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      requireThat(data.length === header.size, "archive payload size mismatch");
      result.set(path, { header, data });
    }
    await feed;
  } catch (error) {
    parser.destroy(error instanceof Error ? error : new Error(String(error)));
    await feed.catch(() => undefined); // Preserve the original parse/validation failure.
    throw error;
  }
  return result;
}
export function linkTarget(path: string, link: string, hard: boolean): string {
  requireThat(link !== "" && !unsafeText(link), "unsafe link target");
  const parts = (hard || link.startsWith("/") ? [] : posix.dirname(path).split("/")).filter((p) => p !== ".");
  for (const part of link.split("/")) {
    if (part === "..") requireThat(parts.pop() !== undefined, "link escapes filesystem");
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return pathName(parts.join("/"));
}
export function metadata(entry: Entry): string {
  const { header: h, data } = entry;
  return JSON.stringify([
    h.type,
    h.mode,
    h.uid,
    h.gid,
    h.uname,
    h.gname,
    h.linkname,
    h.devmajor,
    h.devminor,
    sha256(data),
    Object.entries((h.pax ?? {}) as Record<string, string>)
      .filter(([k]) => !TIMES.has(k) && k !== "path" && k !== "linkpath")
      .sort(),
  ]);
}
