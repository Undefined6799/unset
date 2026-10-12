// The browser session store (P2.03; plan section 5.3 "Sessions"): sessions keyed by a hash of the cookie, read once
// per request, expired by the database clock. Trusted base (SE-6): the bearer-credential store.
export {
  type CreatedSession,
  createSessionStore,
  type EndSessionsReason,
  type Session,
  type SessionDb,
  type SessionLimits,
  type SessionRead,
  type SessionRequest,
  type SessionStore,
  type WithSessionDb,
} from "./store.ts";
