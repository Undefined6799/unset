import { describe, expect, test } from "vitest";
import { sniffImage } from "./sniff.ts";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, length = 0) => [...be32(length), ...bytes(type), ...new Array(length + 4).fill(0)];

describe("sniff.table", () => {
  test.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0], new Array(12).fill(0))],
    ["png", bytes(PNG, chunk("IHDR", 13), chunk("IDAT"))],
    ["animated", bytes(PNG, chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT"))],
    ["webp", bytes("RIFF", le32(20), "WEBP", "VP8 ", le32(4), [0, 0, 0, 0])],
    ["animated", bytes("RIFF", le32(30), "WEBP", "VP8X", le32(10), [0x02], new Array(9).fill(0))],
    [
      "animated",
      bytes("RIFF", le32(30), "WEBP", "VP8X", le32(10), new Array(10).fill(0), "ANIM", le32(6), new Array(6).fill(0)),
    ],
    ["avif", bytes(be32(20), "ftyp", "avif", be32(0), "mif1")],
    ["animated", bytes(be32(24), "ftyp", "avif", be32(0), "mif1", "avis")],
  ] as const)("%s", (expected, input) => expect(sniffImage(input)).toBe(expected));

  test.each([
    ["gif", bytes("GIF89a", new Array(10).fill(0))],
    ["heic", bytes(be32(20), "ftyp", "heic", be32(0), "mif1")],
    ["svg", bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ["bmp", bytes("BM", new Array(20).fill(0))],
    ["tiff", bytes([0x49, 0x49, 0x2a, 0], new Array(12).fill(0))],
    ["short", bytes([0xff, 0xd8])],
  ])("%s is refused", (_name, input) => expect(sniffImage(input)).toBeNull());
});
