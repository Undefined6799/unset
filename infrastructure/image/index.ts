// The processing stage's adapters (ADR 0070 point 2.2): the pool runs sharp in killable child processes and only
// interfaces/review starts it; web's composition root takes the remote processor, which only speaks the wire.
export { createImagePool, type PoolEvent, type PoolOptions } from "./pool.ts";
export { createRemoteImageProcessor, type ReviewAnswer, type ReviewTransport } from "./remote.ts";
export { type Counted, type Outcome, reviewListener } from "./serve.ts";
export { type Sniffed, sniffImage } from "./sniff.ts";
export {
  decodeFrame,
  encodeFrame,
  encodeJob,
  FRAME_TYPE,
  JOB_CEILING,
  JOB_HEADER,
  type Job,
  PROCESS_PATH,
  parseJob,
  parseRefusal,
} from "./wire.ts";
