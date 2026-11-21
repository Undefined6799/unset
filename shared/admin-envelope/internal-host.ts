// Internal-only connections for the admin services (P2.09 step 13; ADR 0060 decision 6, ADR 0081 decision 6): the
// one upstream each calls (the PDS for pds-admin, MAS for chat-admin) must resolve only to internal addresses, at boot
// and on every connection, so a DNS change cannot send an admin credential out. It opens no connection itself.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net"; // guard-allow: egress address classes and types only, opens nothing

/** Loopback, private, link-local and unique-local ranges: an admin service's upstream must answer only from these. */
const INTERNAL = new BlockList();
for (const [net, bits] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
] as const)
  INTERNAL.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  INTERNAL.addSubnet(net, bits, "ipv6");

/** Whether every answer is internal (and there is at least one). */
export const allInternal = (answers: readonly LookupAddress[]): boolean =>
  answers.length > 0 && answers.every(({ address, family }) => INTERNAL.check(address, family === 6 ? "ipv6" : "ipv4"));

/** Resolves a host name to all its addresses; a port so a test can play DNS (rule AB-2). */
export type Resolve = (host: string, done: (error: Error | null, answers: LookupAddress[]) => void) => void;
export const systemResolve: Resolve = (host, done) => dnsLookup(host, { all: true }, done);

/**
 * The lookup each connection makes: the answers it will connect to are the ones checked, so a DNS change after boot
 * cannot send an admin credential to a public address. Any non-internal answer refuses the whole lookup.
 */
export function vettedLookup(resolve: Resolve, refuse: () => Error): LookupFunction {
  return (host, options, callback) => {
    resolve(host, (error, answers) => {
      if (error) return callback(error, "", 0);
      if (!allInternal(answers)) return callback(refuse(), "", 0);
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, answers);
      const first = answers[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

/** Where `origin`'s host resolves: only to internal addresses, to any public one, or (for now) nowhere. */
export type Resolution = "internal" | "public" | "unresolved";

/**
 * The boot check (P2.09 step 13). A public answer stops the boot; a name that does not resolve yet (the upstream's
 * container not started) is not a refusal, because every later connection makes the same check (vettedLookup).
 */
export function resolvesInternal(origin: URL, resolve: Resolve = systemResolve): Promise<Resolution> {
  const host = origin.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const judge = (answers: readonly LookupAddress[]): Resolution => (allInternal(answers) ? "internal" : "public");
  if (family !== 0) return Promise.resolve(judge([{ address: host, family }]));
  return new Promise((done) =>
    resolve(host, (error, answers) => done(error !== null || answers.length === 0 ? "unresolved" : judge(answers))),
  );
}
