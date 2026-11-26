// The setup claim (build step 8; ADR 0095 decision 2, ADR 0100): at most one browser at a time runs an account's
// "Save your recovery key" setup, so two browsers never each make a different signing identity and vault. A browser
// claims through the device it holds, so the claim is always for the account of its own entry in the browser list
// (rule SE-2: a browser without that device claims nothing and learns nothing). The claim lasts long enough for a
// person to save their key; the holder claims again before the last step, and releases when setup is done. A holder
// that never comes back blocks others only until its claim's time has passed.
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId } from "./browser.ts";

/** How long a claim holds: the page's own setup calls take seconds; the rest is the person saving their key. */
export const SETUP_CLAIM_S = 900;

export type SetupClaims = {
  /** Claims `entry`'s account for `leaseS` seconds: its own claim is taken again, a live one of another is not. */
  claim(entry: BrowserEntry, leaseS: number, deadline: AbortSignal): Promise<"claimed" | "elsewhere">;
  /** Ends `entry`'s claim; ending one it does not hold changes nothing. */
  release(entry: BrowserEntry, deadline: AbortSignal): Promise<void>;
};

type Ports = { readonly list: BrowserList; readonly claims: SetupClaims };
type Request = { readonly browser: BrowserKey; readonly device: DeviceId; readonly deadline: AbortSignal };

export type ClaimOutcome = { readonly kind: "claimed" | "elsewhere" | "no_session" };
export type ReleaseOutcome = { readonly kind: "released" | "no_session" };

export async function claimSetup(ports: Ports, { browser, device, deadline }: Request): Promise<ClaimOutcome> {
  const entry = await ports.list.findDevice(browser, device, deadline);
  if (entry === null) return { kind: "no_session" };
  return { kind: await ports.claims.claim(entry, SETUP_CLAIM_S, deadline) };
}

export async function releaseSetup(ports: Ports, { browser, device, deadline }: Request): Promise<ReleaseOutcome> {
  const entry = await ports.list.findDevice(browser, device, deadline);
  if (entry === null) return { kind: "no_session" };
  await ports.claims.release(entry, deadline);
  return { kind: "released" };
}
