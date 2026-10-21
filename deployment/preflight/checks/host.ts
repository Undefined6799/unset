// C21 and C24 (P1.30s): what the stack needs from outside its own files. C21 reads the committed retirement-check
// report (P1.33a; docs/human/retirement/retirement-check.json, book edit 2026-10-07-p130s-split-and-p128h) under the
// strict YAML subset before the old 0x40.space PDS is deployed again; --env dev is waived (Alex, 2026-10-21 02:41:25Z:
// staging is a new PDS on a new handle domain and no 0x40 account carries over; prod still requires P1.33a). C24 asks
// the host whether its clock is synchronised, because service-auth JWTs (60 s), pds-admin envelopes (5 s of future
// leeway) and WebAuthn assertions all assume it is (findings F-16).
import { parseStrictData } from "../compose-parse.ts";
import { type Check, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** The one fixed line C21 prints under --env dev; it names the waiver and carries no value from the inputs. */
export const C21_DEV_WAIVER =
  "skipped: C21 waived under --env dev for staging (Alex, 2026-10-21 02:41:25Z); prod and local keep P1.33a";
const MAX_OFFSET_SECONDS = 1;
// chronyc tracking: "System time     : 0.000006523 seconds slow of NTP time" (chrony 4.6 manual, chronyc
// "tracking"); fast or slow, the number is the offset's size.
const SYSTEM_TIME = /^System time\s*:\s*([0-9]+(?:\.[0-9]+)?) seconds (?:fast|slow) of NTP time$/m;

const pdsHostname = ({ serviceEnv }: Inputs): string =>
  serviceEnv.get("pds")?.use("PDS_HOSTNAME", (v) => v ?? "") ?? "";

/**
 * C21: on the old 0x40.space host (prod and local) the retirement report says part A is complete; any other host
 * skips it. Under --env dev the check is waived with one fixed line: staging runs a new PDS on a new handle domain and
 * no 0x40 account carries over (Alex, 2026-10-21 02:41:25Z), which supersedes the dev rule from P1.34t (architecture
 * record 2026-10-13-local-plc, Amendment 6, Q1) for staging only. Prod still requires P1.33a.
 */
export const c21: Check = {
  id: "C21",
  run: (inputs) => {
    // A hostname is case-insensitive and may end in the root's dot (RFC 4343 section 2, RFC 1034 section 3.1).
    if (inputs.env === "dev") return pass(C21_DEV_WAIVER);
    const name = pdsHostname(inputs).toLowerCase();
    if ((name.endsWith(".") ? name.slice(0, -1) : name) !== "0x40.space")
      return pass("skipped: PDS_HOSTNAME is unset or a different host");
    const text = inputs.readText(inputs.retirementReportPath);
    if (text === null) return missing(inputs.retirementReportPath);
    let report: unknown;
    try {
      report = parseStrictData(text, inputs.retirementReportPath);
    } catch {
      return fail("retirement report is unreadable");
    }
    const complete = (report as { retirement_part_a_complete?: unknown } | null)?.retirement_part_a_complete;
    return complete === true ? pass() : fail("the retirement report does not mark part A complete");
  },
};

/** C24: NTP says synchronised and, where chrony runs, the offset is at most 1 s. Agents' `.localhost` stacks skip it. */
export const c24: Check = {
  id: "C24",
  network: true,
  run: async (inputs, signal): Promise<Outcome> => {
    if (pdsHostname(inputs).endsWith(".localhost")) return pass("skipped: PDS_HOSTNAME ends in .localhost");
    const ntp = await inputs.run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"], signal);
    if (ntp.missing === true) return fail("timedatectl is not installed");
    if (ntp.code !== 0) return fail("timedatectl failed");
    if (ntp.stdout.trim() !== "yes") return fail("the host clock is not NTP-synchronised");
    const chrony = await inputs.run("chronyc", ["tracking"], signal);
    if (chrony.missing === true) return pass();
    if (chrony.code !== 0) return fail("chronyc tracking failed");
    const offset = SYSTEM_TIME.exec(chrony.stdout)?.[1];
    if (offset === undefined) return fail("chronyc tracking output is unreadable");
    return Number(offset) <= MAX_OFFSET_SECONDS ? pass() : fail("the host clock is more than one second off NTP time");
  },
};
