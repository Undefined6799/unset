// The chat account store a test's account repository queues into at the terms step (build step 5): the real store
// on the test's pool, drawing chat users from the CSPRNG as web's composition root does.
import { randomBytes } from "node:crypto";
import { newChatUser } from "@unset/domains-messaging";
import { type ChatAccountStore, createChatAccountStore, type Pool } from "@unset/infrastructure-postgres";

export const chatAccountsOf = (pool: Pool): ChatAccountStore =>
  createChatAccountStore(pool, { newUser: () => newChatUser((n) => randomBytes(n)), leaseS: 60 });
