// PERMANENT — changing any value breaks existing users.
// P1.32, docs/human/decisions/0025-public-domains.md: each value is Alex's recorded answer, pinned by
// permanent.test.ts; a change needs a record superseding ADR 0025.

/** The Matrix `server_name`, part of every MXID forever (Q1, Alex 2026-10-16 22:42Z, ADR 0025). */
export const MATRIX_SERVER_NAME = "unset.cc";

/** The permission set NSID that users' OAuth grants name; the set grows under this NSID, never a new one (Q4, Alex
 * 2026-10-03 11:47Z). */
export const PERMISSION_SET_NSID = "sh.unset.authApp";
