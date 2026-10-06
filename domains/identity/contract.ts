// What identity resolution needs from the network (P2.01): one GET and one TXT lookup. The domain never reaches the
// network itself; infrastructure/pds implements this contract on net-guard, which owns timeouts, pinning and refusals.

/** `plc`: the PLC directory only. `public`: any public https host (did:web documents, handle domains). */
export type FetchTarget = "plc" | "public";

export type FetchRequest = { readonly target: FetchTarget; readonly maxBytes: number; readonly accept: string };

export type HttpOutcome =
  /** The server answered; any status. */
  | { readonly kind: "response"; readonly status: number; readonly body: Uint8Array }
  /** Could not tell right now: a timeout, a connection or TLS failure, a DNS failure other than "no such name". */
  | { readonly kind: "unavailable" }
  /** The host name does not exist (NXDOMAIN or no address records). */
  | { readonly kind: "no_such_host" }
  /** Refused by the egress rules: a private answer, a redirect, an oversized or undecodable body. */
  | { readonly kind: "refused" };

export type TxtOutcome =
  /** Each TXT record with its chunks joined. */
  | { readonly kind: "records"; readonly records: readonly string[] }
  | { readonly kind: "no_record" }
  | { readonly kind: "unavailable" };

export type IdentityNetwork = {
  /** A GET sending `accept` as its Accept header; at most `maxBytes` of body, or `refused`. */
  get(url: URL, request: FetchRequest): Promise<HttpOutcome>;
  txt(name: string): Promise<TxtOutcome>;
};
