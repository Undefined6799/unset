// PERMANENT — changing any value breaks existing users.
// P1.32, docs/human/decisions/0020-permanent-choices.md: each value is Alex's recorded answer, pinned by
// permanent.test.ts; a change needs a record superseding ADR 0020.

/** The Matrix `server_name`, part of every MXID forever (Q1, Alex 2026-10-03 11:50Z). */
export const MATRIX_SERVER_NAME = "unset.sh";

/** The permission set NSID that users' OAuth grants name; the set grows under this NSID, never a new one (Q4, Alex
 * 2026-10-03 11:47Z). */
export const PERMISSION_SET_NSID = "sh.unset.authApp";
