// A member past the app gate (P1.20f): onboarded (adult, this build's terms, chat step done) and with a confirmed
// email cached on every session of the DID, written as the web role through the same repository and store the
// server uses (TE-2). Tests that sign a member in directly call it, so a page behind the gate renders; the gate's
// own outcomes are tested in welcome/onboarding.test.ts.
import { type Did, PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import { createAccountRepository, type Pool, withTransaction } from "@unset/infrastructure-postgres";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { chatAccountsOf } from "../../support/chat-accounts.ts";

const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });

/** Onboards `did`; with `emailConfirmed` (default true) it also caches that answer on every session of the DID. */
export async function readyMember(pool: Pool, did: Did, emailConfirmed: boolean | null = true): Promise<void> {
  const deadline = AbortSignal.timeout(5000);
  const accounts = createAccountRepository(pool, {
    recordUnderageBlock: async () => {
      throw new Error("readyMember never blocks");
    },
    chatAccounts: chatAccountsOf(pool),
  });
  await accounts.confirmAdult(did, deadline);
  const step = await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline);
  if (step === "chat") await accounts.finishChat(did, deadline);
  if (emailConfirmed === null) return;
  const sessions = createSessionStore({
    withDb: async () => {
      throw new Error("readyMember only writes through the transaction it passes");
    },
    limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
    log: quiet,
  });
  await withTransaction(pool, null, (tx) => sessions.setEmailConfirmed(tx, { did }, emailConfirmed));
}
