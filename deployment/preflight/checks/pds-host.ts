// C18's tie between the edge's PDS_HOST and the PDS's own PDS_HOSTNAME, in every env (P1.35g under local; P1.35l for
// dev and prod, architecture 02:01Z). C21 reads only the retirement report (host.ts:18-40), so nothing else ties them.
import { isIP } from "node:net";
import { ENV_NAMES } from "../../edge/caddyfile.ts";
import { fail, type Inputs, missing, type Outcome } from "./types.ts";

/**
 * The edge's PDS_HOST is a hostname, never an IP address, and the PDS's own PDS_HOSTNAME, itself never an IP address,
 * compared lower case with no trailing dot and no port (P1.35g; verify-876 S1, architecture ~00:27Z; P1.35l). So the
 * edge never terminates TLS for a name the PDS does not answer as. Reasons are fixed words.
 */
export function pdsHostProblem(inputs: Inputs, pdsHost: string | undefined): Outcome | null {
  if (pdsHost === undefined || pdsHost === "") return missing("the edge's PDS_HOST");
  if (!ENV_NAMES.PDS_HOST.test(pdsHost) || /\.\d+$/.test(pdsHost)) return fail("PDS_HOST is not a hostname");
  const hostname = inputs.serviceEnv.get("pds")?.use("PDS_HOSTNAME", (value) => value);
  if (hostname === undefined || hostname === "") return missing("the pds service's PDS_HOSTNAME");
  if (ipLiteral(hostname)) return fail("PDS_HOSTNAME is an IP address");
  if (normalHost(pdsHost) !== normalHost(hostname)) return fail("PDS_HOST is not the pds service's PDS_HOSTNAME");
  return null;
}

/** A hostname as DNS compares it: lower case, without a port or the root's trailing dot. */
const normalHost = (host: string): string => host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/**
 * An IPv4 or IPv6 address, bare, bracketed or with a port, or a name whose last label is all digits, which a resolver
 * may read as IPv4 (verify-869 S1). node:net isIP (Node v26.11.1 doc/api/net.md) takes no brackets and no port, and
 * normalHost would cut a bare IPv6 address's last group as a port, so the value is also tried whole.
 */
function ipLiteral(host: string): boolean {
  const bare = normalHost(host).replace(/^\[(.*)\]$/, "$1");
  return isIP(host) !== 0 || isIP(bare) !== 0 || /\.\d+$/.test(bare);
}
