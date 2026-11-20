// The frame channel between the pool and a child (ADR 0070 point 2.2).
import { serialize } from "node:v8";
import { describe, expect, test } from "vitest";
import { createFrameReader, frame } from "./channel.ts";

const read = (max: number) => {
  const values: unknown[] = [];
  let broken = 0;
  const reader = createFrameReader(
    () => max,
    (value) => values.push(value),
    () => broken++,
  );
  return { reader, values, broken: () => broken };
};

describe("channel", () => {
  test("channel.split: frames cut at every byte, header included, come out whole and in order", () => {
    const bytes = Buffer.concat([frame(serialize({ a: 1 })), frame(serialize("two")), frame(serialize([3]))]);
    const { reader, values, broken } = read(1024);
    for (let i = 0; i < bytes.length; i++) reader.push(bytes.subarray(i, i + 1));
    expect(values).toEqual([{ a: 1 }, "two", [3]]);
    expect(broken()).toBe(0);
  });

  test("channel.large: a 30 MB frame in 64 KiB chunks is assembled once", () => {
    const payload = Buffer.alloc(30_000_000, 7);
    const bytes = frame(serialize(payload));
    const { reader, values } = read(bytes.length);
    for (let i = 0; i < bytes.length; i += 65_536) reader.push(bytes.subarray(i, i + 65_536));
    expect(values).toHaveLength(1);
    expect(Buffer.from(values[0] as Uint8Array).equals(payload)).toBe(true);
  });

  test("channel.over_cap: a declared length over the cap breaks once and reads nothing more", () => {
    const { reader, values, broken } = read(16);
    reader.push(frame(serialize("a string longer than sixteen bytes")));
    reader.push(frame(serialize(1)));
    expect(values).toEqual([]);
    expect(broken()).toBe(1);
  });

  test("channel.garbage: a body that does not deserialize breaks the reader", () => {
    const { reader, values, broken } = read(1024);
    reader.push(frame(Buffer.from([0xff, 0xff, 0xff])));
    reader.push(frame(serialize(1)));
    expect(values).toEqual([]);
    expect(broken()).toBe(1);
  });
});
