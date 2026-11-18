// The signed admin envelope (P2.09; ADR 0060): its payload shape, its canonical bytes and the signer. It imports only
// Node built-ins, so pds-admin, which may import nothing else, can share it with web.
export {
  type AdminEnvelope,
  type AdminPayload,
  canonicalize,
  PAYLOAD_KEYS,
  signEnvelope,
} from "./envelope.ts";
