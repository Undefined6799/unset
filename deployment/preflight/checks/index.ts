// The checks, in the order they run (P1.30: C1 to C12; P1.30s: C13 to C24 but C17 and C18; P1.30t: C17).
import { c21, c24 } from "./host.ts";
import { c2, c3, c4, c5 } from "./images.ts";
import { c17 } from "./networks.ts";
import { c6, c7, c8, c11, c12 } from "./pds.ts";
import { c9 } from "./secrets.ts";
import { c13, c14, c15, c16, c19, c20, c22, c23 } from "./settings.ts";
import { c1, c10 } from "./stack.ts";
import type { Check } from "./types.ts";

// C18 (the edge's rate-limit zones) is P1.30u.
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
  c19,
  c20,
  c21,
  c22,
  c23,
  c24,
];
