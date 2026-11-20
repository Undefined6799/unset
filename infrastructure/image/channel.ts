// The byte channel between the pool and a child (ADR 0070 point 2.2). Node's IPC channel reads a whole message into
// memory before handing it over, with no size limit, so an exploited child could make the parent buffer as much as
// it liked. Instead each side writes frames, a u32 big-endian length then a `node:v8` serialized value, on a plain
// pipe, and the reader checks every declared length against its current limit before keeping any byte of the body.
import { deserialize } from "node:v8";

export const frame = (payload: Uint8Array): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
};

export type FrameReader = {
  /** Feeds bytes from the pipe; values come out through `onValue`, in order. */
  push(chunk: Buffer): void;
};

/**
 * Reads frames off a pipe. `maxLength()` is asked for each frame as its header arrives; a longer declared length, or
 * a body that does not deserialize, calls `onBroken` once and the reader takes nothing more.
 */
export function createFrameReader(
  maxLength: () => number,
  onValue: (value: unknown) => void,
  onBroken: () => void,
): FrameReader {
  let pending: Buffer = Buffer.alloc(0);
  let broken = false;
  return {
    push(chunk) {
      if (broken) return;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readUInt32BE(0);
        if (length > maxLength()) {
          broken = true;
          pending = Buffer.alloc(0);
          onBroken();
          return;
        }
        if (pending.length < 4 + length) return;
        const body = pending.subarray(4, 4 + length);
        pending = pending.subarray(4 + length);
        let value: unknown;
        try {
          value = deserialize(body);
        } catch {
          broken = true;
          onBroken();
          return;
        }
        onValue(value);
      }
    },
  };
}
