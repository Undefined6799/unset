// C18's tie between the edge's PDS_HOST and the PDS's own PDS_HOSTNAME (P1.35g; verify-876 S1, architecture ~00:27Z).
import { ENV_NAMES } from "../../edge/caddyfile.ts";
import { fail, type Inputs, missing, type Outcome } from "./types.ts";

/**
 * The edge's PDS_HOST is a hostname, never an IPv4 address, and the PDS's own PDS_HOSTNAME, compared lower case with no
 * trailing dot and no port (P1.35g; verify-876 S1, architecture ~00:27Z). Only local ties the two, here, so the edge
 * never terminates TLS for a name the PDS does not answer as; dev and prod have no such check yet (verify-888 S1).
 * Reasons are fixed words.
 */
export function pdsHostProblem(inputs: Inputs, pdsHost: string | undefined): Outcome | null {
  if (pdsHost === undefined || pdsHost === "") return missing("the edge's PDS_HOST");
  if (!ENV_NAMES.PDS_HOST.test(pdsHost) || /\.\d+$/.test(pdsHost)) return fail("PDS_HOST is not a hostname");
  const hostname = inputs.serviceEnv.get("pds")?.use("PDS_HOSTNAME", (value) => value);
  if (hostname === undefined || hostname === "") return missing("the pds service's PDS_HOSTNAME");
  if (normalHost(pdsHost) !== normalHost(hostname)) return fail("PDS_HOST is not the pds service's PDS_HOSTNAME");
  return null;
}

/** A hostname as DNS compares it: lower case, without a port or the root's trailing dot. */
const normalHost = (host: string): string => host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
