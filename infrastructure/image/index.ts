// The processing stage's adapter (ADR 0070 point 2.2): sharp, in killable child processes. Only interfaces/review
// imports it.
export { createImagePool, type PoolOptions } from "./pool.ts";
export { type Sniffed, sniffImage } from "./sniff.ts";
