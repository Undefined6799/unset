// The admin services' shared kit (P2.09; ADR 0060; ADR 0093): the signed envelope's payload shape, its canonical bytes
// and the signer, the replay guard and its durable state file, and the internal-only DNS rule. It imports only Node
// built-ins, so pds-admin and chat-admin, which may import nothing else, can share it with web.
export {
  type AdminEnvelope,
  type AdminPayload,
  CHAT_PAYLOAD_KEYS,
  type ChatAdminPayload,
  type ChatAdminVerb,
  canonicalize,
  PAYLOAD_KEYS,
  signEnvelope,
} from "./envelope.ts";
export {
  allInternal,
  type Resolution,
  type Resolve,
  resolvesInternal,
  systemResolve,
  vettedLookup,
} from "./internal-host.ts";
export { type JtiStore, openJtiStore } from "./jti.ts";
export { appendLine, DurabilityLost, readLines, replaceLines } from "./state-file.ts";
