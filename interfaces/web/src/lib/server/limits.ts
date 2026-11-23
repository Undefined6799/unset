// The web process's rate-limit policies, as interfaces/http/limits.ts has them for the routes that exist today
// (P1.06p; plan section 5.2; ADR 0042). Each entry is a token bucket: `capacity` at once, refilled at `refillPerSec`.
// A page names one of these in its policy.ts; a page that needs a new policy adds it here.
import type { CodeColourLimits } from "@unset/apps-web/lib/editor/code-colours.ts";
import { definePolicies, type PolicyTable } from "@unset/shared-http";
import type { TextReadLimits } from "./text-reader.ts";

/**
 * The site-wide page ceiling (ADR 0042; sized for thousands of members by P1.21j, Proposed ADR 0071, from 3000 at once
 * and 50 a second): 30000 at once, 500 a second. That is 1000 members each clicking every 2 seconds, or 5000 at a page
 * every 10 seconds. It guards the process and the PDS against a flood from many addresses; the edge limits each one.
 */
const SITE_CEILING = { capacity: 30_000, refillPerSec: 500, scope: "global" } as const;

export const policies = definePolicies({
  default: [{ capacity: 60, refillPerSec: 300 / 60, scope: "ip" }, SITE_CEILING],
  // A profile save writes to the member's PDS: the page limits, and 30 a minute for one member whatever their address.
  profile: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    SITE_CEILING,
    { capacity: 30, refillPerSec: 30 / 60, scope: "did" },
  ],
  login: [{ capacity: 10, refillPerSec: 10 / 60, scope: "ip" }],
  // Asking for an invite (book P2.10): the page limits, and 10 an hour for one member; pds-admin's own quota (5 a day
  // per member, 100 a day for the server) is the real cap.
  invite: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    SITE_CEILING,
    { capacity: 10, refillPerSec: 10 / 3600, scope: "did" },
  ],
  // Asking for an invite while signed out (book P2.10r; ADR 0080): each POST mails the owner, so 3 an hour from one
  // address and 20 a day for the whole site, which bounds the owner's inbox and the mail provider's quota.
  inviteRequest: [
    { capacity: 3, refillPerSec: 3 / 3600, scope: "ip" },
    SITE_CEILING,
    { capacity: 20, refillPerSec: 20 / 86_400, scope: "global" },
  ],
  // Opening a notification or marking all as read (P2.27): the page limits, and 120 a minute for one member, so a
  // member clicking through every row or pressing the button again and again stays well inside it.
  notifications: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    SITE_CEILING,
    { capacity: 120, refillPerSec: 120 / 60, scope: "did" },
  ],
});

export type PolicyName = keyof typeof policies & string;

/**
 * The site-wide ceiling on sign-in steps when the edge is the per-client layer (ADR 0042): 600 at once, 10 a second
 * since P1.21j (was 120 and 2), so about 300 sign-ins a minute, each POST /login and its callback.
 */
const SIGN_IN_CEILING = { capacity: 600, refillPerSec: 10, scope: "global" } as const;

/**
 * The table without its per-address entries, for socket mode (ADR 0042): behind the edge every request has the edge's
 * address, so an `ip` entry would be one bucket for everyone. `login` gets the sign-in ceiling; per-DID entries stay.
 */
function withoutAddressEntries(table: PolicyTable): PolicyTable {
  const kept = Object.entries(table).map(([name, policy]) => {
    const entries = policy.filter((entry) => entry.scope !== "ip");
    return [name, name === "login" ? [...entries, SIGN_IN_CEILING] : entries] as const;
  });
  return definePolicies(Object.fromEntries(kept));
}

/** Per address in `header` mode (the edge names the client); ceilings only in `socket` mode. */
export const policiesFor = (mode: "header" | "socket"): PolicyTable =>
  mode === "socket" ? withoutAddressEntries(policies) : policies;

/**
 * Picture uploads held in memory at once (ADR 0070 point 4): one per member, four for the whole process. Measured
 * 2026-11-20 (routes/images/upload.server.ts): four 64 MiB uploads parsed at once peak at about 510 MiB, inside web's
 * 1 GB; a fifth is refused as busy and the editor says to try again. More do not fit: eight bodies arriving over
 * 2 to 10 s and held while review works peak at about 910 MiB above the process's base (Node 26.12, undici's
 * formData, 64 KiB chunks, 2026-11-20). A slow sender holds its place for at most the edge's 120 s read window.
 */
export const IMAGE_UPLOADS_IN_FLIGHT = 4;

/**
 * Pictures web sends review at once: review's REVIEW_CHILDREN default (interfaces/review/config.ts), so none waits in
 * review's queue on its 20 s job clock while web's 30 s timeout runs. The others wait in web, on their own deadline.
 * tests/integration/web/review-lanes.test.ts holds the two numbers together.
 */
export const REVIEW_LANES = 2;

/**
 * Reading a member's Markdown on the server, inside the page load (P1.21k; text-reader.ts has the measurements): at
 * most 150 ms for one card's text and 300 ms for all of a page's, past which a card is shown as plain text. A full
 * card of 20,000 characters reads in about 15 ms as prose and 35 to 60 ms as a dense list or table, so a normal page
 * reaches neither. What a read gave is kept for ten minutes, so a text is parsed once in that time however often its
 * page is loaded: at most 50 MB of results by the reader's upper estimate (text-reader.ts `bytesIn`: objects, strings
 * and the text itself), which is 50 full cards as tables, 75 as dense lists, 600 as one paragraph, and thousands of
 * ordinary ones. A text stopped at its 150 ms is kept as stopped the same ten
 * minutes, so text written to stall the parser costs the process 150 ms once in ten minutes, not on every page load,
 * and a long text stopped in a busy moment comes back by itself.
 */
export const TEXT_READ_LIMITS: TextReadLimits = { textMs: 150, pageMs: 300, keptBytes: 50_000_000, keptForMs: 600_000 };

/**
 * Colouring a member's code on the server, inside the page load (P1.21v; review of #2004 at e36de8a; measured in
 * apps/web/lib/editor/code-colours.ts): a block of at most 20,000 characters (the text block's ceiling) whose lines are
 * at most 400 characters, so no parser step runs long; at most 50 ms of parsing for one block and 100 ms for the page,
 * past which its code is plain. Normal use fits: a 20,000-character TypeScript block parsed in about 15 ms locally and
 * 35 ms on a CI runner (2026-11-23), and the Text editor writes at most 10,000. The Text editor's preview uses the same
 * numbers (cardEditLimits), so it colours what the page will.
 */
export const CODE_COLOUR_LIMITS: CodeColourLimits = { chars: 20_000, lineChars: 400, blockMs: 50, pageMs: 100 };
