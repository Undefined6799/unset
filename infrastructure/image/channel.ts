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
 * a body that does not deserialize, calls `onBroken` once and the reader takes nothing more. Each body is allocated
 * once its header passes and every byte is copied into it once, so a large frame costs its size, not its size times
 * its chunk count.
 */
export function createFrameReader(
  maxLength: () => number,
  onValue: (value: unknown) => void,
  onBroken: () => void,
): FrameReader {
  const header = Buffer.alloc(4);
  let headerFilled = 0;
  let body: Buffer | null = null;
  let bodyFilled = 0;
  let broken = false;

  const breakOff = () => {
    broken = true;
    body = null;
    onBroken();
  };

  /** Hands a full body over; false once the reader is broken. */
  const deliver = (complete: Buffer): boolean => {
    body = null;
    headerFilled = 0;
    let value: unknown;
    try {
      value = deserialize(complete);
    } catch {
      breakOff();
      return false;
    }
    onValue(value);
    return !broken;
  };

  return {
    push(chunk) {
      let at = 0;
      while (!broken && at < chunk.length) {
        if (body === null) {
          const taken = chunk.copy(header, headerFilled, at, at + 4 - headerFilled);
          headerFilled += taken;
          at += taken;
          if (headerFilled < 4) return;
          const length = header.readUInt32BE(0);
          if (length > maxLength()) {
            breakOff();
            return;
          }
          body = Buffer.alloc(length);
          bodyFilled = 0;
        }
        const taken = chunk.copy(body, bodyFilled, at, at + body.length - bodyFilled);
        bodyFilled += taken;
        at += taken;
        if (bodyFilled === body.length && !deliver(body)) return;
      }
    },
  };
}
