// The checks, in the order they run (P1.30: C1 to C12; P1.30s adds C13 to C24).
import { c21, c24 } from "./host.ts";
import { c2, c3, c4, c5 } from "./images.ts";
import { c6, c7, c8, c11, c12 } from "./pds.ts";
import { c9 } from "./secrets.ts";
import { c13, c14, c15, c16, c19, c20, c22, c23 } from "./settings.ts";
import { c1, c10 } from "./stack.ts";
import type { Check } from "./types.ts";

// C17 and C18 (networks and the edge config) are P1.30t.
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
  c19,
  c20,
  c21,
  c22,
  c23,
  c24,
];
