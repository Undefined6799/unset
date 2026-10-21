// The checks, in the order they run (P1.30: C1 to C12; P1.30s: C13 to C24 but C17 and C18; P1.30t: C17; P1.30u: C18;
// P1.30x: C25; P1.30y: C26 and C27; P1.34t: C28; P1.36k: C29; P1.36q: C30; P1.37v: C31; P1.38d: C32; P1.27l: L1 and L2 under --env local).
import { c26, c27 } from "./build.ts";
import { c25 } from "./capabilities.ts";
import { c18 } from "./edge.ts";
import { c21, c24 } from "./host.ts";
import { c2, c3, c4, c5 } from "./images.ts";
import { l1, l2 } from "./local.ts";
import { c29 } from "./local-only-keys.ts";
import { c17 } from "./networks.ts";
import { c31 } from "./newt.ts";
import { c6, c7, c8, c11, c12, c28, c30 } from "./pds.ts";
import { c32 } from "./placeholders.ts";
import { c9 } from "./secrets.ts";
import { c13, c14, c15, c16, c19, c20, c22, c23 } from "./settings.ts";
import { c1, c10 } from "./stack.ts";
import type { Check } from "./types.ts";

export const CHECKS: readonly Check[] = [
  c1,
  c2,
  c3,
  c4,
  c5,
  c6,
  c7,
  c8,
  c9,
  c10,
  c11,
  c12,
  c13,
  c14,
  c15,
  c16,
  c17,
  c18,
  c19,
  c20,
  c21,
  c22,
  c23,
  c24,
  c25,
  c26,
  c27,
  c28,
  c29,
  c30,
  c31,
  c32,
];

/** The guards that run only under `--env local`, after the others (P1.27l). */
export const LOCAL_CHECKS: readonly Check[] = [l1, l2];
