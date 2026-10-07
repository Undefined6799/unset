// The checks, in the order they run (P1.30: C1 to C12; P1.30s adds C13 to C24).
import { c2, c3, c4, c5 } from "./images.ts";
import { c6, c7, c8, c11, c12 } from "./pds.ts";
import { c9 } from "./secrets.ts";
import { c1, c10 } from "./stack.ts";
import type { Check } from "./types.ts";

export const CHECKS: readonly Check[] = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12];
